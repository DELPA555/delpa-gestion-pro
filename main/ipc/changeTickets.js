const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

function getSetting(db, key, def) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? def
}

function nextNumber(db) {
  const seq = (parseInt(getSetting(db, 'change_ticket_seq', '0'), 10) || 0) + 1
  db.prepare("UPDATE settings SET value=? WHERE key='change_ticket_seq'").run(String(seq))
  const year = new Date().getFullYear()
  return `CAM-${year}-${String(seq).padStart(4, '0')}`
}

// Crea un ticket de cambio individual por cada producto seleccionado.
// items: [{ product_id, product_name, size, color }]
ipcMain.handle('changeticket:createBatch', (_, { saleId, items }) => {
  const db = getDB()
  const days = parseInt(getSetting(db, 'change_ticket_days', '30'), 10) || 30
  const ins = db.prepare(`
    INSERT INTO change_tickets (number, sale_id, product_id, product_name, size, color, issued_at, expires_at, status)
    VALUES (?,?,?,?,?,?, datetime('now','localtime'), datetime('now','localtime',?), 'active')
  `)
  const tx = db.transaction((rows) => {
    const created = []
    for (const it of rows) {
      const number = nextNumber(db)
      const info = ins.run(number, saleId || null, it.product_id || null, it.product_name || '', it.size || '', it.color || '', `+${days} days`)
      const row = db.prepare('SELECT * FROM change_tickets WHERE id=?').get(info.lastInsertRowid)
      created.push(row)
    }
    return created
  })
  try {
    return { ok: true, tickets: tx(Array.isArray(items) ? items : []) }
  } catch (e) {
    console.error('[CHANGE-TICKET] createBatch error:', e.message)
    return { ok: false, error: e.message }
  }
})

// Busca un ticket por número y valida vigencia. Marca 'expired' si venció.
ipcMain.handle('changeticket:lookup', (_, { number }) => {
  const db = getDB()
  const t = db.prepare('SELECT * FROM change_tickets WHERE number=?').get((number || '').trim().toUpperCase())
  if (!t) return { ok: false, notFound: true, error: 'No existe un ticket de cambio con ese número.' }

  const now = new Date()
  const exp = t.expires_at ? new Date(t.expires_at.replace(' ', 'T')) : null
  const expired = exp && now > exp

  if (expired && t.status === 'active') {
    db.prepare("UPDATE change_tickets SET status='expired' WHERE id=?").run(t.id)
    t.status = 'expired'
  }

  if (t.status === 'used') return { ok: false, used: true, ticket: t, error: 'Este ticket de cambio ya fue utilizado.' }
  if (expired) {
    const f = exp.toLocaleDateString('es-AR')
    return { ok: false, expired: true, ticket: t, error: `Este ticket venció el ${f}. No es válido para cambio.` }
  }
  return { ok: true, ticket: t }
})

// Marca un ticket como usado (al concretar el cambio).
ipcMain.handle('changeticket:markUsed', (_, { number }) => {
  const db = getDB()
  try {
    db.prepare("UPDATE change_tickets SET status='used', used_at=datetime('now','localtime') WHERE number=? AND status='active'")
      .run((number || '').trim().toUpperCase())
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})
