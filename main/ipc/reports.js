const { ipcMain, dialog } = require('electron')
const { getDB } = require('../../database/db')
const fs = require('fs')

const defaultFrom = () => new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
const defaultTo = () => new Date().toISOString().split('T')[0]

ipcMain.handle('reports:salesByPeriod', (_, { from, to, groupBy = 'day' } = {}) => {
  const f = from || defaultFrom(), t = to || defaultTo()
  const expr = groupBy === 'month'
    ? "strftime('%Y-%m',created_at,'localtime')"
    : "date(created_at,'localtime')"
  return getDB().prepare(`
    SELECT ${expr} as period, SUM(total) as total, COUNT(*) as count,
           SUM(discount) as total_discount
    FROM sales WHERE voided=0
      AND date(created_at,'localtime') BETWEEN ? AND ?
    GROUP BY period ORDER BY period ASC
  `).all(f, t)
})

ipcMain.handle('reports:topProducts', (_, { from, to, limit = 20 } = {}) => {
  const f = from || defaultFrom(), t = to || defaultTo()
  return getDB().prepare(`
    SELECT si.product_name, si.product_id,
           SUM(si.quantity) as qty_sold,
           SUM(si.quantity*si.unit_price) as revenue,
           SUM(si.quantity*(si.unit_price-si.unit_cost)) as profit
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY si.product_id, si.product_name ORDER BY qty_sold DESC LIMIT ?
  `).all(f, t, limit)
})

ipcMain.handle('reports:profitability', (_, { from, to } = {}) => {
  const db = getDB()
  const f = from || defaultFrom(), t = to || defaultTo()
  const ventas = db.prepare(`
    SELECT COALESCE(SUM(s.total),0) as total_ventas,
           COALESCE(SUM(si.ganancia),0) as ganancia_bruta
    FROM sales s
    JOIN (SELECT sale_id, SUM((unit_price-unit_cost)*quantity) as ganancia FROM sale_items GROUP BY sale_id) si ON si.sale_id=s.id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
  `).get(f, t)
  const gastos = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date(created_at,'localtime') BETWEEN ? AND ?`).get(f, t)
  return { ...ventas, gastos: gastos.total, ganancia_neta: ventas.ganancia_bruta - gastos.total }
})

ipcMain.handle('reports:salesByCategory', (_, { from, to } = {}) => {
  const f = from || defaultFrom(), t = to || defaultTo()
  return getDB().prepare(`
    SELECT COALESCE(p.category,'Sin categoría') as category,
           SUM(si.quantity) as qty_sold,
           SUM(si.quantity*si.unit_price) as revenue,
           SUM(si.quantity*(si.unit_price-si.unit_cost)) as profit
    FROM sale_items si
    JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY category ORDER BY revenue DESC
  `).all(f, t)
})

ipcMain.handle('reports:salesByProduct', (_, { from, to } = {}) => {
  const f = from || defaultFrom(), t = to || defaultTo()
  return getDB().prepare(`
    SELECT si.product_name,
           COALESCE(p.color,'') as color,
           si.size,
           SUM(si.quantity) as qty_sold,
           AVG(si.unit_price) as avg_price,
           SUM(si.quantity * si.unit_price) as revenue,
           AVG(si.unit_cost) as avg_cost,
           SUM(si.quantity * (si.unit_price - si.unit_cost)) as profit
    FROM sale_items si
    JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY si.product_id, si.product_name, p.color, si.size
    ORDER BY revenue DESC
  `).all(f, t)
})

ipcMain.handle('reports:todaySalesDetail', () => {
  const db = getDB()
  const sales = db.prepare(`
    SELECT s.id, s.sale_number, s.total, s.payment_method, s.installments, s.surcharge_rate,
           s.created_at, s.seller_name, s.voided, c.name as client_name
    FROM sales s LEFT JOIN clients c ON c.id=s.client_id
    WHERE date(s.created_at,'localtime')=date('now','localtime')
    ORDER BY s.created_at DESC
  `).all()
  for (const s of sales)
    s.items = db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(s.id)
  return sales
})

ipcMain.handle('reports:commissions', (_, { from, to } = {}) => {
  const db = getDB()
  const f = from || defaultFrom(), t = to || defaultTo()

  // Sales grouped by seller in the period
  const rows = db.prepare(`
    SELECT seller_name, COUNT(*) as sale_count, SUM(total) as total_sold
    FROM sales
    WHERE voided=0 AND seller_name != ''
      AND date(created_at,'localtime') BETWEEN ? AND ?
    GROUP BY seller_name ORDER BY total_sold DESC
  `).all(f, t)

  const sellerRows = db.prepare('SELECT name, commission_rate FROM sellers WHERE active=1').all()
  const rateMap = {}
  for (const s of sellerRows) rateMap[s.name] = Number(s.commission_rate || 0)

  return rows.map(r => ({
    seller_name: r.seller_name,
    sale_count: r.sale_count,
    total_sold: r.total_sold,
    commission_rate: rateMap[r.seller_name] ?? 0,
    commission_amount: r.total_sold * (rateMap[r.seller_name] ?? 0) / 100,
  }))
})

ipcMain.handle('reports:exportCSV', async (_, { from, to, type = 'sales' } = {}) => {
  const f = from || defaultFrom(), t = to || defaultTo()
  const db = getDB()

  const { filePath } = await dialog.showSaveDialog({
    title: 'Exportar CSV',
    defaultPath: `reporte_${type}_${f}_${t}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (!filePath) return null

  let rows, headers
  if (type === 'products') {
    rows = db.prepare(`
      SELECT si.product_name, COALESCE(p.category,'Sin cat.') as categoria,
             SUM(si.quantity) as cantidad,
             SUM(si.quantity*si.unit_price) as ingresos,
             SUM(si.quantity*(si.unit_price-si.unit_cost)) as ganancia
      FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id
      WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
      GROUP BY si.product_name ORDER BY ingresos DESC
    `).all(f, t)
    headers = ['Producto', 'Categoría', 'Cantidad', 'Ingresos', 'Ganancia']
  } else {
    rows = db.prepare(`
      SELECT s.id, s.created_at, COALESCE(c.name,'—') as cliente,
             s.payment_method, s.subtotal, s.discount, s.total,
             s.seller_name, s.voucher_type, s.installments
      FROM sales s LEFT JOIN clients c ON c.id=s.client_id
      WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
      ORDER BY s.created_at DESC
    `).all(f, t)
    headers = ['ID', 'Fecha', 'Cliente', 'Medio de pago', 'Subtotal', 'Descuento', 'Total', 'Vendedora', 'Tipo comprobante', 'Cuotas']
  }

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [headers.join(','), ...rows.map(r => Object.values(r).map(esc).join(','))].join('\n')
  fs.writeFileSync(filePath, '﻿' + csv, 'utf8')
  return filePath
})

