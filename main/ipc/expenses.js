const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')
const { getCurrentSession } = require('./auth')

const isAdmin = () => getCurrentSession()?.role === 'admin'

ipcMain.handle('expenses:list', (_, { page = 1, limit = 25, from, to } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE 1=1'
  const params = []
  if (isAdmin()) {
    // Admin/dueño: filtra por el rango que pida
    if (from) { where += " AND date(created_at,'localtime')>=?"; params.push(from) }
    if (to) { where += " AND date(created_at,'localtime')<=?"; params.push(to) }
  } else {
    // Vendedora: solo puede ver los gastos del día actual (ignora cualquier rango)
    where += " AND date(created_at,'localtime')=date('now','localtime')"
  }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM expenses ${where}`).get(...params)
  const rows = db.prepare(`SELECT * FROM expenses ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { expenses: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('expenses:create', (_, { concept, category, amount, paymentMethod, notes }) => {
  const db = getDB()
  const cashbox = db.prepare("SELECT id FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()
  return db.transaction(() => {
    const { lastInsertRowid: id } = db.prepare(
      'INSERT INTO expenses (concept,category,amount,payment_method,cashbox_id,notes) VALUES (?,?,?,?,?,?)'
    ).run(concept, category || 'General', amount, paymentMethod || 'Efectivo', cashbox?.id || null, notes || '')
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('CREATE','expenses',?,?)`).run(id, `Gasto: ${concept} $${amount}`)
    return id
  })()
})

ipcMain.handle('expenses:delete', (_, id) => {
  // Solo admin/dueño puede eliminar gastos
  if (!isAdmin()) throw new Error('No tenés permiso para eliminar gastos')
  const db = getDB()
  const expense = db.prepare('SELECT concept, amount FROM expenses WHERE id=?').get(id)
  if (!expense) return false
  db.transaction(() => {
    db.prepare('DELETE FROM expenses WHERE id=?').run(id)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('DELETE','expenses',?,?)`)
      .run(id, `Gasto eliminado: ${expense.concept} $${expense.amount}`)
  })()
  return true
})
