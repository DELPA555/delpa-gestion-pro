const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

function nextRemitoNumber(db) {
  const year = new Date().getFullYear()
  const row = db.prepare(
    "SELECT number FROM remitos WHERE number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`REM-${year}-%`)
  if (!row) return `REM-${year}-0001`
  const last = parseInt(row.number.split('-')[2] || '0', 10)
  return `REM-${year}-${String(last + 1).padStart(4, '0')}`
}

ipcMain.handle('remito:list', (_, { page = 1, limit = 25, status = '' } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE 1=1'
  const params = []
  if (status) { where += ' AND status=?'; params.push(status) }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM remitos ${where}`).get(...params)
  const rows = db.prepare(
    `SELECT id,number,type,recipient,address,notes,status,created_at,delivered_at,
            json_array_length(items_json) as item_count
     FROM remitos ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)
  return { remitos: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('remito:get', (_, id) => {
  const db = getDB()
  const r = db.prepare('SELECT * FROM remitos WHERE id=?').get(id)
  if (!r) return null
  try { r.items = JSON.parse(r.items_json || '[]') } catch { r.items = [] }
  return r
})

ipcMain.handle('remito:create', (_, data) => {
  const db = getDB()
  const { type, recipient, address, items, notes, origin_sucursal_id, dest_sucursal_id } = data
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'Sin productos' }

  const run = db.transaction(() => {
    const number = nextRemitoNumber(db)
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO remitos (number,type,recipient,address,items_json,notes,status,origin_sucursal_id,dest_sucursal_id)
      VALUES (?,?,?,?,?,?,'pendiente',?,?)
    `).run(number, type || 'venta', recipient || '', address || '',
          JSON.stringify(items), notes || '',
          origin_sucursal_id || null, dest_sucursal_id || null)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('CREATE','remitos',?,?)`)
      .run(lastInsertRowid, `Remito ${number} creado`)
    return { id: lastInsertRowid, number }
  })

  const result = run()
  return { ok: true, ...result }
})

ipcMain.handle('remito:updateStatus', (_, { id, status, applyStock }) => {
  const db = getDB()
  const remito = db.prepare('SELECT * FROM remitos WHERE id=?').get(id)
  if (!remito) return { ok: false, error: 'Remito no encontrado' }

  const run = db.transaction(() => {
    const deliveredAt = status === 'entregado' ? new Date().toISOString() : null
    db.prepare('UPDATE remitos SET status=?,delivered_at=COALESCE(?,delivered_at) WHERE id=?')
      .run(status, deliveredAt, id)

    // Stock transfer: if transfer type and now delivered, apply stock changes
    if (status === 'entregado' && applyStock && remito.type === 'transferencia') {
      let items = []
      try { items = JSON.parse(remito.items_json || '[]') } catch {}
      for (const item of items) {
        const pid = item.product_id
        const sz = item.size
        const qty = Number(item.qty) || 0
        if (!pid || !sz || qty <= 0) continue
        // Deduct from origin
        if (remito.origin_sucursal_id) {
          db.prepare('UPDATE product_sizes SET stock=MAX(0,stock-?) WHERE product_id=? AND size=?')
            .run(qty, pid, sz)
        }
      }
    }

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('UPDATE','remitos',?,?)`)
      .run(id, `Remito ${remito.number} → ${status}`)
  })

  run()
  return { ok: true }
})

ipcMain.handle('remito:delete', (_, id) => {
  const db = getDB()
  db.prepare('DELETE FROM remitos WHERE id=?').run(id)
  return { ok: true }
})
