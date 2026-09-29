// Logs TÉCNICOS para diagnóstico rápido (distinto de audit_log, que es de negocio).
// Registra errores, queries lentas y operaciones críticas. Auto-purga a 1000 registros.
const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

const MAX_LOGS = 1000
const VALID_LEVELS = ['error', 'warn', 'info']

let _purgeCounter = 0

// Registra una entrada. Seguro de llamar en cualquier momento (nunca lanza).
function logTech(level, module, message, detail = '') {
  try {
    const db = getDB()
    const lvl = VALID_LEVELS.includes(level) ? level : 'info'
    const det = detail && typeof detail !== 'string' ? String(detail) : (detail || '')
    db.prepare('INSERT INTO tech_logs (level, module, message, detail) VALUES (?,?,?,?)')
      .run(lvl, String(module || ''), String(message || '').slice(0, 2000), det.slice(0, 8000))
    // Purga cada ~25 inserts para no correr el DELETE en cada log
    if (++_purgeCounter % 25 === 0) {
      db.prepare(`DELETE FROM tech_logs WHERE id NOT IN (
        SELECT id FROM tech_logs ORDER BY id DESC LIMIT ${MAX_LOGS}
      )`).run()
    }
  } catch { /* nunca romper por un log */ }
}

// ── IPC ──
ipcMain.handle('techLogs:getAll', (_, { level, module } = {}) => {
  const db = getDB()
  let sql = 'SELECT * FROM tech_logs'
  const where = [], params = []
  if (level && VALID_LEVELS.includes(level)) { where.push('level=?'); params.push(level) }
  if (module) { where.push('module=?'); params.push(module) }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ` ORDER BY id DESC LIMIT ${MAX_LOGS}`
  return db.prepare(sql).all(...params)
})

// Lista de módulos presentes (para el filtro)
ipcMain.handle('techLogs:modules', () =>
  getDB().prepare("SELECT DISTINCT module FROM tech_logs WHERE module<>'' ORDER BY module").all().map(r => r.module)
)

// Cantidad de errores nuevos sin ver (para el badge del tab)
ipcMain.handle('techLogs:unseenCount', () => {
  const db = getDB()
  const seen = Number(db.prepare("SELECT value FROM settings WHERE key='tech_logs_seen_id'").get()?.value || 0)
  return db.prepare("SELECT COUNT(*) c FROM tech_logs WHERE level='error' AND id>?").get(seen).c
})

// Marca todo como visto (guarda el id máximo)
ipcMain.handle('techLogs:markSeen', () => {
  const db = getDB()
  const maxId = db.prepare('SELECT COALESCE(MAX(id),0) m FROM tech_logs').get().m
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('tech_logs_seen_id',?)").run(String(maxId))
  return maxId
})

// Permite al renderer registrar errores/eventos (ej: PageErrorBoundary, window.onerror)
ipcMain.handle('techLogs:log', (_, { level, module, message, detail } = {}) => {
  logTech(level, module || 'ui', message, detail)
  return true
})

ipcMain.handle('techLogs:clear', () => {
  getDB().prepare('DELETE FROM tech_logs').run()
  return true
})

// Devuelve un TXT plano listo para enviar a soporte.
ipcMain.handle('techLogs:export', () => {
  const db = getDB()
  const rows = db.prepare('SELECT * FROM tech_logs ORDER BY id ASC').all()
  const biz = db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA'
  const pkg = require('../../package.json')
  let hwid = ''
  try { hwid = String(require('./license').getHardwareId() || '') } catch {}
  const header = [
    `DELPA Gestion PRO - Logs tecnicos`,
    `Negocio: ${biz}`,
    `Version: ${pkg.version}`,
    `Equipo: ${hwid}`,
    `Generado: ${new Date().toISOString()}`,
    `Total registros: ${rows.length}`,
    '='.repeat(60), '',
  ].join('\n')
  const body = rows.map(r =>
    `[${r.created_at}] ${String(r.level).toUpperCase().padEnd(5)} ${r.module ? '(' + r.module + ') ' : ''}${r.message}` +
    (r.detail ? `\n    ${String(r.detail).replace(/\n/g, '\n    ')}` : '')
  ).join('\n')
  return header + body + '\n'
})

module.exports = { logTech }
