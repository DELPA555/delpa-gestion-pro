const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('consignment:products:list', () => {
  const db = getDB()
  return db.prepare(`
    SELECT cp.*, p.name as product_name, p.color, p.category, s.name as supplier_name
    FROM consignment_products cp
    JOIN products p ON p.id = cp.product_id
    LEFT JOIN suppliers s ON s.id = cp.supplier_id
    ORDER BY p.name
  `).all()
})

ipcMain.handle('consignment:products:set', (_, { product_id, supplier_id, cost_per_unit, active, notes }) => {
  const db = getDB()
  const existing = db.prepare('SELECT id FROM consignment_products WHERE product_id=?').get(product_id)
  if (existing) {
    db.prepare(`
      UPDATE consignment_products
      SET supplier_id=?, cost_per_unit=?, active=?, notes=?
      WHERE product_id=?
    `).run(supplier_id, cost_per_unit, active ? 1 : 0, notes || '', product_id)
    return { id: existing.id, updated: true }
  } else {
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO consignment_products (product_id, supplier_id, cost_per_unit, active, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(product_id, supplier_id, cost_per_unit, active ? 1 : 0, notes || '')
    return { id, created: true }
  }
})

ipcMain.handle('consignment:sales:list', (_, { supplier_id, liquidated, page = 1, limit = 50 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const conditions = []
  const params = []
  if (supplier_id) { conditions.push('supplier_id=?'); params.push(supplier_id) }
  if (liquidated !== undefined && liquidated !== null) {
    conditions.push('liquidated=?')
    params.push(liquidated ? 1 : 0)
  }
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM consignment_sales ${where}`).get(...params)
  const rows = db.prepare(`SELECT * FROM consignment_sales ${where} ORDER BY sold_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { sales: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('consignment:sales:record', (_, { sale_id, product_id, product_name, size, quantity, sold_at }) => {
  const db = getDB()
  const cp = db.prepare('SELECT * FROM consignment_products WHERE product_id=? AND active=1').get(product_id)
  if (!cp) throw new Error('Producto no está configurado como consignación activa')

  const supplier = db.prepare('SELECT name FROM suppliers WHERE id=?').get(cp.supplier_id)
  const total_cost = cp.cost_per_unit * quantity

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO consignment_sales
      (sale_id, product_id, product_name, size, quantity, cost_per_unit, total_cost,
       supplier_id, supplier_name, sold_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sale_id || null,
    product_id,
    product_name,
    size,
    quantity,
    cp.cost_per_unit,
    total_cost,
    cp.supplier_id,
    supplier?.name || '',
    sold_at || new Date().toISOString(),
  )
  return { id, total_cost }
})

ipcMain.handle('consignment:pending', () => {
  const db = getDB()
  return db.prepare(`
    SELECT supplier_id, supplier_name,
           SUM(total_cost) as total_debt,
           SUM(quantity) as units
    FROM consignment_sales
    WHERE liquidated=0
    GROUP BY supplier_id, supplier_name
    ORDER BY total_debt DESC
  `).all()
})

ipcMain.handle('consignment:liquidate', (_, { supplier_id, sale_ids, notes }) => {
  const db = getDB()
  if (!sale_ids || sale_ids.length === 0) throw new Error('No hay ventas seleccionadas')

  const supplier = db.prepare('SELECT name FROM suppliers WHERE id=?').get(supplier_id)
  if (!supplier) throw new Error('Proveedor no encontrado')

  // Get sales to liquidate
  const placeholders = sale_ids.map(() => '?').join(',')
  const sales = db.prepare(`SELECT * FROM consignment_sales WHERE id IN (${placeholders}) AND supplier_id=? AND liquidated=0`).all(...sale_ids, supplier_id)
  if (sales.length === 0) throw new Error('No se encontraron ventas pendientes para este proveedor')

  const total_amount = sales.reduce((s, r) => s + r.total_cost, 0)
  const total_units  = sales.reduce((s, r) => s + r.quantity, 0)

  // Generate liquidation number
  const { count } = db.prepare('SELECT COUNT(*) as count FROM consignment_liquidations').get()
  const number = `LIQ-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`

  const doLiquidate = db.transaction(() => {
    const { lastInsertRowid: liqId } = db.prepare(`
      INSERT INTO consignment_liquidations
        (number, supplier_id, supplier_name, total_amount, total_units, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(number, supplier_id, supplier.name, total_amount, total_units, notes || '')

    const updateSale = db.prepare(`UPDATE consignment_sales SET liquidated=1, liquidation_id=? WHERE id=?`)
    for (const s of sales) updateSale.run(liqId, s.id)

    return liqId
  })

  const liquidation_id = doLiquidate()
  return { liquidation_id, number, total_amount, total_units }
})

ipcMain.handle('consignment:liquidations:list', () => {
  const db = getDB()
  return db.prepare(`
    SELECT cl.*, s.name as supplier_display_name
    FROM consignment_liquidations cl
    LEFT JOIN suppliers s ON s.id = cl.supplier_id
    ORDER BY cl.created_at DESC
    LIMIT 200
  `).all()
})

ipcMain.handle('consignment:liquidation:get', (_, id) => {
  const db = getDB()
  const liq = db.prepare('SELECT * FROM consignment_liquidations WHERE id=?').get(id)
  if (!liq) return null
  const items = db.prepare('SELECT * FROM consignment_sales WHERE liquidation_id=? ORDER BY sold_at').all(id)
  return { ...liq, items }
})
