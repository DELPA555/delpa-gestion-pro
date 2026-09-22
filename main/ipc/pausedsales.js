const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

const MAX_PAUSED = 3

function parseRow(r) {
  let items = []
  try { items = JSON.parse(r.items_json || '[]') } catch { items = [] }
  return {
    id: r.id,
    items,
    itemCount: items.reduce((s, it) => s + (Number(it.qty) || 0), 0),
    client_id: r.client_id,
    client_name: r.client_name || '',
    discount: r.discount || 0,
    discount_type: r.discount_type || 'amount',
    payment_method: r.payment_method || 'Efectivo',
    total: r.total || 0,
    created_at: r.created_at,
  }
}

// Lista de ventas pausadas (más recientes primero)
ipcMain.handle('pausedsales:list', () => {
  const rows = getDB().prepare('SELECT * FROM paused_sales ORDER BY created_at DESC, id DESC').all()
  return rows.map(parseRow)
})

// Guardar una venta pausada (máximo MAX_PAUSED simultáneas)
ipcMain.handle('pausedsales:create', (_, data = {}) => {
  const db = getDB()
  const count = db.prepare('SELECT COUNT(*) as n FROM paused_sales').get().n
  if (count >= MAX_PAUSED) {
    return { ok: false, error: `Máximo ${MAX_PAUSED} ventas pausadas. Retomá o descartá alguna primero.` }
  }
  const items = Array.isArray(data.items) ? data.items : []
  if (items.length === 0) return { ok: false, error: 'El carrito está vacío' }
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO paused_sales (items_json, client_id, client_name, discount, discount_type, payment_method, total)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    JSON.stringify(items),
    data.client_id || null,
    data.client_name || '',
    Number(data.discount) || 0,
    data.discount_type || 'amount',
    data.payment_method || 'Efectivo',
    Number(data.total) || 0,
  )
  return { ok: true, id: lastInsertRowid }
})

// Eliminar una venta pausada (al retomar o descartar)
ipcMain.handle('pausedsales:delete', (_, id) => {
  getDB().prepare('DELETE FROM paused_sales WHERE id=?').run(id)
  return { ok: true }
})
