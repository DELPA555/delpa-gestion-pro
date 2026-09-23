const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// ============================================================================
//  Modo entrenamiento: para capacitar vendedoras sin tocar datos reales.
//  El flag vive en settings.training_mode ('1'/'0'). Las ventas de práctica
//  NO pasan por sales:create — se registran en sales_training (solo para dejar
//  rastro) y NO tocan stock, caja, puntos ni AFIP. Al desactivar, se borran.
// ============================================================================

function isOn(db) {
  return db.prepare("SELECT value FROM settings WHERE key='training_mode'").get()?.value === '1'
}

ipcMain.handle('training:status', () => {
  const db = getDB()
  const count = db.prepare('SELECT COUNT(*) as n FROM sales_training').get()?.n || 0
  return { active: isOn(db), count }
})

ipcMain.handle('training:toggle', (_, on) => {
  const db = getDB()
  const value = on ? '1' : '0'
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('training_mode', ?)").run(value)
  // Al DESACTIVAR se limpian las ventas de práctica.
  if (!on) db.prepare('DELETE FROM sales_training').run()
  return { ok: true, active: !!on }
})

// Registra una venta de práctica (no toca datos reales). Solo si el modo está activo.
ipcMain.handle('training:sale', (_, data = {}) => {
  const db = getDB()
  if (!isOn(db)) return { ok: false, error: 'El modo entrenamiento no está activo' }
  const items = Array.isArray(data.items) ? data.items : []
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO sales_training (items_json, client_name, seller_name, total, payment_method)
    VALUES (?,?,?,?,?)
  `).run(
    JSON.stringify(items),
    data.client_name || '',
    data.seller_name || '',
    Number(data.total) || 0,
    data.payment_method || 'Efectivo',
  )
  return { ok: true, id: lastInsertRowid }
})

// Borra las ventas de práctica sin apagar el modo (por si quieren empezar de cero).
ipcMain.handle('training:clear', () => {
  getDB().prepare('DELETE FROM sales_training').run()
  return { ok: true }
})
