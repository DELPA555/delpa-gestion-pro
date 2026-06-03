const { ipcMain, BrowserWindow } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('waitlist:list', (_, { status = '' } = {}) => {
  const db = getDB()
  let where = 'WHERE 1=1'
  const params = []
  if (status) { where += ' AND status=?'; params.push(status) }
  const rows = db.prepare(`SELECT * FROM waitlist ${where} ORDER BY created_at DESC`).all(...params)
  return rows
})

ipcMain.handle('waitlist:pending', () => {
  const db = getDB()
  const { count } = db.prepare("SELECT COUNT(*) as count FROM waitlist WHERE status='waiting'").get()
  return count
})

ipcMain.handle('waitlist:add', (_, data) => {
  const db = getDB()
  const { client_name, client_phone, product_id, product_name, size, color, estimated_date, notes } = data
  if (!client_name || !product_name) return { ok: false, error: 'Faltan datos requeridos' }
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO waitlist (client_name,client_phone,product_id,product_name,size,color,estimated_date,notes)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(client_name, client_phone || '', product_id || null, product_name,
         size || '', color || '', estimated_date || '', notes || '')
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','waitlist',?,'Lista de espera',?)`)
    .run(lastInsertRowid, JSON.stringify({ client_name, product_name, size }))
  sendWaitlistCount()
  return { ok: true, id: lastInsertRowid }
})

ipcMain.handle('waitlist:notify', (_, id) => {
  const db = getDB()
  db.prepare("UPDATE waitlist SET notified=1, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
  return { ok: true }
})

ipcMain.handle('waitlist:complete', (_, id) => {
  const db = getDB()
  db.prepare("UPDATE waitlist SET status='completed', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
  sendWaitlistCount()
  return { ok: true }
})

ipcMain.handle('waitlist:delete', (_, id) => {
  const db = getDB()
  db.prepare('DELETE FROM waitlist WHERE id=?').run(id)
  sendWaitlistCount()
  return { ok: true }
})

function sendWaitlistCount() {
  try {
    const db = getDB()
    const { count } = db.prepare("SELECT COUNT(*) as count FROM waitlist WHERE status='waiting'").get()
    BrowserWindow.getAllWindows()[0]?.webContents.send('waitlist:count', count)
  } catch {}
}

// Called from stockentries after adding stock — checks if any waitlist items arrived
function checkWaitlistArrivals(db, processedItems) {
  try {
    const waiting = db.prepare("SELECT * FROM waitlist WHERE status='waiting'").all()
    if (!waiting.length) return []
    const arrived = []
    for (const entry of waiting) {
      for (const item of processedItems) {
        const pidMatch = !entry.product_id || entry.product_id === item.product_id
        const nameMatch = entry.product_name?.toLowerCase() === (item.product_name || '').toLowerCase()
        if (!(pidMatch || nameMatch)) continue
        const sizeMatch = !entry.size || !item.sizes || item.sizes.some(s => s.size === entry.size && s.qty > 0)
        if (sizeMatch) {
          db.prepare("UPDATE waitlist SET status='arrived', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(entry.id)
          arrived.push(entry)
        }
      }
    }
    if (arrived.length > 0) {
      BrowserWindow.getAllWindows()[0]?.webContents.send('waitlist:arrivals', arrived)
    }
    sendWaitlistCount()
    return arrived
  } catch (e) {
    console.error('[waitlist] checkArrivals error:', e.message)
    return []
  }
}

module.exports = { checkWaitlistArrivals, sendWaitlistCount }
