const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('purchases:list', (_, { page = 1, limit = 25, supplierId } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE 1=1'
  const params = []
  if (supplierId) { where += ' AND p.supplier_id=?'; params.push(supplierId) }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM purchases p ${where}`).get(...params)
  const rows = db.prepare(`
    SELECT p.*, s.name as supplier_name, s.phone as supplier_phone FROM purchases p
    LEFT JOIN suppliers s ON s.id=p.supplier_id
    ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
  return { purchases: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('purchases:get', (_, id) => {
  const db = getDB()
  const p = db.prepare('SELECT p.*,s.name as supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?').get(id)
  if (!p) return null
  p.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id=?').all(id)
  return p
})

ipcMain.handle('purchases:create', (_, { supplierId, invoiceNumber, items, total, paid, dueDate, notes }) => {
  const db = getDB()
  const run = db.transaction(() => {
    const { lastInsertRowid: purchaseId } = db.prepare(`
      INSERT INTO purchases (supplier_id,invoice_number,total,paid,due_date,notes,status)
      VALUES (?,?,?,?,?,?,?)
    `).run(supplierId || null, invoiceNumber || '', total, paid || 0, dueDate || '', notes || '',
        (paid || 0) >= total ? 'paid' : 'pending')

    for (const it of items) {
      db.prepare('INSERT INTO purchase_items (purchase_id,product_id,product_name,size,quantity,unit_cost) VALUES (?,?,?,?,?,?)')
        .run(purchaseId, it.productId, it.productName, it.size, it.quantity, it.unitCost)
      db.prepare('INSERT OR IGNORE INTO product_sizes (product_id,size,stock,min_stock) VALUES (?,?,0,2)').run(it.productId, it.size)
      db.prepare('UPDATE product_sizes SET stock=stock+? WHERE product_id=? AND size=?').run(it.quantity, it.productId, it.size)
      if (it.unitCost > 0) db.prepare('UPDATE products SET cost=? WHERE id=?').run(it.unitCost, it.productId)
    }

    const remaining = total - (paid || 0)
    if (supplierId && remaining > 0)
      db.prepare('UPDATE suppliers SET balance=balance+? WHERE id=?').run(remaining, supplierId)

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','purchases',?,?,?)`)
      .run(purchaseId, `Compra registrada $${total}`, JSON.stringify({ supplierId, total, items: items.length }))
    return purchaseId
  })
  return run()
})
