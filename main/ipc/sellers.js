const { ipcMain, BrowserWindow } = require('electron')
const { getDB } = require('../../database/db')

function notifyChanged() {
  BrowserWindow.getAllWindows()[0]?.webContents.send('settings:changed', 'sellers')
}

// On first load, migrate any existing sellers stored as JSON in the settings table
function migrateSellersFromSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key='sellers'").get()
  if (!row || !row.value) return
  let arr = []
  try { arr = JSON.parse(row.value) } catch { return }
  if (!Array.isArray(arr) || arr.length === 0) return
  const existing = db.prepare('SELECT COUNT(*) as n FROM sellers').get()
  if (existing.n > 0) return  // already migrated
  const insert = db.prepare('INSERT OR IGNORE INTO sellers (name, commission_rate) VALUES (?, ?)')
  const tx = db.transaction(() => {
    for (const s of arr) {
      const name = typeof s === 'string' ? s.trim() : (s?.name || '').trim()
      const rate = typeof s === 'object' ? (Number(s.commission_rate) || 0) : 0
      if (name) insert.run(name, rate)
    }
  })
  tx()
  // Clear the old JSON entry so it doesn't interfere
  db.prepare("UPDATE settings SET value='[]' WHERE key='sellers'").run()
}

ipcMain.handle('sellers:list', () => {
  const db = getDB()
  migrateSellersFromSettings(db)
  return db.prepare('SELECT * FROM sellers WHERE active=1 ORDER BY name ASC').all()
})

ipcMain.handle('sellers:add', (_, { name, commission_rate }) => {
  const db = getDB()
  const n = (name || '').trim()
  if (!n) throw new Error('Nombre requerido')
  const { lastInsertRowid } = db.prepare(
    'INSERT OR IGNORE INTO sellers (name, commission_rate) VALUES (?, ?)'
  ).run(n, Number(commission_rate) || 0)
  notifyChanged()
  return { id: lastInsertRowid }
})

ipcMain.handle('sellers:update', (_, { id, name, commission_rate }) => {
  const db = getDB()
  const n = (name || '').trim()
  if (!n) throw new Error('Nombre requerido')
  db.prepare('UPDATE sellers SET name=?, commission_rate=? WHERE id=?').run(n, Number(commission_rate) || 0, id)
  notifyChanged()
  return true
})

ipcMain.handle('sellers:delete', (_, id) => {
  const db = getDB()
  db.prepare('UPDATE sellers SET active=0 WHERE id=?').run(id)
  notifyChanged()
  return true
})
