const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('audit:list', (_, { page = 1, limit = 50, module: mod } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE 1=1'
  const params = []
  if (mod) { where += ' AND module=?'; params.push(mod) }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`).get(...params)
  const logs = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { logs, total: count, pages: Math.ceil(count / limit) }
})
