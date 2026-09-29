const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')
const { createTables } = require('./schema')

let db = null

function getDB() {
  if (!db) throw new Error('DB no inicializada. Llamar initDB() primero.')
  return db
}

// Envuelve prepare() para registrar queries que tarden más de 500ms (logs técnicos).
// Se salta las de tech_logs para no recursar. Nunca rompe si algo falla.
function instrumentSlowQueries(database) {
  const SLOW_MS = 500
  const origPrepare = database.prepare.bind(database)
  database.prepare = (sql) => {
    const stmt = origPrepare(sql)
    const isTechLog = /tech_logs/i.test(sql)
    if (isTechLog) return stmt
    for (const method of ['run', 'get', 'all']) {
      if (typeof stmt[method] !== 'function') continue
      const orig = stmt[method].bind(stmt)
      stmt[method] = (...args) => {
        const start = Date.now()
        const res = orig(...args)
        const ms = Date.now() - start
        if (ms > SLOW_MS) {
          try {
            require('../main/ipc/techLogs').logTech('warn', 'sqlite', `Query lenta (${ms}ms)`, sql.replace(/\s+/g, ' ').trim().slice(0, 400))
          } catch {}
        }
        return res
      }
    }
    return stmt
  }
}

function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'gestion.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  createTables(db)
  try { instrumentSlowQueries(db) } catch {}
  return db
}

module.exports = { getDB, initDB }