// ── Ranking de productos ───────────────────────────────────────────────────────
ipcMain.handle('reports:rankingProductos', (_, { from, to, category, limit = 20 } = {}) => {
  const db = getDB()
  const f = from || defaultFrom(), t = to || defaultTo()

  let where = 's.voided=0 AND date(s.created_at,\'localtime\') BETWEEN ? AND ?'
  const params = [f, t]
  if (category) { where += ' AND p.category=?'; params.push(category) }

  const rows = db.prepare(`
    SELECT si.product_id, si.product_name,
           COALESCE(p.category,'Sin categoría') as category,
           SUM(si.quantity) as qty_sold,
           SUM(si.quantity * si.unit_price) as revenue,
           SUM(si.quantity * (si.unit_price - si.unit_cost)) as profit
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE ${where}
    GROUP BY si.product_id, si.product_name
    ORDER BY qty_sold DESC
    LIMIT ?
  `).all(...params, limit)

  const total_units = rows.reduce((s, r) => s + r.qty_sold, 0)
  const total_rev   = rows.reduce((s, r) => s + r.revenue, 0)
  return rows.map((r, i) => ({
    ...r,
    rank: i + 1,
    pct_units: total_units > 0 ? (r.qty_sold / total_units * 100).toFixed(1) : '0',
    pct_revenue: total_rev > 0 ? (r.revenue / total_rev * 100).toFixed(1) : '0',
  }))
})

// Período anterior para comparativa
ipcMain.handle('reports:rankingPrev', (_, { from, to, category, limit = 20 } = {}) => {
  const db = getDB()
  const f = new Date(from), t = new Date(to)
  const diff = t - f
  const pf = new Date(f - diff).toISOString().split('T')[0]
  const pt = new Date(f - 1).toISOString().split('T')[0]

  let where = 's.voided=0 AND date(s.created_at,\'localtime\') BETWEEN ? AND ?'
  const params = [pf, pt]
  if (category) { where += ' AND p.category=?'; params.push(category) }

  return db.prepare(`
    SELECT si.product_id, SUM(si.quantity) as qty_sold,
           SUM(si.quantity * si.unit_price) as revenue
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE ${where}
    GROUP BY si.product_id ORDER BY qty_sold DESC LIMIT ?
  `).all(...params, limit)
})

