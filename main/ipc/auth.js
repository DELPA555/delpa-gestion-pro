const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')
const crypto = require('crypto')

let currentSession = null

function getSetting(db, key, def) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? def
}

function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(String(pass), salt, 100000, 64, 'sha512').toString('hex')
  return `pbkdf2:${salt}:${hash}`
}

function verifyPassword(pass, stored) {
  if (stored.startsWith('pbkdf2:')) {
    const [, salt, expected] = stored.split(':')
    const actual = crypto.pbkdf2Sync(String(pass), salt, 100000, 64, 'sha512').toString('hex')
    return actual === expected
  }
  // Legacy SHA256 — accepted on login, auto-upgraded below
  return crypto.createHash('sha256').update(String(pass)).digest('hex') === stored
}

ipcMain.handle('auth:login', (_, { username, password }) => {
  const db = getDB()
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username)
  if (!user) return { ok: false, error: 'Usuario no encontrado o inactivo' }
  if (!verifyPassword(password, user.password_hash)) return { ok: false, error: 'Contraseña incorrecta' }
  // Auto-upgrade legacy SHA256 hash to PBKDF2 on first successful login
  if (!user.password_hash.startsWith('pbkdf2:')) {
    try { db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), user.id) } catch {}
  }
  currentSession = { id: user.id, username: user.username, role: user.role, seller_name: user.seller_name || '', loginAt: Date.now(), lastActivity: Date.now() }
  // Persistir la sesión para restaurarla al reabrir la app sin pedir contraseña.
  try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('active_session_user',?)").run(String(user.id)) } catch {}
  try {
    db.prepare("INSERT INTO audit_log (action,module,entity_id,description) VALUES ('LOGIN','auth',?,?)")
      .run(user.id, `Inicio de sesión: ${user.username}`)
  } catch {}
  return { ok: true, user: currentSession }
})

ipcMain.handle('auth:logout', () => {
  const db = getDB()
  if (currentSession) {
    try {
      db.prepare("INSERT INTO audit_log (action,module,entity_id,description) VALUES ('LOGOUT','auth',?,?)")
        .run(currentSession.id, `Cierre de sesión: ${currentSession.username}`)
    } catch {}
  }
  try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('active_session_user','')").run() } catch {}
  currentSession = null
  return { ok: true }
})

// Reinicia el reloj de inactividad (lo llama el front ante actividad del usuario).
ipcMain.handle('auth:touch', () => {
  if (currentSession) currentSession.lastActivity = Date.now()
  return { ok: true }
})

ipcMain.handle('auth:lastUser', (_, username) => {
  // Called with username to save, or without to retrieve
  const db = getDB()
  if (username !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('last_username',?)").run(username || '')
    return { ok: true }
  }
  const row = db.prepare("SELECT value FROM settings WHERE key='last_username'").get()
  return { username: row?.value || '' }
})

ipcMain.handle('auth:session', () => {
  const db = getDB()

  // Restaurar la sesión persistida al reabrir la app (sin pedir contraseña).
  if (!currentSession) {
    const savedId = getSetting(db, 'active_session_user', '')
    if (savedId) {
      const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(Number(savedId))
      if (user) {
        currentSession = { id: user.id, username: user.username, role: user.role, seller_name: user.seller_name || '', loginAt: Date.now(), lastActivity: Date.now() }
      } else {
        try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('active_session_user','')").run() } catch {}
        return null
      }
    } else {
      return null
    }
  }

  // Si "Mantener sesión activa" está apagado, aplicar timeout por inactividad.
  const keep = getSetting(db, 'keep_session_active', '1')
  if (keep !== '1') {
    const timeoutMs = (parseInt(getSetting(db, 'session_timeout_minutes', '480'), 10) || 480) * 60 * 1000
    if (Date.now() - (currentSession.lastActivity || currentSession.loginAt) > timeoutMs) {
      try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('active_session_user','')").run() } catch {}
      currentSession = null
      return null
    }
  }
  return currentSession
})

ipcMain.handle('auth:users:list', () => {
  return getDB()
    .prepare('SELECT id, username, role, active, seller_name, created_at FROM users ORDER BY created_at ASC')
    .all()
})

ipcMain.handle('auth:users:create', (_, { username, password, role, seller_name }) => {
  try {
    const { lastInsertRowid } = getDB()
      .prepare('INSERT INTO users (username, password_hash, role, seller_name) VALUES (?,?,?,?)')
      .run(username.trim(), hashPassword(password), role || 'vendedor', seller_name || '')
    return { ok: true, id: lastInsertRowid }
  } catch {
    return { ok: false, error: 'El nombre de usuario ya existe' }
  }
})

ipcMain.handle('auth:users:update', (_, { id, username, role, active, seller_name }) => {
  const db = getDB()
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(id)
  if (!current) return { ok: false, error: 'Usuario no encontrado' }
  db.prepare('UPDATE users SET username=?, role=?, active=?, seller_name=? WHERE id=?')
    .run((username || current.username).trim(), role || current.role, active !== undefined ? (active ? 1 : 0) : current.active, seller_name !== undefined ? seller_name : current.seller_name, id)
  return { ok: true }
})

ipcMain.handle('auth:users:changePassword', (_, { id, password }) => {
  getDB().prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), id)
  return { ok: true }
})

ipcMain.handle('auth:users:delete', (_, id) => {
  // Prevent deleting the last admin
  const db = getDB()
  const admins = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin' AND active=1").get().c
  const target = db.prepare('SELECT role FROM users WHERE id=?').get(id)
  if (target?.role === 'admin' && admins <= 1) return { ok: false, error: 'No podés eliminar el único administrador' }
  db.prepare('DELETE FROM users WHERE id=?').run(id)
  return { ok: true }
})

module.exports = { getCurrentSession: () => currentSession }
