// ── main/ipc/informes.js ──────────────────────────────────────────────────────
// Motor de informes semanales/mensuales de DELPA Gestión PRO.
// - Recolecta datos ricos (ventas, ganancia neta, comparativas, stock, fiscal…)
// - Arma HTML con branding DELPA (fondo oscuro + acento rosa, gráficos en HTML)
// - Persiste cada informe en `saved_reports` para verlo offline desde la app
// - Programa el envío por email (día/hora configurables) con catch-up
//
// Canales IPC: informes:generate, informes:latest, informes:list, informes:get,
//              informes:send, informes:delete
// ------------------------------------------------------------------------------

const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

const TZ = 'America/Argentina/Buenos_Aires'
const ACCENT = '#e91e8c'

// ── Límites anuales Monotributo (espejo de fiscal.js) ─────────────────────────
const MONO_CATEGORIAS = {
  A: 2_960_000, B: 4_440_000, C: 6_210_000, D: 8_520_000, E: 10_720_000,
  F: 13_420_000, G: 16_870_000, H: 21_885_000, I: 26_260_000, J: 31_260_000, K: 36_760_000,
}

// ── Helpers de configuración ──────────────────────────────────────────────────

function getSetting(key, def = null) {
  try { return getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? def }
  catch { return def }
}
function setSetting(key, value) {
  try {
    const db = getDB()
    const r = db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(value), key)
    if (r.changes === 0) db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(key, String(value))
  } catch (e) { console.error('[DELPA] setSetting', key, e.message) }
}
function getEmailConfig() {
  const db = getDB()
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'email%' OR key='business_name' OR key LIKE 'report_%' OR key IN ('afip_cond_fiscal','mono_categoria','iva_alicuota')").all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

// ── Helpers de formato ────────────────────────────────────────────────────────

function fmtARS(v) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Math.round(v || 0))
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
const pad2 = n => String(n).padStart(2, '0')

// ── Helpers de fechas (en horario Argentina) ──────────────────────────────────

function argParts() {
  const p = new Intl.DateTimeFormat('en', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date())
  const g = t => p.find(x => x.type === t).value
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { y: +g('year'), m: +g('month'), d: +g('day'), dow: dowMap[g('weekday')], h: +g('hour') }
}
// 'YYYY-MM-DD' a partir de una fecha UTC "ancla" (mediodía) para evitar saltos de huso
function ymdFromUTC(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}` }
function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d, 12))
  base.setUTCDate(base.getUTCDate() + days)
  return ymdFromUTC(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate())
}
function argToday() { const { y, m, d } = argParts(); return ymdFromUTC(y, m, d) }

// Bordes del período según tipo y modo
function computePeriod(kind, mode) {
  const today = argToday()
  if (kind === 'week') {
    // current: últimos 7 días terminando hoy · baseline: los 7 anteriores
    const to = today, from = shiftYmd(today, -6)
    const baseTo = shiftYmd(from, -1), baseFrom = shiftYmd(baseTo, -6)
    return { from, to, baseFrom, baseTo, label: `${labelDate(from)} al ${labelDate(to)}` }
  }
  // month
  const { y, m } = argParts()
  const monthStart = (yy, mm) => ymdFromUTC(yy, mm, 1)
  const monthEnd = (yy, mm) => { const d = new Date(Date.UTC(yy, mm, 0, 12)); return ymdFromUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }
  if (mode === 'closed') {
    // mes calendario anterior completo
    const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
    const ppm = pm.m === 1 ? { y: pm.y - 1, m: 12 } : { y: pm.y, m: pm.m - 1 }
    return {
      from: monthStart(pm.y, pm.m), to: monthEnd(pm.y, pm.m),
      baseFrom: monthStart(ppm.y, ppm.m), baseTo: monthEnd(ppm.y, ppm.m),
      label: monthLabel(pm.y, pm.m), y: pm.y, m: pm.m,
    }
  }
  // current: del 1 al día de hoy · baseline: mes anterior completo
  const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  return {
    from: monthStart(y, m), to: today,
    baseFrom: monthStart(pm.y, pm.m), baseTo: monthEnd(pm.y, pm.m),
    label: monthLabel(y, m) + ' (al día de hoy)', y, m,
  }
}
function labelDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
function monthLabel(y, m) {
  return new Date(Date.UTC(y, m - 1, 1, 12)).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const DOW_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const CAT_EMOJI = (cat) => {
  const c = (cat || '').toLowerCase()
  if (/jean|pantal/.test(c)) return '👖'
  if (/remer|top|camis|blus/.test(c)) return '👚'
  if (/vestid/.test(c)) return '👗'
  if (/campera|abrig|saco|tapado/.test(c)) return '🧥'
  if (/calza|zapat|bota|sandal/.test(c)) return '👟'
  if (/short|berm/.test(c)) return '🩳'
  if (/bikini|malla|traje de baño/.test(c)) return '👙'
  if (/accesor|cinto|gorr|bufand|medi/.test(c)) return '🧣'
  if (/buzo|sweater|swater|hoodie/.test(c)) return '🧶'
  return '🛍️'
}

// ── Recolección de datos ──────────────────────────────────────────────────────

const CAE_FILTER = "cae IS NOT NULL AND cae != '' AND TRIM(cae) != ''"

function metricsFor(db, from, to) {
  const sales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as count,
           COALESCE(SUM(discount),0) as discount
    FROM sales WHERE voided=0 AND date(created_at,'localtime') BETWEEN ? AND ?
  `).get(from, to)
  const gross = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(si.profit,(si.unit_price - si.unit_cost)*si.quantity)),0) as profit,
           COALESCE(SUM(si.quantity),0) as units
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
  `).get(from, to)
  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total
    FROM expenses WHERE date(created_at,'localtime') BETWEEN ? AND ?
  `).get(from, to)
  return {
    revenue: sales.revenue, count: sales.count, discount: sales.discount,
    grossProfit: gross.profit, units: gross.units, expenses: expenses.total,
  }
}

