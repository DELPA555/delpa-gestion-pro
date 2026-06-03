const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('sucursales:list', () =>
  getDB().prepare('SELECT * FROM sucursales ORDER BY name').all()
)

ipcMain.handle('sucursales:create', (_, { name, address, phone }) => {
  const { lastInsertRowid } = getDB().prepare(
    'INSERT INTO sucursales (name, address, phone) VALUES (?,?,?)'
  ).run(name, address || '', phone || '')
  return lastInsertRowid
})

ipcMain.handle('sucursales:update', (_, { id, name, address, phone }) => {
  getDB().prepare('UPDATE sucursales SET name=?, address=?, phone=? WHERE id=?')
    .run(name, address || '', phone || '', id)
  return true
})

ipcMain.handle('sucursales:delete', (_, id) => {
  getDB().prepare('DELETE FROM sucursales WHERE id=?').run(id)
  return true
})

ipcMain.handle('sucursales:transfer', (_, { productId, productName, size, quantity, fromId, toId, notes }) => {
  const db = getDB()
  if (fromId === toId) throw new Error('La sucursal origen y destino deben ser distintas')
  db.prepare(
    'INSERT INTO stock_transfers (product_id, size, quantity, from_sucursal_id, to_sucursal_id, notes) VALUES (?,?,?,?,?,?)'
  ).run(productId || null, size, quantity, fromId, toId, notes || '')
  return true
})

ipcMain.handle('sucursales:transfers', () =>
  getDB().prepare(`
    SELECT t.*, p.name as product_name,
           s1.name as from_name, s2.name as to_name
    FROM stock_transfers t
    LEFT JOIN products p ON p.id=t.product_id
    LEFT JOIN sucursales s1 ON s1.id=t.from_sucursal_id
    LEFT JOIN sucursales s2 ON s2.id=t.to_sucursal_id
    ORDER BY t.created_at DESC LIMIT 200
  `).all()
)

ipcMain.handle('sucursales:salesBySucursal', (_, { sucursalId, from, to } = {}) => {
  const db = getDB()
  let where = 'WHERE s.voided=0'
  const params = []
  if (sucursalId) { where += ' AND s.sucursal_id=?'; params.push(sucursalId) }
  if (from) { where += " AND date(s.created_at,'localtime')>=?"; params.push(from) }
  if (to)   { where += " AND date(s.created_at,'localtime')<=?"; params.push(to) }
  return db.prepare(`
    SELECT COALESCE(su.name,'Sin sucursal') as sucursal,
           COUNT(*) as count, SUM(s.total) as total
    FROM sales s LEFT JOIN sucursales su ON su.id=s.sucursal_id
    ${where} GROUP BY s.sucursal_id ORDER BY total DESC
  `).all(...params)
})