// ── Análisis de colores ────────────────────────────────────────────────────────
ipcMain.handle('reports:colorAnalysis', (_, { from, to, category } = {}) => {
  const db = getDB()
  const f = from || defaultFrom(), t = to || defaultTo()

  let where = 's.voided=0 AND date(s.created_at,\'localtime\') BETWEEN ? AND ?'
  const params = [f, t]
  if (category) { where += ' AND p.category=?'; params.push(category) }

  const rows = db.prepare(`
    SELECT COALESCE(NULLIF(p.color,''),'Sin color') as color,
           SUM(si.quantity) as qty_sold,
           SUM(si.quantity * si.unit_price) as revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE ${where}
    GROUP BY color ORDER BY qty_sold DESC
  `).all(...params)

  const total = rows.reduce((s, r) => s + r.qty_sold, 0)
  return rows.map(r => ({
    ...r,
    pct: total > 0 ? (r.qty_sold / total * 100).toFixed(1) : '0',
  }))
})

// ── Deudas y cuentas corrientes ────────────────────────────────────────────────
ipcMain.handle('reports:clientDebt', () => {
  const db = getDB()
  const rows = db.prepare(`
    SELECT c.id, c.name, c.phone,
           c.balance as debt,
           MAX(s.created_at) as last_purchase
    FROM clients c
    LEFT JOIN sales s ON s.client_id = c.id AND s.voided = 0
    WHERE c.balance > 0 AND c.active = 1
    GROUP BY c.id
    ORDER BY c.balance DESC
  `).all()

  const now = Date.now()
  return rows.map(r => {
    const days = r.last_purchase
      ? Math.floor((now - new Date(r.last_purchase).getTime()) / 86400000)
      : 999
    return { ...r, days_since: days }
  })
})

// ── Historial de precios ───────────────────────────────────────────────────────
ipcMain.handle('reports:priceHistoryReport', (_, { from, to, productSearch } = {}) => {
  const db = getDB()
  const f = from || defaultFrom(), t = to || defaultTo()
  let where = 'date(ph.changed_at,\'localtime\') BETWEEN ? AND ?'
  const params = [f, t]
  if (productSearch) { where += ' AND ph.product_name LIKE ?'; params.push(`%${productSearch}%`) }
  return db.prepare(`
    SELECT ph.*, p.name as current_name, p.price as current_price
    FROM price_history ph
    LEFT JOIN products p ON p.id = ph.product_id
    WHERE ${where}
    ORDER BY ph.changed_at DESC
    LIMIT 200
  `).all(...params)
})

ipcMain.handle('reports:priceHistoryProduct', (_, { productId } = {}) => {
  if (!productId) return []
  return getDB().prepare(
    'SELECT * FROM price_history WHERE product_id=? ORDER BY changed_at ASC'
  ).all(productId)
})

// ── Sin movimiento ─────────────────────────────────────────────────────────────
ipcMain.handle('reports:sinMovimiento', (_, { days = 30 } = {}) => {
  const db = getDB()
  const rows = db.prepare(`
    SELECT p.id, p.name, COALESCE(p.category,'Sin categoría') as category,
           p.price, p.cost,
           COALESCE(SUM(ps.stock),0) as total_stock,
           last_q.last_sold,
           CASE
             WHEN last_q.last_sold IS NULL THEN 9999
             ELSE CAST(julianday('now','localtime') - julianday(last_q.last_sold,'localtime') AS INTEGER)
           END as days_inactive
    FROM products p
    LEFT JOIN product_sizes ps ON ps.product_id=p.id
    LEFT JOIN (
      SELECT si.product_id, MAX(date(s.created_at,'localtime')) as last_sold
      FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.voided=0
      GROUP BY si.product_id
    ) last_q ON last_q.product_id=p.id
    WHERE p.active=1
    GROUP BY p.id
    HAVING days_inactive >= ? AND total_stock > 0
    ORDER BY days_inactive DESC, total_stock DESC
  `).all(days)

  const total_capital = rows.reduce((s, r) => s + r.total_stock * (r.cost || 0), 0)
  return { rows, total_capital }
})

