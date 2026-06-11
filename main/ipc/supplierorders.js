const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

function getOrderNumber(db) {
  const year = new Date().getFullYear()
  const key = `supplier_order_seq_${year}`
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key)
  const seq = (parseInt(row?.value || '0', 10)) + 1
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(seq))
  return `PED-${year}-${String(seq).padStart(4, '0')}`
}

ipcMain.handle('supplierorders:list', (_, { page = 1, limit = 25, supplier_id, status, search } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = '1=1'
  const params = []
  if (supplier_id) { where += ' AND supplier_id=?'; params.push(supplier_id) }
  if (status)      { where += ' AND status=?'; params.push(status) }
  if (search)      { where += ' AND (order_number LIKE ? OR supplier_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`) }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM supplier_orders WHERE ${where}`).get(...params)
  const rows = db.prepare(`SELECT * FROM supplier_orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { orders: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('supplierorders:get', (_, id) => {
  const db = getDB()
  const order = db.prepare('SELECT * FROM supplier_orders WHERE id=?').get(id)
  if (!order) return null
  try { order.items = JSON.parse(order.items_json || '[]') } catch { order.items = [] }
  return order
})

ipcMain.handle('supplierorders:create', (_, data) => {
  const db = getDB()
  const { supplier_id, supplier_name, supplier_email, supplier_phone, notes, items, status = 'draft' } = data
  const total = (items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost) || 0), 0)

  const run = db.transaction(() => {
    const orderNumber = getOrderNumber(db)
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO supplier_orders (order_number,supplier_id,supplier_name,supplier_email,supplier_phone,status,notes,total,items_json)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(orderNumber, supplier_id || null, supplier_name || '', supplier_email || '', supplier_phone || '',
           status, notes || '', total, JSON.stringify(items || []))
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','supplierorders',?,?,?)`)
      .run(lastInsertRowid, `Pedido ${orderNumber} creado`, JSON.stringify({ supplier_name, total }))
    return { id: lastInsertRowid, order_number: orderNumber }
  })
  return { ok: true, ...run() }
})

ipcMain.handle('supplierorders:update', (_, { id, supplier_id, supplier_name, supplier_email, supplier_phone, notes, items, status }) => {
  const db = getDB()
  const total = (items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.cost) || 0), 0)
  db.prepare(`
    UPDATE supplier_orders
    SET supplier_id=?, supplier_name=?, supplier_email=?, supplier_phone=?,
        notes=?, items_json=?, status=?, total=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(supplier_id || null, supplier_name || '', supplier_email || '', supplier_phone || '',
         notes || '', JSON.stringify(items || []), status, total, id)
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('UPDATE','supplierorders',?,?,?)`)
    .run(id, `Pedido actualizado → ${status}`, JSON.stringify({ status, total }))
  return { ok: true }
})

ipcMain.handle('supplierorders:delete', (_, id) => {
  const db = getDB()
  const order = db.prepare('SELECT status FROM supplier_orders WHERE id=?').get(id)
  if (!order) throw new Error('Pedido no encontrado')
  if (order.status !== 'draft') throw new Error('Solo se pueden eliminar pedidos en borrador')
  db.prepare('DELETE FROM supplier_orders WHERE id=?').run(id)
  return { ok: true }
})

ipcMain.handle('supplierorders:lowStock', () => {
  const db = getDB()
  return db.prepare(`
    SELECT p.id as product_id, p.name as product_name,
           COALESCE(p.cost, 0) as cost,
           COALESCE(p.color, '') as color,
           COALESCE(p.category, 'Sin categoría') as category,
           ps.size, ps.stock, ps.min_stock,
           CAST(ps.min_stock - ps.stock AS INTEGER) as qty_needed
    FROM products p
    JOIN product_sizes ps ON ps.product_id = p.id
    WHERE p.active=1 AND ps.stock < ps.min_stock
    ORDER BY p.name, ps.size
  `).all()
})

ipcMain.handle('supplierorders:convertToEntry', (_, id) => {
  const db = getDB()
  const order = db.prepare('SELECT * FROM supplier_orders WHERE id=?').get(id)
  if (!order) throw new Error('Pedido no encontrado')
  let items
  try { items = JSON.parse(order.items_json || '[]') } catch { items = [] }

  const run = db.transaction(() => {
    // Group items by product_id
    const grouped = {}
    for (const it of items) {
      const key = String(it.product_id)
      if (!grouped[key]) grouped[key] = { product_id: it.product_id, product_name: it.product_name, cost: it.cost, sizes: [] }
      grouped[key].sizes.push({ size: it.size || 'N/A', qty: Number(it.qty) || 0 })
    }

    for (const item of Object.values(grouped)) {
      if (!item.product_id) continue
      for (const sz of item.sizes) {
        if (!sz.qty || sz.qty <= 0) continue
        const size = sz.size || 'N/A'
        const existing = db.prepare('SELECT id, stock FROM product_sizes WHERE product_id=? AND size=?').get(item.product_id, size)
        if (existing) {
          db.prepare('UPDATE product_sizes SET stock=stock+? WHERE product_id=? AND size=?').run(sz.qty, item.product_id, size)
        } else {
          db.prepare('INSERT INTO product_sizes (product_id,size,stock,min_stock) VALUES (?,?,?,0)').run(item.product_id, size, sz.qty)
        }
        try { db.prepare('UPDATE product_sizes SET stock_modified_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=?').run(item.product_id, size) } catch {}
      }
    }

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO stock_entries (supplier_id,supplier_name,date,notes,total,items_json)
      VALUES (?,?,?,?,?,?)
    `).run(order.supplier_id || null, order.supplier_name || '', new Date().toISOString().split('T')[0],
           `Generado desde pedido ${order.order_number}`, order.total || 0, order.items_json)

    db.prepare('UPDATE supplier_orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('received', id)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','stockentries',?,?,?)`)
      .run(lastInsertRowid, `Ingreso desde pedido ${order.order_number}`, JSON.stringify({ from_order: order.order_number }))

    const productIds = [...new Set(Object.values(grouped).map(g => g.product_id).filter(Boolean))]
    return { entryId: lastInsertRowid, productIds }
  })
  return { ok: true, ...run() }
})
