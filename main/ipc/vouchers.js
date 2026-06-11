const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

function genCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  const year = new Date().getFullYear()
  return `VALE-${year}-${code}`
}

ipcMain.handle('voucher:list', (_, { page = 1, limit = 50, filter = 'all' } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = ''
  if (filter === 'active') where = "WHERE used=0 AND (expires_at='' OR expires_at IS NULL OR expires_at >= date('now'))"
  else if (filter === 'used') where = 'WHERE used=1'
  else if (filter === 'expired') where = "WHERE used=0 AND expires_at != '' AND expires_at < date('now')"

  const { count } = db.prepare(`SELECT COUNT(*) as count FROM vouchers ${where}`).get()
  const rows = db.prepare(`SELECT * FROM vouchers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset)
  return { vouchers: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('voucher:create', (_, { type, value, client_id, client_name, expires_at, conditions }) => {
  const db = getDB()
  if (!type || !['fixed', 'percent'].includes(type)) throw new Error('Tipo de vale inválido')
  if (!value || value <= 0) throw new Error('Valor inválido')
  if (type === 'percent' && value > 100) throw new Error('El porcentaje no puede superar 100%')

  // Generate unique code (retry up to 5 times)
  let code = null
  for (let i = 0; i < 5; i++) {
    const candidate = genCode()
    const existing = db.prepare('SELECT id FROM vouchers WHERE code=?').get(candidate)
    if (!existing) { code = candidate; break }
  }
  if (!code) throw new Error('No se pudo generar código único')

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO vouchers (code, type, value, client_id, client_name, expires_at, conditions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code, type, value, client_id || null, client_name || '', expires_at || '', conditions || '')

  return { id, code, type, value, client_id: client_id || null, client_name: client_name || '', expires_at: expires_at || '', conditions: conditions || '' }
})

ipcMain.handle('voucher:validate', (_, { code }) => {
  const db = getDB()
  if (!code) return { valid: false, message: 'Código vacío' }

  const v = db.prepare('SELECT * FROM vouchers WHERE code=?').get(code.trim().toUpperCase())
  if (!v) return { valid: false, message: 'Vale no encontrado' }
  if (v.used) return { valid: false, message: 'Este vale ya fue utilizado' }
  if (v.expires_at && v.expires_at !== '') {
    const exp = new Date(v.expires_at)
    if (!isNaN(exp.getTime()) && exp < new Date()) {
      return { valid: false, message: 'Vale vencido' }
    }
  }
  return { valid: true, voucher: v, message: 'Vale válido' }
})

ipcMain.handle('voucher:use', (_, { code, sale_id }) => {
  const db = getDB()
  const v = db.prepare('SELECT * FROM vouchers WHERE code=?').get(code)
  if (!v) throw new Error('Vale no encontrado')
  if (v.used) throw new Error('Vale ya utilizado')

  db.prepare("UPDATE vouchers SET used=1, used_at=CURRENT_TIMESTAMP, sale_id=? WHERE code=?")
    .run(sale_id || null, code)
  return { ok: true }
})

ipcMain.handle('voucher:delete', (_, id) => {
  const db = getDB()
  const v = db.prepare('SELECT * FROM vouchers WHERE id=?').get(id)
  if (!v) throw new Error('Vale no encontrado')
  if (v.used) throw new Error('No se puede eliminar un vale ya utilizado')
  db.prepare('DELETE FROM vouchers WHERE id=?').run(id)
  return { ok: true }
})
