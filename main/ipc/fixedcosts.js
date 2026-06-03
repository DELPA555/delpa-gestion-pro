const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('fixedcosts:list', () => {
  return getDB().prepare('SELECT * FROM fixed_costs ORDER BY category, name').all()
})

ipcMain.handle('fixedcosts:create', (_, data) => {
  const db = getDB()
  const { name, amount, category } = data
  if (!name || !amount) return { ok: false, error: 'Nombre y monto requeridos' }
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO fixed_costs (name, amount, category) VALUES (?,?,?)'
  ).run(name, Number(amount), category || 'General')
  return { ok: true, id: lastInsertRowid }
})

ipcMain.handle('fixedcosts:update', (_, { id, ...data }) => {
  const db = getDB()
  const { name, amount, category, active } = data
  db.prepare(
    'UPDATE fixed_costs SET name=?, amount=?, category=?, active=? WHERE id=?'
  ).run(name, Number(amount), category || 'General', active !== undefined ? (active ? 1 : 0) : 1, id)
  return { ok: true }
})

ipcMain.handle('fixedcosts:delete', (_, id) => {
  getDB().prepare('DELETE FROM fixed_costs WHERE id=?').run(id)
  return { ok: true }
})

ipcMain.handle('fixedcosts:total', () => {
  const row = getDB().prepare('SELECT COALESCE(SUM(amount),0) as total FROM fixed_costs WHERE active=1').get()
  return row.total
})