function gatherData(kind, mode) {
  const db = getDB()
  const period = computePeriod(kind, mode)
  const { from, to, baseFrom, baseTo } = period

  const cur = metricsFor(db, from, to)
  const base = metricsFor(db, baseFrom, baseTo)

  // Gastos fijos (proporcionales para semana)
  const fixedMonthly = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM fixed_costs WHERE active=1').get().total
  const daysInPeriod = (Date.parse(to) - Date.parse(from)) / 86400000 + 1
  const fixedShare = kind === 'week' ? fixedMonthly * (daysInPeriod / 30) : fixedMonthly
  const netProfit = cur.grossProfit - cur.expenses - fixedShare
  const ticketAvg = cur.count > 0 ? cur.revenue / cur.count : 0
  const pctVar = base.revenue > 0 ? ((cur.revenue - base.revenue) / base.revenue * 100) : null

  // Ventas por día del período
  const byDayRows = db.prepare(`
    SELECT date(created_at,'localtime') as day,
           CAST(strftime('%w', created_at,'localtime') AS INTEGER) as dow,
           COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0 AND date(created_at,'localtime') BETWEEN ? AND ?
    GROUP BY day ORDER BY day
  `).all(from, to)
  const byDayMap = Object.fromEntries(byDayRows.map(r => [r.day, r]))

  // Serie de barras: para semana = 7 días; para mes = cada día del período
  const bars = []
  let cursor = from
  while (Date.parse(cursor) <= Date.parse(to)) {
    const r = byDayMap[cursor]
    const [yy, mm, dd] = cursor.split('-').map(Number)
    const dow = new Date(Date.UTC(yy, mm - 1, dd, 12)).getUTCDay()
    bars.push({
      day: cursor,
      label: kind === 'week' ? DOW_ES[dow] : String(dd),
      total: r?.total || 0, count: r?.count || 0,
    })
    cursor = shiftYmd(cursor, 1)
    if (bars.length > 62) break
  }
  const bestDay = bars.reduce((a, b) => (b.total > (a?.total || 0) ? b : a), null)
  const worstDay = bars.filter(b => b.total > 0).reduce((a, b) => (a === null || b.total < a.total ? b : a), null)

  // Top productos con comparativa de unidades vs baseline
  const topProducts = db.prepare(`
    SELECT si.product_id, p.name, p.category,
           SUM(si.quantity) as qty,
           SUM(COALESCE(si.net_price, si.quantity*si.unit_price)) as revenue
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY si.product_id ORDER BY qty DESC LIMIT ${kind === 'month' ? 10 : 5}
  `).all(from, to)
  const prevQty = db.prepare(`
    SELECT si.product_id, SUM(si.quantity) as qty
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY si.product_id
  `).all(baseFrom, baseTo)
  const prevQtyMap = Object.fromEntries(prevQty.map(r => [r.product_id, r.qty]))
  topProducts.forEach(p => { p.prevQty = prevQtyMap[p.product_id] || 0; p.deltaQty = p.qty - p.prevQty })

  // Top clientas con puntos ganados
  const topClients = db.prepare(`
    SELECT c.id, c.name, COUNT(*) as count, COALESCE(SUM(s.total),0) as total
    FROM sales s JOIN clients c ON c.id=s.client_id
    WHERE s.voided=0 AND s.client_id IS NOT NULL AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY s.client_id ORDER BY total DESC LIMIT 3
  `).all(from, to)
  topClients.forEach(c => {
    try {
      c.points = db.prepare(`SELECT COALESCE(SUM(amount),0) as p FROM client_points_log WHERE client_id=? AND amount>0 AND date(created_at,'localtime') BETWEEN ? AND ?`).get(c.id, from, to).p
    } catch { c.points = 0 }
  })

  // Nuevas clientas captadas
  const newClients = db.prepare(`
    SELECT COUNT(*) as c FROM clients WHERE date(created_at,'localtime') BETWEEN ? AND ?
  `).get(from, to).c

  // Clientas que compraron en el baseline pero no en el período (churn)
  const churn = db.prepare(`
    SELECT c.id, c.name, c.phone FROM clients c
    WHERE c.id IN (SELECT DISTINCT client_id FROM sales WHERE voided=0 AND client_id IS NOT NULL AND date(created_at,'localtime') BETWEEN ? AND ?)
      AND c.id NOT IN (SELECT DISTINCT client_id FROM sales WHERE voided=0 AND client_id IS NOT NULL AND date(created_at,'localtime') BETWEEN ? AND ?)
    ORDER BY c.total_spent DESC LIMIT 8
  `).all(baseFrom, baseTo, from, to)

  // Medios de pago
  const byPayment = db.prepare(`
    SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0 AND date(created_at,'localtime') BETWEEN ? AND ?
    GROUP BY payment_method ORDER BY total DESC
  `).all(from, to)

  // Gastos por categoría
  const expensesByCat = db.prepare(`
    SELECT COALESCE(NULLIF(category,''),'General') as category, COALESCE(SUM(amount),0) as total
    FROM expenses WHERE date(created_at,'localtime') BETWEEN ? AND ?
    GROUP BY category ORDER BY total DESC
  `).all(from, to)

  // Stock crítico con velocidad (últimos 30 días) → días de cobertura
  const velocity = db.prepare(`
    SELECT si.product_id, si.size, SUM(si.quantity) as q
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') >= date('now','localtime','-30 days')
    GROUP BY si.product_id, si.size
  `).all()
  const velMap = Object.fromEntries(velocity.map(r => [`${r.product_id}|${r.size}`, r.q / 30]))
  const stockRows = db.prepare(`
    SELECT p.id as product_id, p.name, ps.size, ps.stock
    FROM product_sizes ps JOIN products p ON p.id=ps.product_id
    WHERE p.active=1 AND ps.stock > 0
  `).all()
  const stockCritical = []
  for (const r of stockRows) {
    const v = velMap[`${r.product_id}|${r.size}`] || 0
    if (v <= 0) continue
    const daysLeft = r.stock / v
    if (daysLeft < 7) stockCritical.push({ ...r, perWeek: Math.round(v * 7 * 10) / 10, daysLeft: Math.round(daysLeft * 10) / 10, urgent: daysLeft < 3 })
  }
  stockCritical.sort((a, b) => a.daysLeft - b.daysLeft)

  // Capital inmovilizado (sin venta en 60 días)
  const deadStock = db.prepare(`
    SELECT COALESCE(SUM(p.cost*ps.stock),0) as capital, COUNT(*) as lineas
    FROM product_sizes ps JOIN products p ON p.id=ps.product_id
    WHERE p.active=1 AND ps.stock > 0
      AND p.id NOT IN (
        SELECT DISTINCT si.product_id FROM sale_items si JOIN sales s ON s.id=si.sale_id
        WHERE s.voided=0 AND date(s.created_at,'localtime') >= date('now','localtime','-60 days'))
  `).get()

  // Caja grande
  let mainCash = 0
  try {
    mainCash = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END),0) as bal FROM main_cashbox_movements`).get().bal
  } catch { mainCash = 0 }

  // Fiscal (facturación con CAE del período + acumulado anual)
  const { y } = argParts()
  const facturadoPeriodo = db.prepare(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as qty FROM sales WHERE voided=0 AND ${CAE_FILTER} AND date(created_at,'localtime') BETWEEN ? AND ?`).get(from, to)
  const facturadoAnio = db.prepare(`SELECT COALESCE(SUM(total),0) as total FROM sales WHERE voided=0 AND ${CAE_FILTER} AND strftime('%Y',created_at,'localtime')=?`).get(String(y)).total
  const regimen = getSetting('afip_cond_fiscal', 'MONO')
  const monoCat = getSetting('mono_categoria', 'C')
  const limAnual = MONO_CATEGORIAS[monoCat] || MONO_CATEGORIAS.C
  const pctAnio = limAnual > 0 ? (facturadoAnio / limAnual * 100) : 0
  const fiscal = {
    regimen, monoCat, facturadoPeriodo: facturadoPeriodo.total, facturasPeriodo: facturadoPeriodo.qty,
    facturadoAnio, limiteAnual: limAnual, pctAnio,
    alerta: pctAnio >= 95 ? 'roja' : pctAnio >= 80 ? 'amarilla' : 'ok',
  }

  const data = {
    kind, period, generatedAt: new Date().toISOString(),
    revenue: cur.revenue, count: cur.count, units: cur.units, discount: cur.discount,
    grossProfit: cur.grossProfit, expenses: cur.expenses, fixedShare, netProfit, ticketAvg,
    margin: cur.revenue > 0 ? (netProfit / cur.revenue * 100) : 0,
    pctVar, baseRevenue: base.revenue,
    bars, bestDay, worstDay,
    topProducts, topClients, newClients, churn,
    byPayment, expensesByCat, stockCritical, deadStock, mainCash, fiscal,
  }

  // Recomendaciones automáticas (máx 3)
  data.recommendations = buildRecommendations(data)

  // Extras del informe mensual
  if (kind === 'month') data.monthly = gatherMonthlyExtras(db, period)

  return data
}

