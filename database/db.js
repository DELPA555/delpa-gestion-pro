const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')
const { createTables } = require('./schema')

let db = null

function getDB() {
  if (!db) throw new Error('DB no inicializada. Llamar initDB() primero.')
  return db
}

function initDB() {
  const dbPath = path.join(app.getPath('userData'), 'gestion.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  createTables(db)
  return db
}

module.exports = { getDB, initDB }
