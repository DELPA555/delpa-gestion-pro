const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('suppliers:list', (_, { search = '', page = 1, limit = 25 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE active=1'
  const params = []
  if (search) {
    where += ' AND (name LIKE ? OR cuit LIKE ?)'
    params.push(`%${search}%`, `%${search}%`)
  }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM suppliers ${where}`).get(...params)
  const suppliers = db.prepare(`SELECT * FROM suppliers ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { suppliers, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('suppliers:get', (_, id) => getDB().prepare('SELECT * FROM suppliers WHERE id=?').get(id))

ipcMain.handle('suppliers:create', (_, { name, cuit, phone, email, address, cbu, alias_cbu, notes }) => {
  const db = getDB()
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO suppliers (name,cuit,phone,email,address,cbu,alias_cbu,notes) VALUES (?,?,?,?,?,?,?,?)'
  ).run(name, cuit || '', phone || '', email || '', address || '', cbu || '', alias_cbu || '', notes || '')
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('CREATE','suppliers',?,?)`).run(id, `Proveedor creado: ${name}`)
  return id
})

ipcMain.handle('suppliers:update', (_, { id, name, cuit, phone, email, address, cbu, alias_cbu, notes }) => {
  getDB().prepare('UPDATE suppliers SET name=?,cuit=?,phone=?,email=?,address=?,cbu=?,alias_cbu=?,notes=? WHERE id=?')
    .run(name, cuit || '', phone || '', email || '', address || '', cbu || '', alias_cbu || '', notes || '', id)
  return true
})

ipcMain.handle('suppliers:delete', (_, id) => {
  getDB().prepare('UPDATE suppliers SET active=0 WHERE id=?').run(id)
  return true
})

ipcMain.handle('suppliers:history', (_, supplierId) =>
  getDB().prepare(`
    SELECT p.id, p.invoice_number, p.total, p.paid, p.due_date, p.status, p.created_at,
           COUNT(pi.id) as items
    FROM purchases p LEFT JOIN purchase_items pi ON pi.purchase_id=p.id
    WHERE p.supplier_id=? GROUP BY p.id ORDER BY p.created_at DESC
  `).all(supplierId)
)

ipcMain.handle('suppliers:addPayment', (_, { supplierId, purchaseId, amount, paymentMethod, notes }) => {
  const db = getDB()
  const run = db.transaction(() => {
    db.prepare('INSERT INTO supplier_payments (supplier_id,purchase_id,amount,payment_method,notes) VALUES (?,?,?,?,?)')
      .run(supplierId, purchaseId || null, amount, paymentMethod || 'Transferencia', notes || '')
    db.prepare('UPDATE suppliers SET balance=balance-? WHERE id=?').run(amount, supplierId)
    if (purchaseId) {
      db.prepare('UPDATE purchases SET paid=paid+? WHERE id=?').run(amount, purchaseId)
      const p = db.prepare('SELECT total,paid FROM purchases WHERE id=?').get(purchaseId)
      if (p && p.paid >= p.total)
        db.prepare("UPDATE purchases SET status='paid' WHERE id=?").run(purchaseId)
    }
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('PAYMENT','suppliers',?,?)`).run(supplierId, `Pago proveedor $${amount}`)
    return true
  })
  return run()
})