ipcMain.handle('reports:liquidarProductos', (_, { productIds, discountPct }) => {
  if (!Array.isArray(productIds) || productIds.length === 0) return { ok: false }
  const db = getDB()
  const pct = Math.max(0, Math.min(99, Number(discountPct) || 0))
  const upd = db.prepare('UPDATE products SET price=MAX(1, ROUND(price*(1.0-?/100.0))) WHERE id=?')
  const run = db.transaction(() => {
    for (const id of productIds) upd.run(pct, id)
  })
  run()
  return { ok: true, count: productIds.length, pct }
})

// ── Vendedoras ─────────────────────────────────────────────────────────────────
ipcMain.handle('reports:vendedoras', (_, { from, to } = {}) => {
  const db = getDB()
  const f = from || defaultFrom(), t = to || defaultTo()

  const sellers = db.prepare(`
    SELECT s.seller_name,
           COUNT(*) as sale_count,
           COALESCE(SUM(s.total),0) as total_sold,
           COALESCE(AVG(s.total),0) as avg_ticket
    FROM sales s
    WHERE s.voided=0 AND s.seller_name!=''
      AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY s.seller_name ORDER BY total_sold DESC
  `).all(f, t)

  const rateMap = {}
  try {
    for (const r of db.prepare('SELECT name,commission_rate FROM sellers WHERE active=1').all())
      rateMap[r.name] = Number(r.commission_rate || 0)
  } catch {}

  const bestDays = db.prepare(`
    SELECT seller_name, date_day, day_total FROM (
      SELECT s.seller_name, date(s.created_at,'localtime') as date_day,
             SUM(s.total) as day_total,
             ROW_NUMBER() OVER (PARTITION BY s.seller_name ORDER BY SUM(s.total) DESC) as rn
      FROM sales s WHERE s.voided=0 AND s.seller_name!=''
        AND date(s.created_at,'localtime') BETWEEN ? AND ?
      GROUP BY s.seller_name, date_day
    ) WHERE rn=1
  `).all(f, t)
  const bestDayMap = {}
  for (const r of bestDays) bestDayMap[r.seller_name] = { day: r.date_day, total: r.day_total }

  const topProducts = db.prepare(`
    SELECT seller_name, product_name, qty FROM (
      SELECT s.seller_name, si.product_name, SUM(si.quantity) as qty,
             ROW_NUMBER() OVER (PARTITION BY s.seller_name ORDER BY SUM(si.quantity) DESC) as rn
      FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE s.voided=0 AND s.seller_name!=''
        AND date(s.created_at,'localtime') BETWEEN ? AND ?
      GROUP BY s.seller_name, si.product_id, si.product_name
    ) WHERE rn=1
  `).all(f, t)
  const topProdMap = {}
  for (const r of topProducts) topProdMap[r.seller_name] = { name: r.product_name, qty: r.qty }

  return sellers.map(s => ({
    ...s,
    commission_rate: rateMap[s.seller_name] ?? 0,
    commission_amount: s.total_sold * (rateMap[s.seller_name] ?? 0) / 100,
    best_day: bestDayMap[s.seller_name] || null,
    top_product: topProdMap[s.seller_name] || null,
  }))
})

// ── Rentabilidad por categoría ─────────────────────────────────────────────────
ipcMain.handle('reports:rentabilidadCategorias', (_, { from, to } = {}) => {
  const db = getDB()
  const f = from || defaultFrom(), t = to || defaultTo()

  const catQuery = (ff, tt) => db.prepare(`
    SELECT COALESCE(p.category,'Sin categoría') as category,
           SUM(si.quantity) as units_sold,
           SUM(si.quantity*si.unit_price) as revenue,
           SUM(si.quantity*si.unit_cost) as total_cost,
           SUM(si.quantity*(si.unit_price-si.unit_cost)) as profit
    FROM sale_items si
    JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY category ORDER BY profit DESC
  `).all(ff, tt)

  const current = catQuery(f, t)

  const fDate = new Date(f), tDate = new Date(t)
  const diffMs = tDate - fDate
  const pf = new Date(fDate - diffMs - 86400000).toISOString().split('T')[0]
  const pt = new Date(fDate - 86400000).toISOString().split('T')[0]
  const prev = catQuery(pf, pt)
  const prevMap = {}
  for (const r of prev) prevMap[r.category] = r

  return current.map(r => {
    const margin = r.revenue > 0 ? (r.profit / r.revenue * 100) : 0
    const p = prevMap[r.category]
    const prev_profit = p?.profit || 0
    const trend = prev_profit === 0 ? null : ((r.profit - prev_profit) / Math.abs(prev_profit) * 100)
    return { ...r, margin, prev_profit, trend }
  })
})
