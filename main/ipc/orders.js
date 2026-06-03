const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('orders:list', (_, { page = 1, limit = 25, status = '' } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE 1=1'
  const params = []
  if (status) { where += ' AND status=?'; params.push(status) }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM orders ${where}`).get(...params)
  const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return {
    orders: rows.map(o => ({ ...o, items: JSON.parse(o.items_json || '[]') })),
    total: count,
    pages: Math.ceil(count / limit),
  }
})

ipcMain.handle('orders:get', (_, id) => {
  const o = getDB().prepare('SELECT * FROM orders WHERE id=?').get(id)
  if (!o) return null
  return { ...o, items: JSON.parse(o.items_json || '[]') }
})

ipcMain.handle('orders:create', (_, data) => {
  const { client_name, client_phone, items, total, advance, status, notes, delivery_date } = data
  const { lastInsertRowid } = getDB().prepare(`
    INSERT INTO orders (client_name,client_phone,items_json,total,advance,status,notes,delivery_date)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(client_name, client_phone || '', JSON.stringify(items || []), total || 0, advance || 0,
         status || 'pendiente', notes || '', delivery_date || '')
  return lastInsertRowid
})

ipcMain.handle('orders:update', (_, { id, ...data }) => {
  const { client_name, client_phone, items, total, advance, status, notes, delivery_date } = data
  getDB().prepare(`
    UPDATE orders SET client_name=?,client_phone=?,items_json=?,total=?,advance=?,status=?,notes=?,delivery_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(client_name, client_phone || '', JSON.stringify(items || []), total || 0, advance || 0,
         status || 'pendiente', notes || '', delivery_date || '', id)
  return true
})

ipcMain.handle('orders:delete', (_, id) => {
  getDB().prepare('DELETE FROM orders WHERE id=?').run(id)
  return true
})