function gatherMonthlyExtras(db, period) {
  const { from, to, y, m } = period
  // Rentabilidad por categoría
  const byCategory = db.prepare(`
    SELECT COALESCE(NULLIF(p.category,''),'Sin categoría') as category,
           SUM(COALESCE(si.net_price, si.quantity*si.unit_price)) as revenue,
           SUM(si.unit_cost*si.quantity) as cost,
           SUM(si.quantity) as qty
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY category ORDER BY revenue DESC LIMIT 12
  `).all(from, to)
  byCategory.forEach(c => { c.margin = c.revenue > 0 ? ((c.revenue - c.cost) / c.revenue * 100) : 0 })

  // Colores más vendidos
  let byColor = []
  try {
    byColor = db.prepare(`
      SELECT COALESCE(NULLIF(p.color,''),'Sin color') as color, SUM(si.quantity) as qty,
             SUM(COALESCE(si.net_price, si.quantity*si.unit_price)) as revenue
      FROM sale_items si JOIN sales s ON s.id=si.sale_id
      LEFT JOIN products p ON p.id=si.product_id
      WHERE s.voided=0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
      GROUP BY color ORDER BY qty DESC LIMIT 8
    `).all(from, to)
  } catch { byColor = [] }

  // Ranking de vendedoras
  const sellers = db.prepare(`
    SELECT seller_name, COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0 AND seller_name != '' AND date(created_at,'localtime') BETWEEN ? AND ?
    GROUP BY seller_name ORDER BY total DESC LIMIT 10
  `).all(from, to)

  // Mismo mes del año anterior
  const sameMonthLastYear = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0 AND strftime('%Y-%m',created_at,'localtime')=?
  `).get(`${y - 1}-${pad2(m)}`)

  // Evolución ticket promedio últimos 6 meses
  const ticket6m = db.prepare(`
    SELECT strftime('%Y-%m',created_at,'localtime') as ym,
           COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0 AND created_at >= date('now','localtime','-6 months')
    GROUP BY ym ORDER BY ym
  `).all().map(r => ({ ym: r.ym, ticket: r.count > 0 ? r.total / r.count : 0, total: r.total, count: r.count }))

  // Proyección próximo mes (promedio de 3 últimos meses cerrados)
  const last3 = db.prepare(`
    SELECT strftime('%Y-%m',created_at,'localtime') as ym, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND strftime('%Y-%m',created_at,'localtime') < strftime('%Y-%m','now','localtime')
    GROUP BY ym ORDER BY ym DESC LIMIT 3
  `).all()
  const projection = last3.length ? last3.reduce((s, r) => s + r.total, 0) / last3.length : 0

  return { byCategory, byColor, sellers, sameMonthLastYear, ticket6m, projection }
}

function buildRecommendations(data) {
  const recs = []
  // 1. Reposición de stock crítico
  for (const s of data.stockCritical.slice(0, 2)) {
    recs.push({
      icon: s.urgent ? '🔴' : '🟡',
      text: `Reponer <b>${esc(s.name)} T.${esc(s.size)}</b> — quedan ${s.stock} u. y se venden ~${s.perWeek}/semana (${s.daysLeft} días de stock).`,
    })
  }
  // 2. Churn de clientas
  if (data.churn.length >= 3) {
    recs.push({
      icon: '📞',
      text: `Contactá a <b>${data.churn.length} clienta${data.churn.length !== 1 ? 's' : ''}</b> que compraron el período anterior y no volvieron${data.churn[0] ? ` (ej: ${esc(data.churn[0].name)})` : ''}.`,
    })
  }
  // 3. Capital inmovilizado
  if (data.deadStock.capital > 0 && data.deadStock.lineas >= 3) {
    recs.push({
      icon: '📦',
      text: `Tenés <b>${fmtARS(data.deadStock.capital)}</b> inmovilizados en ${data.deadStock.lineas} productos sin venta hace 60 días. Considerá una promo o remito.`,
    })
  }
  // 4. Variación de ventas
  if (recs.length < 3 && data.pctVar !== null) {
    if (data.pctVar < -10) recs.push({ icon: '📉', text: `Las ventas cayeron <b>${Math.abs(data.pctVar).toFixed(0)}%</b> vs. el período anterior. Revisá promos y reposición de los más vendidos.` })
    else if (data.pctVar > 15) recs.push({ icon: '🚀', text: `Ventas <b>+${data.pctVar.toFixed(0)}%</b> vs. período anterior. Asegurá stock de los productos top para sostener el ritmo.` })
  }
  // 5. Margen bajo
  if (recs.length < 3 && data.revenue > 0 && data.margin < 15) {
    recs.push({ icon: '⚠️', text: `Margen neto en <b>${data.margin.toFixed(0)}%</b>. Revisá precios de venta o gastos para mejorar la rentabilidad.` })
  }
  return recs.slice(0, 3)
}

// ── Constructor de HTML ───────────────────────────────────────────────────────

function buildHTML(data, bizName) {
  const isMonth = data.kind === 'month'
  const kindLabel = isMonth ? 'Informe mensual' : 'Informe semanal'
  const varColor = data.pctVar === null ? '#8a8a8a' : data.pctVar >= 0 ? '#22c55e' : '#ef4444'
  const varArrow = data.pctVar === null ? '' : data.pctVar >= 0 ? '↑' : '↓'
  const varTxt = data.pctVar === null ? 'sin base de comparación' : `${varArrow} ${Math.abs(data.pctVar).toFixed(1)}% vs. período anterior`

  // Gráfico de barras (HTML puro)
  const maxBar = Math.max(...data.bars.map(b => b.total), 1)
  const barsHTML = data.bars.map(b => {
    const h = Math.max(2, Math.round(b.total / maxBar * 120))
    const isBest = data.bestDay && b.day === data.bestDay.day && b.total > 0
    return `<td style="vertical-align:bottom;text-align:center;padding:0 2px">
      <div style="font-size:9px;color:#9a9a9a;margin-bottom:3px;white-space:nowrap">${b.total > 0 ? fmtARS(b.total).replace('$', '') : ''}</div>
      <div style="height:${h}px;background:${isBest ? ACCENT : '#3a3a3a'};border-radius:3px 3px 0 0"></div>
      <div style="font-size:9px;color:#b8b8b8;margin-top:4px">${esc(b.label)}</div>
    </td>`
  }).join('')

  const kpi = (label, value, color = '#fff') =>
    `<td style="padding:14px 8px;text-align:center;background:#161616;border-radius:10px">
      <div style="font-size:19px;font-weight:800;color:${color};line-height:1.1">${value}</div>
      <div style="font-size:10px;color:#8a8a8a;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">${label}</div>
    </td>`

  const section = (title, inner) => `
    <tr><td style="padding:22px 26px 0">
      <div style="font-size:12px;font-weight:700;color:${ACCENT};text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #262626;padding-bottom:8px;margin-bottom:14px">${title}</div>
      ${inner}
    </td></tr>`

  const rowsTable = (headers, rows) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12.5px;color:#e5e5e5">
      <thead><tr>${headers.map((h, i) => `<th style="text-align:${i === 0 ? 'left' : 'right'};padding:6px 4px;color:#7a7a7a;font-size:10px;text-transform:uppercase;border-bottom:1px solid #262626">${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  // Secciones
  let sections = ''

  // 1. Resumen ejecutivo
  sections += section('Resumen ejecutivo', `
    <table width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate">
      <tr>
        ${kpi('Vendido', fmtARS(data.revenue), ACCENT)}
        ${kpi('Ganancia neta', fmtARS(data.netProfit), data.netProfit >= 0 ? '#22c55e' : '#ef4444')}
        ${kpi('Ticket promedio', fmtARS(data.ticketAvg))}
      </tr>
      <tr>
        ${kpi('Transacciones', data.count)}
        ${kpi('Unidades', data.units)}
        ${kpi('Margen', `${data.margin.toFixed(1)}%`, data.margin >= 0 ? '#22c55e' : '#ef4444')}
      </tr>
    </table>
    <div style="margin-top:12px;font-size:12.5px;color:${varColor};font-weight:600">${varTxt}</div>
    <div style="margin-top:6px;display:flex;gap:16px;font-size:11.5px;color:#9a9a9a">
      ${data.bestDay && data.bestDay.total > 0 ? `<span>🟢 Mejor día: <b style="color:#e5e5e5">${labelDate(data.bestDay.day)}</b> (${fmtARS(data.bestDay.total)})</span>` : ''}
      ${data.worstDay && data.worstDay.total > 0 && data.worstDay.day !== data.bestDay?.day ? `<span>🔻 Día más flojo: <b style="color:#e5e5e5">${labelDate(data.worstDay.day)}</b> (${fmtARS(data.worstDay.total)})</span>` : ''}
    </div>`)

  // 2. Gráfico de barras
  sections += section(isMonth ? 'Ventas por día del mes' : 'Ventas por día', `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${barsHTML}</tr></table>`)

  // 3. Top productos
  if (data.topProducts.length) {
    const rows = data.topProducts.map(p => {
      const delta = p.deltaQty > 0 ? `<span style="color:#22c55e">▲${p.deltaQty}</span>` : p.deltaQty < 0 ? `<span style="color:#ef4444">▼${Math.abs(p.deltaQty)}</span>` : `<span style="color:#6a6a6a">=</span>`
      return `<tr>
        <td style="padding:7px 4px;border-bottom:1px solid #1c1c1c">${CAT_EMOJI(p.category)} ${esc(p.name || 'Producto')}</td>
        <td style="padding:7px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${p.qty} ${delta}</td>
        <td style="padding:7px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#fff">${fmtARS(p.revenue)}</td>
      </tr>`
    }).join('')
    sections += section(`Top ${data.topProducts.length} productos`, rowsTable(['Producto', 'Unid. (vs ant.)', 'Ingresos'], rows))
  }

  // 4. Clientas
  if (data.topClients.length || data.newClients || data.churn.length) {
    let inner = ''
    if (data.topClients.length) {
      const rows = data.topClients.map(c => `<tr>
        <td style="padding:7px 4px;border-bottom:1px solid #1c1c1c">👤 ${esc(c.name)}</td>
        <td style="padding:7px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${c.count} compra${c.count !== 1 ? 's' : ''}</td>
        <td style="padding:7px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${c.points || 0} pts</td>
        <td style="padding:7px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#fff">${fmtARS(c.total)}</td>
      </tr>`).join('')
      inner += rowsTable(['Clienta', 'Compras', 'Puntos', 'Total'], rows)
    }
    inner += `<div style="margin-top:12px;display:flex;gap:20px;font-size:12px;color:#c5c5c5">
      <span>✨ Nuevas clientas: <b style="color:${ACCENT}">${data.newClients}</b></span>
      <span>😴 No volvieron: <b style="color:#f59e0b">${data.churn.length}</b></span>
    </div>`
    sections += section('Clientas', inner)
  }

  // 5. Stock crítico
  if (data.stockCritical.length || data.deadStock.capital > 0) {
    let inner = ''
    const urgent = data.stockCritical.filter(s => s.urgent).slice(0, 8)
    const warn = data.stockCritical.filter(s => !s.urgent).slice(0, 8)
    if (urgent.length) {
      inner += `<div style="font-size:11px;color:#ef4444;font-weight:700;margin-bottom:6px">URGENTE — menos de 3 días de stock</div>` +
        rowsTable(['Producto', 'Stock', 'Días'], urgent.map(s => `<tr>
          <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${esc(s.name)} T.${esc(s.size)}</td>
          <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#ef4444">${s.stock} u.</td>
          <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${s.daysLeft}</td></tr>`).join(''))
    }
    if (warn.length) {
      inner += `<div style="font-size:11px;color:#f59e0b;font-weight:700;margin:12px 0 6px">ATENCIÓN — menos de 7 días de stock</div>` +
        rowsTable(['Producto', 'Stock', 'Días'], warn.map(s => `<tr>
          <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${esc(s.name)} T.${esc(s.size)}</td>
          <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#f59e0b">${s.stock} u.</td>
          <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${s.daysLeft}</td></tr>`).join(''))
    }
    if (data.deadStock.capital > 0) {
      inner += `<div style="margin-top:12px;font-size:12px;color:#c5c5c5">💰 Capital inmovilizado (sin rotación 60 días): <b style="color:#f59e0b">${fmtARS(data.deadStock.capital)}</b> en ${data.deadStock.lineas} productos.</div>`
    }
    sections += section('Stock crítico', inner)
  }

  // 6. Caja y pagos
  {
    const payRows = data.byPayment.map(p => `<tr>
      <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${esc(p.payment_method)}</td>
      <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${p.count}</td>
      <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#fff">${fmtARS(p.total)}</td></tr>`).join('')
    const expRows = data.expensesByCat.map(e => `<tr>
      <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${esc(e.category)}</td>
      <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#ef4444">${fmtARS(e.total)}</td></tr>`).join('')
    let inner = payRows ? rowsTable(['Medio de pago', 'Ventas', 'Monto'], payRows) : '<div style="color:#8a8a8a;font-size:12px">Sin ventas en el período.</div>'
    if (expRows) inner += `<div style="font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">Gastos por categoría</div>` + rowsTable(['Categoría', 'Total'], expRows)
    inner += `<div style="margin-top:12px;font-size:12.5px;color:#c5c5c5">🏦 Saldo Caja Grande: <b style="color:${ACCENT}">${fmtARS(data.mainCash)}</b></div>`
    sections += section('Caja y pagos', inner)
  }

  // 7. Fiscal
  {
    const f = data.fiscal
    const barColor = f.alerta === 'roja' ? '#ef4444' : f.alerta === 'amarilla' ? '#f59e0b' : '#22c55e'
    let inner = `<div style="font-size:12.5px;color:#c5c5c5;margin-bottom:10px">
      Facturado con CAE en el período: <b style="color:#fff">${fmtARS(f.facturadoPeriodo)}</b> (${f.facturasPeriodo} comprobante${f.facturasPeriodo !== 1 ? 's' : ''})
    </div>`
    if (f.regimen === 'MONO') {
      inner += `<div style="font-size:12px;color:#9a9a9a;margin-bottom:6px">Monotributo Cat. ${esc(f.monoCat)} — ${f.pctAnio.toFixed(1)}% del límite anual (${fmtARS(f.facturadoAnio)} / ${fmtARS(f.limiteAnual)})</div>
        <div style="height:10px;background:#262626;border-radius:6px;overflow:hidden"><div style="height:10px;width:${Math.min(100, f.pctAnio)}%;background:${barColor}"></div></div>`
      if (f.alerta === 'roja') inner += `<div style="margin-top:8px;font-size:12px;color:#ef4444">⚠ Superaste el 95% del límite anual. Consultá recategorización.</div>`
      else if (f.alerta === 'amarilla') inner += `<div style="margin-top:8px;font-size:12px;color:#f59e0b">Atención: pasaste el 80% del límite anual de monotributo.</div>`
    }
    sections += section('Fiscal', inner)
  }

  // Secciones extra del mensual
  if (isMonth && data.monthly) {
    const mo = data.monthly
    if (mo.byCategory.length) {
      const rows = mo.byCategory.map(c => `<tr>
        <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${esc(c.category)}</td>
        <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${fmtARS(c.revenue)}</td>
        <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:${c.margin >= 0 ? '#22c55e' : '#ef4444'}">${c.margin.toFixed(0)}%</td></tr>`).join('')
      sections += section('Rentabilidad por categoría', rowsTable(['Categoría', 'Ingresos', 'Margen'], rows))
    }
    if (mo.byColor.length) {
      const rows = mo.byColor.map(c => `<tr>
        <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${esc(c.color)}</td>
        <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${c.qty} u.</td>
        <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#fff">${fmtARS(c.revenue)}</td></tr>`).join('')
      sections += section('Colores más vendidos', rowsTable(['Color', 'Unidades', 'Ingresos'], rows))
    }
    if (mo.sellers.length) {
      const rows = mo.sellers.map((s, i) => `<tr>
        <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•'} ${esc(s.seller_name)}</td>
        <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${s.count}</td>
        <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#fff">${fmtARS(s.total)}</td></tr>`).join('')
      sections += section('Ranking de vendedoras', rowsTable(['Vendedora', 'Ventas', 'Total'], rows))
    }
    // Comparativa interanual + proyección
    {
      const ly = mo.sameMonthLastYear
      const interPct = ly.total > 0 ? ((data.revenue - ly.total) / ly.total * 100) : null
      let inner = ''
      if (ly.total > 0) inner += `<div style="font-size:12.5px;color:#c5c5c5;margin-bottom:8px">📅 Mismo mes año anterior: <b style="color:#fff">${fmtARS(ly.total)}</b> → ${interPct >= 0 ? '<span style="color:#22c55e">↑</span>' : '<span style="color:#ef4444">↓</span>'} <b style="color:${interPct >= 0 ? '#22c55e' : '#ef4444'}">${Math.abs(interPct).toFixed(1)}%</b></div>`
      else inner += `<div style="font-size:12px;color:#8a8a8a;margin-bottom:8px">📅 Sin datos del mismo mes del año anterior.</div>`
      inner += `<div style="font-size:12.5px;color:#c5c5c5">🔮 Proyección próximo mes (según tendencia): <b style="color:${ACCENT}">${fmtARS(mo.projection)}</b></div>`
      if (mo.ticket6m.length > 1) {
        inner += `<div style="font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">Ticket promedio — últimos 6 meses</div>`
        inner += rowsTable(['Mes', 'Ticket prom.', 'Ventas'], mo.ticket6m.map(t => `<tr>
          <td style="padding:6px 4px;border-bottom:1px solid #1c1c1c">${esc(t.ym)}</td>
          <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c;color:#fff">${fmtARS(t.ticket)}</td>
          <td style="padding:6px 4px;text-align:right;border-bottom:1px solid #1c1c1c">${t.count}</td></tr>`).join(''))
      }
      sections += section('Proyecciones y tendencia', inner)
    }
  }

  // 8. Recomendaciones
  if (data.recommendations.length) {
    const items = data.recommendations.map(r => `
      <div style="background:#161616;border-left:3px solid ${ACCENT};border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:8px;font-size:12.5px;color:#e5e5e5;line-height:1.5">${r.icon} ${r.text}</div>`).join('')
    sections += section('Recomendaciones', items)
  }

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(kindLabel)} ${esc(bizName)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 12px">
    <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#0f0f0f;border:1px solid #1f1f1f;border-radius:16px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#1a1a1a,#0f0f0f);padding:28px 26px;text-align:center;border-bottom:2px solid ${ACCENT}">
        <div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:1px">${esc(bizName)}</div>
        <div style="font-size:12px;color:${ACCENT};font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${esc(kindLabel)}</div>
        <div style="font-size:12px;color:#8a8a8a;margin-top:6px">${esc(data.period.label)}</div>
      </td></tr>
      ${sections}
      <tr><td style="padding:22px 26px;text-align:center;border-top:1px solid #1f1f1f;margin-top:12px">
        <div style="font-size:11px;color:#6a6a6a">Generado automáticamente por <b style="color:#9a9a9a">DELPA Gestión PRO</b></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

// ── Persistencia ──────────────────────────────────────────────────────────────

function saveReport(data, html, bizName) {
  const db = getDB()
  const title = `${data.kind === 'month' ? 'Informe mensual' : 'Informe semanal'} — ${data.period.label}`
  const info = db.prepare(`
    INSERT INTO saved_reports (kind, period_start, period_end, period_label, title, html, data_json)
    VALUES (?,?,?,?,?,?,?)
  `).run(data.kind, data.period.from, data.period.to, data.period.label, title, html, JSON.stringify(data))
  return info.lastInsertRowid
}

// ── Envío por email ───────────────────────────────────────────────────────────

async function createTransporter(cfg) {
  const nodemailer = require('nodemailer')
  return nodemailer.createTransport({
    host: (cfg.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
    port: parseInt(cfg.email_port || '587', 10),
    secure: cfg.email_port === '465',
    requireTLS: cfg.email_port !== '465',
    auth: { user: cfg.email_user || cfg.email_from, pass: cfg.email_pass },
    tls: { minVersion: 'TLSv1.2' },
  })
}

async function sendReportEmail(kind, reportId, html, label) {
  const cfg = getEmailConfig()
  const user = cfg.email_user || cfg.email_from
  if (!user || !cfg.email_pass) return { ok: false, error: 'Email no configurado' }
  const bizName = cfg.business_name || 'DELPA'
  const to = cfg.report_email_to || cfg.email_to || user
  const cc = (cfg.report_email_cc || '').trim()
  const transporter = await createTransporter(cfg)
  const subject = `${kind === 'month' ? 'Informe mensual' : 'Informe semanal'} ${bizName} — ${label}`
  await transporter.sendMail({ from: `"${bizName}" <${user}>`, to, cc: cc || undefined, subject, html })
  try {
    getDB().prepare('UPDATE saved_reports SET sent_at=CURRENT_TIMESTAMP, sent_to=? WHERE id=?')
      .run([to, cc].filter(Boolean).join(', '), reportId)
  } catch {}
  console.log(`[DELPA] ${subject} enviado a`, to, cc ? `(cc ${cc})` : '')
  return { ok: true, to, cc }
}

// Genera + guarda (y opcionalmente envía). mode: 'current' | 'closed'
async function generateAndMaybeSend(kind, { mode = 'current', send = false } = {}) {
  const cfg = getEmailConfig()
  const bizName = cfg.business_name || 'DELPA'
  const data = gatherData(kind, mode)
  const html = buildHTML(data, bizName)
  const id = saveReport(data, html, bizName)
  let sendResult = null
  if (send) sendResult = await sendReportEmail(kind, id, html, data.period.label)
  return { id, kind, html, data, sendResult }
}

// ── Scheduler (tick horario, configurable) ────────────────────────────────────

function argFireKeys() {
  const { y, m, d, dow, h } = argParts()
  // Semanal — día/hora configurables (default lunes=1, 19hs)
  const wDow = parseInt(getSetting('report_weekly_dow', '1'), 10)
  const wHour = parseInt(getSetting('report_weekly_hour', '19'), 10)
  // clave = lunes-ancla de la semana del último disparo que ya ocurrió
  const back = (dow - wDow + 7) % 7
  const wbase = new Date(Date.UTC(y, m - 1, d, 12))
  wbase.setUTCDate(wbase.getUTCDate() - back)
  if (back === 0 && h < wHour) wbase.setUTCDate(wbase.getUTCDate() - 7)
  const weeklyKey = ymdFromUTC(wbase.getUTCFullYear(), wbase.getUTCMonth() + 1, wbase.getUTCDate())
  // Mensual — día/hora configurables (default día 1, 19hs)
  const mDay = parseInt(getSetting('report_monthly_day', '1'), 10)
  const mHour = parseInt(getSetting('report_monthly_hour', '19'), 10)
  let monthlyKey
  if (d > mDay || (d === mDay && h >= mHour)) monthlyKey = `${y}-${pad2(m)}`
  else { const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }; monthlyKey = `${pm.y}-${pad2(pm.m)}` }
  return { weeklyKey, monthlyKey }
}

async function tick() {
  try {
    const cfg = getEmailConfig()
    if (!(cfg.email_user || cfg.email_from) || !cfg.email_pass) return
    const { weeklyKey, monthlyKey } = argFireKeys()

    if (getSetting('report_weekly_enabled', '1') === '1') {
      const stored = getSetting('weekly_last_sent')
      if (stored === null) setSetting('weekly_last_sent', weeklyKey) // sembrar sin enviar backlog
      else if (stored !== weeklyKey) {
        await generateAndMaybeSend('week', { mode: 'current', send: true })
        setSetting('weekly_last_sent', weeklyKey)
      }
    }
    if (getSetting('report_monthly_enabled', '1') === '1') {
      const stored = getSetting('monthly_last_sent')
      if (stored === null) setSetting('monthly_last_sent', monthlyKey)
      else if (stored !== monthlyKey) {
        await generateAndMaybeSend('month', { mode: 'closed', send: true })
        setSetting('monthly_last_sent', monthlyKey)
      }
    }
  } catch (e) { console.error('[DELPA] informes tick:', e.message) }
}

function scheduleInformes() {
  try {
    const cron = require('node-cron')
    // Cada hora en punto revisa si toca disparar (respeta día/hora configurados)
    cron.schedule('5 * * * *', () => { tick() }, { timezone: TZ })
    // Catch-up al arrancar (por si la PC estuvo apagada en el disparo)
    setTimeout(() => { tick() }, 45000)
    console.log('[DELPA] Scheduler de informes activo (tick horario)')
  } catch (e) {
    console.error('[DELPA] node-cron no disponible para informes:', e.message)
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('informes:generate', async (_, { kind = 'week', mode } = {}) => {
  try {
    const m = mode || (kind === 'month' ? 'current' : 'current')
    const r = await generateAndMaybeSend(kind, { mode: m, send: false })
    return { ok: true, id: r.id, kind, html: r.html, label: r.data.period.label }
  } catch (e) { console.error('[DELPA] informes:generate', e); return { ok: false, error: e.message } }
})

ipcMain.handle('informes:send', async (_, { kind = 'week', id } = {}) => {
  try {
    if (id) {
      const row = getDB().prepare('SELECT * FROM saved_reports WHERE id=?').get(id)
      if (!row) return { ok: false, error: 'Informe no encontrado' }
      const res = await sendReportEmail(row.kind, row.id, row.html, row.period_label)
      return res
    }
    const r = await generateAndMaybeSend(kind, { mode: 'current', send: true })
    return r.sendResult || { ok: false, error: 'No se pudo enviar' }
  } catch (e) { console.error('[DELPA] informes:send', e); return { ok: false, error: e.message } }
})

ipcMain.handle('informes:latest', (_, kind = 'week') => {
  try {
    return getDB().prepare('SELECT * FROM saved_reports WHERE kind=? ORDER BY created_at DESC, id DESC LIMIT 1').get(kind) || null
  } catch (e) { return null }
})

ipcMain.handle('informes:list', (_, kind) => {
  try {
    const q = kind
      ? 'SELECT id, kind, period_label, title, created_at, sent_at, sent_to FROM saved_reports WHERE kind=? ORDER BY created_at DESC, id DESC LIMIT 40'
      : 'SELECT id, kind, period_label, title, created_at, sent_at, sent_to FROM saved_reports ORDER BY created_at DESC, id DESC LIMIT 40'
    return kind ? getDB().prepare(q).all(kind) : getDB().prepare(q).all()
  } catch (e) { return [] }
})

ipcMain.handle('informes:get', (_, id) => {
  try { return getDB().prepare('SELECT * FROM saved_reports WHERE id=?').get(id) || null }
  catch { return null }
})

ipcMain.handle('informes:delete', (_, id) => {
  try { getDB().prepare('DELETE FROM saved_reports WHERE id=?').run(id); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

module.exports = { scheduleInformes, generateAndMaybeSend, gatherData, buildHTML }
