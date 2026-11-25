/* Historial de movimientos de mercadería (v1.46.0).
 *
 * Solo LECTURA: las filas de stock_movements las escribe un trigger en product_sizes
 * (ver database/schema.js) cada vez que cambia el stock. Acá exponemos la consulta
 * con filtros (fecha, tipo, producto, categoría, texto) y los datos para los combos.
 * El Excel se arma en el renderer con lib/xlsx (se pide la lista con un límite alto).
 */
const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// Construye el WHERE y los parámetros a partir de los filtros recibidos.
function buildWhere(f = {}) {
  const where = []
  const params = []
  // Rango de fechas por día local (created_at se guarda en UTC, como el resto de la app).
  if (f.dateFrom) { where.push("date(sm.created_at, 'localtime') >= date(?)"); params.push(f.dateFrom) }
  if (f.dateTo)   { where.push("date(sm.created_at, 'localtime') <= date(?)"); params.push(f.dateTo) }
  if (f.tipo)     { where.push('sm.tipo = ?'); params.push(f.tipo) }
  if (f.productId){ where.push('sm.product_id = ?'); params.push(Number(f.productId)) }
  if (f.category) { where.push('p.category = ?'); params.push(f.category) }
  if (f.search) {
    where.push('(sm.product_name LIKE ? OR sm.size LIKE ? OR sm.detalle LIKE ? OR sm.usuario LIKE ?)')
    const q = `%${f.search}%`
    params.push(q, q, q, q)
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params }
}

ipcMain.handle('stockmov:list', (_, filters = {}) => {
  const db = getDB()
  const page  = Math.max(1, Number(filters.page) || 1)
  const limit = Math.min(100000, Math.max(1, Number(filters.limit) || 50))
  const offset = (page - 1) * limit
  const { sql, params } = buildWhere(filters)

  const { count } = db.prepare(
    `SELECT COUNT(*) as count FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id ${sql}`
  ).get(...params)

  const rows = db.prepare(
    `SELECT sm.id, sm.created_at, sm.tipo, sm.product_id, sm.product_name, sm.size,
            sm.color, sm.cantidad, sm.stock_anterior, sm.stock_nuevo,
            sm.referencia_id, sm.referencia_tipo, sm.usuario, sm.detalle,
            p.category AS category
     FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
     ${sql}
     ORDER BY sm.created_at DESC, sm.id DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset)

  return { rows, total: count, pages: Math.ceil(count / limit) }
})

// Datos para los combos de filtro: tipos presentes y categorías de productos.
ipcMain.handle('stockmov:filters', () => {
  const db = getDB()
  const tipos = db.prepare('SELECT DISTINCT tipo FROM stock_movements ORDER BY tipo').all().map(r => r.tipo)
  const categories = db.prepare(
    "SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND TRIM(category) <> '' ORDER BY category"
  ).all().map(r => r.category)
  return { tipos, categories }
})
