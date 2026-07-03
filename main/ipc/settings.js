const { ipcMain, BrowserWindow } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('settings:get', (_, key) => {
  const row = getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)
  return row ? row.value : null
})

ipcMain.handle('settings:set', (_, { key, value }) => {
  getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, String(value ?? ''))
  BrowserWindow.getAllWindows()[0]?.webContents.send('settings:changed', key)
  // Reenviar el ping al panel del distribuidor cuando cambia el nombre del negocio
  if (key === 'business_name') {
    try { require('../lib/distributorPing').pingDistributor() } catch {}
  }
  return true
})

ipcMain.handle('settings:getAll', () => {
  const rows = getDB().prepare('SELECT key, value FROM settings').all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
})
