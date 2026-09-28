const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('dashboard:stats', () => {
  const db = getDB()
  const ventas = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime')
  `).get()
  const bruta = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(si.profit,(si.unit_price - si.unit_cost)*si.quantity)),0) as total
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime')=date('now','localtime')
  `).get()
  const gastos = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total
    FROM expenses WHERE date(created_at,'localtime')=date('now','localtime')
  `).get()
  const stock = db.prepare(`
    SELECT COALESCE(SUM(p.cost*ps.stock),0) as inversion,
           COALESCE(SUM(p.price*ps.stock),0) as potencial
    FROM products p JOIN product_sizes ps ON ps.product_id=p.id WHERE p.active=1
  `).get()
  const cuentas = db.prepare(`
    SELECT COALESCE(SUM(balance),0) as total FROM clients WHERE balance>0 AND active=1
  `).get()
  const unidades = db.prepare(`
    SELECT COALESCE(SUM(si.quantity),0) as total
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime')=date('now','localtime')
  `).get()
  // Ventas de ayer (para comparativa % día vs día)
  const ayer = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime','-1 day')
  `).get()
  // Clientes atendidos hoy (distintos, con cliente asociado)
  const clientesHoy = db.prepare(`
    SELECT COUNT(DISTINCT client_id) as c
    FROM sales WHERE voided=0 AND client_id IS NOT NULL
      AND date(created_at,'localtime')=date('now','localtime')
  `).get().c
  const ventasNeta = bruta.total - gastos.total
  const ticketPromedio = ventas.count > 0 ? ventas.total / ventas.count : 0
  const pctVsAyer = ayer.total > 0 ? ((ventas.total - ayer.total) / ayer.total * 100) : null
  const margenHoy = ventas.total > 0 ? (ventasNeta / ventas.total * 100) : 0
  return {
    ventas: ventas.total,
    cantidadVentas: ventas.count,
    gananciaBruta: bruta.total,
    gastos: gastos.total,
    gananciaNeta: ventasNeta,
    inversionStock: stock.inversion,
    ventaPotencial: stock.potencial,
    cuentasCorrientes: cuentas.total,
    unidadesHoy: unidades.total,
    ventasAyer: ayer.total,
    pctVsAyer,
    clientesHoy,
    ticketPromedio,
    margenHoy,
  }
})

// Top productos vendidos HOY (por defecto 8)
ipcMain.handle('dashboard:topProductsToday', (_, arg) => {
  const limit = Math.max(1, Math.min(50, Number(typeof arg === 'object' ? arg?.limit : arg) || 8))
  return getDB().prepare(`
    SELECT p.name, p.category, SUM(si.quantity) as qty,
           SUM(COALESCE(si.net_price, si.quantity*si.unit_price)) as revenue
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE s.voided=0 AND date(s.created_at,'localtime')=date('now','localtime')
    GROUP BY si.product_id ORDER BY qty DESC LIMIT ?
  `).all(limit)
})

// Últimas ventas (tiempo real, por defecto 8), con el producto principal de cada venta
ipcMain.handle('dashboard:recentSales', (_, arg) => {
  const db = getDB()
  const limit = Math.max(1, Math.min(50, Number(typeof arg === 'object' ? arg?.limit : arg) || 8))
  const rows = db.prepare(`
    SELECT s.id, s.total, s.payment_method, s.seller_name, s.created_at,
           c.name as client_name
    FROM sales s LEFT JOIN clients c ON c.id=s.client_id
    WHERE s.voided=0
    ORDER BY s.id DESC LIMIT ?
  `).all(limit)
  if (rows.length === 0) return rows
  // Producto principal (mayor cantidad) por venta, en una sola consulta
  const ids = rows.map(r => r.id)
  const ph = ids.map(() => '?').join(',')
  const items = db.prepare(`
    SELECT si.sale_id, p.name as product_name, si.quantity
    FROM sale_items si LEFT JOIN products p ON p.id=si.product_id
    WHERE si.sale_id IN (${ph})
    ORDER BY si.quantity DESC
  `).all(...ids)
  const mainItem = {}
  const countBySale = {}
  for (const it of items) {
    if (!mainItem[it.sale_id]) mainItem[it.sale_id] = it.product_name || 'Producto'
    countBySale[it.sale_id] = (countBySale[it.sale_id] || 0) + 1
  }
  return rows.map(r => ({ ...r, main_product: mainItem[r.id] || null, item_count: countBySale[r.id] || 0 }))
})

// Ventas por rango flexible (para el gráfico principal): ventana actual + ventana anterior alineada
ipcMain.handle('dashboard:salesRange', (_, arg) => {
  const db = getDB()
  const days = Math.max(1, Math.min(400, Number(typeof arg === 'object' ? arg?.days : arg) || 30))
  const rows = db.prepare(`
    SELECT date(created_at,'localtime') as day, COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0 AND created_at >= date('now','localtime',?)
    GROUP BY day
  `).all(`-${2 * days} days`)
  const map = Object.fromEntries(rows.map(r => [r.day, r]))
  // Lista de fechas alineada (más antigua → más nueva): día actual n y su equivalente n+days atrás
  const dateList = db.prepare(`
    WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM seq WHERE n < ?)
    SELECT date('now','localtime','-'||n||' days') as cur,
           date('now','localtime','-'||(n+?)||' days') as prev
    FROM seq ORDER BY n DESC
  `).all(days - 1, days)
  const data = dateList.map(({ cur, prev }) => ({
    day: cur,
    total: map[cur]?.total || 0,
    count: map[cur]?.count || 0,
    prevTotal: map[prev]?.total || 0,
    prevCount: map[prev]?.count || 0,
  }))
  const allTimeMax = db.prepare(`
    SELECT COALESCE(MAX(t),0) as m FROM (
      SELECT SUM(total) as t FROM sales WHERE voided=0 GROUP BY date(created_at,'localtime')
    )
  `).get().m
  return { days, data, allTimeMax }
})

// Extras en tiempo real: ventas por hora hoy, promedio neto 7d, promedio del día de semana,
// clientas de hoy (nuevas/recurrentes/top), puntos globales y altas de clientas.
ipcMain.handle('dashboard:realtimeExtras', () => {
  const db = getDB()

  const hourly = db.prepare(`
    SELECT CAST(strftime('%H', created_at,'localtime') AS INTEGER) as hour,
           COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime')
    GROUP BY hour ORDER BY hour
  `).all()

  // Promedio de ganancia NETA diaria de los últimos 7 días (sin contar hoy)
  const gross7 = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(si.profit,(si.unit_price - si.unit_cost)*si.quantity)),0) as gross
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0
      AND date(s.created_at,'localtime') >= date('now','localtime','-7 days')
      AND date(s.created_at,'localtime') <  date('now','localtime')
  `).get().gross
  const exp7 = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as t FROM expenses
    WHERE date(created_at,'localtime') >= date('now','localtime','-7 days')
      AND date(created_at,'localtime') <  date('now','localtime')
  `).get().t
  const avgNet7d = (gross7 - exp7) / 7

  // Promedio de ventas del MISMO día de la semana (hasta 8 ocurrencias previas)
  const weekdayRows = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND strftime('%w',created_at,'localtime')=strftime('%w','now','localtime')
      AND date(created_at,'localtime') < date('now','localtime')
    GROUP BY date(created_at,'localtime')
    ORDER BY date(created_at,'localtime') DESC LIMIT 8
  `).all()
  const weekdayAvg = weekdayRows.length > 0
    ? weekdayRows.reduce((s, r) => s + r.total, 0) / weekdayRows.length : 0

  // Clientas de hoy (con cliente asociado): nuevas vs recurrentes + mayor compra
  const clientsToday = db.prepare(`
    SELECT c.id, c.name, COALESCE(SUM(s.total),0) as total,
           CASE WHEN date(c.created_at,'localtime')=date('now','localtime') THEN 1 ELSE 0 END as is_new
    FROM sales s JOIN clients c ON c.id=s.client_id
    WHERE s.voided=0 AND s.client_id IS NOT NULL
      AND date(s.created_at,'localtime')=date('now','localtime')
    GROUP BY c.id ORDER BY total DESC
  `).all()
  const nuevas = clientsToday.filter(c => c.is_new).length
  const topBuyer = clientsToday[0] ? { name: clientsToday[0].name, total: clientsToday[0].total } : null

  // Puntos globales activos y por vencer este mes
  const puntos = db.prepare(`SELECT COALESCE(SUM(points),0) as active FROM clients WHERE active=1`).get().active
  const puntosPorVencer = db.prepare(`
    SELECT COALESCE(SUM(points),0) as t FROM clients
    WHERE active=1 AND points>0 AND points_expires_at IS NOT NULL
      AND strftime('%Y-%m', points_expires_at)=strftime('%Y-%m','now','localtime')
  `).get().t

  // Altas de clientas este mes vs mes anterior
  const newClientsThis = db.prepare(`
    SELECT COUNT(*) as n FROM clients WHERE active=1
      AND strftime('%Y-%m', created_at,'localtime')=strftime('%Y-%m','now','localtime')
  `).get().n
  const newClientsPrev = db.prepare(`
    SELECT COUNT(*) as n FROM clients WHERE active=1
      AND strftime('%Y-%m', created_at,'localtime')=strftime('%Y-%m','now','localtime','-1 month')
  `).get().n

  return {
    hourly,
    avgNet7d,
    weekdayAvg,
    clientes: { atendidas: clientsToday.length, nuevas, recurrentes: clientsToday.length - nuevas, topBuyer },
    puntos: { active: puntos, porVencer: puntosPorVencer },
    nuevasClientas: { esteMes: newClientsThis, mesAnterior: newClientsPrev },
  }
})

// Top 3 clientas del mes con puntos
ipcMain.handle('dashboard:topClientsMonth', () => {
  const db = getDB()
  const rows = db.prepare(`
    SELECT c.id, c.name, c.points, COUNT(*) as count, COALESCE(SUM(s.total),0) as total
    FROM sales s JOIN clients c ON c.id=s.client_id
    WHERE s.voided=0 AND s.client_id IS NOT NULL
      AND strftime('%Y-%m',s.created_at,'localtime')=strftime('%Y-%m','now','localtime')
    GROUP BY s.client_id ORDER BY total DESC LIMIT 5
  `).all()
  return rows
})

// Clientes con deuda (cuenta corriente) — top con teléfono para WhatsApp
ipcMain.handle('dashboard:overdueDebt', () =>
  getDB().prepare(`
    SELECT id, name, phone, balance
    FROM clients WHERE balance > 0 AND active=1
    ORDER BY balance DESC LIMIT 3
  `).all()
)

ipcMain.handle('dashboard:salesTrend', () =>
  getDB().prepare(`
    SELECT date(created_at,'localtime') as day,
           SUM(total) as total, COUNT(*) as count
    FROM sales WHERE voided=0
      AND created_at >= date('now','localtime','-30 days')
    GROUP BY date(created_at,'localtime') ORDER BY day ASC
  `).all()
)

// Ventas LOCALES por período (day/week/month) para la comparativa por canal
ipcMain.handle('dashboard:localSalesPeriod', (_, period = 'day') => {
  const db = getDB()
  let where
  if (period === 'week') where = "created_at >= datetime('now','localtime','-7 days')"
  else if (period === 'month') where = "strftime('%Y-%m',created_at,'localtime')=strftime('%Y-%m','now','localtime')"
  else where = "date(created_at,'localtime')=date('now','localtime')"
  const r = db.prepare(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales WHERE voided=0 AND ${where}`).get()
  return { total: r.total, count: r.count }
})

ipcMain.handle('dashboard:salesByPayment', () =>
  getDB().prepare(`
    SELECT payment_method, COUNT(*) as count, SUM(total) as total
    FROM sales WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime')
    GROUP BY payment_method
  `).all()
)

ipcMain.handle('dashboard:lowStock', () =>
  getDB().prepare(`
    SELECT p.id, p.name, p.barcode, ps.size, ps.stock, ps.min_stock
    FROM product_sizes ps JOIN products p ON p.id=ps.product_id
    WHERE ps.stock <= ps.min_stock AND ps.min_stock > 0 AND p.active=1
    ORDER BY ps.stock ASC, p.name ASC LIMIT 60
  `).all()
)

ipcMain.handle('dashboard:weekComparison', () =>
  getDB().prepare(`
    SELECT date(created_at,'localtime') as day,
           COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0
      AND created_at >= date('now','localtime','-14 days')
    GROUP BY date(created_at,'localtime') ORDER BY day ASC
  `).all()
)

// ── Comparativa mensual día a día: este mes vs mes anterior ───────────────────
ipcMain.handle('dashboard:monthComparison', () => {
  const db = getDB()

  // Este mes
  const thisMo = db.prepare(`
    SELECT strftime('%d',created_at,'localtime') as day_num,
           COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0
      AND strftime('%Y-%m',created_at,'localtime')=strftime('%Y-%m','now','localtime')
    GROUP BY day_num ORDER BY day_num
  `).all()

  // Mes anterior
  const prevMo = db.prepare(`
    SELECT strftime('%d',created_at,'localtime') as day_num,
           COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0
      AND strftime('%Y-%m',created_at,'localtime')=strftime('%Y-%m','now','localtime','-1 month')
    GROUP BY day_num ORDER BY day_num
  `).all()

  // Merge by day number
  const maxDay = 31
  const prevMap = Object.fromEntries(prevMo.map(r => [r.day_num, r]))
  const result = []
  for (let d = 1; d <= maxDay; d++) {
    const dn = String(d).padStart(2, '0')
    const th = thisMo.find(r => r.day_num === dn)
    const pr = prevMap[dn]
    if (!th && !pr) continue
    result.push({ day: d, este_mes: th?.total ?? 0, mes_anterior: pr?.total ?? 0, este_count: th?.count ?? 0, prev_count: pr?.count ?? 0 })
  }

  // Estadísticas
  const totalEste  = result.reduce((s, r) => s + r.este_mes, 0)
  const totalAnter = result.reduce((s, r) => s + r.mes_anterior, 0)
  const pctVar     = totalAnter > 0 ? ((totalEste - totalAnter) / totalAnter * 100).toFixed(1) : null
  const bestDay    = result.reduce((best, r) => r.este_mes > (best?.este_mes ?? 0) ? r : best, null)
  const worstDay   = result.filter(r => r.este_mes > 0).reduce((worst, r) => r.este_mes < (worst?.este_mes ?? Infinity) ? r : worst, null)

  return { days: result, totalEste, totalAnter, pctVar, bestDay: bestDay?.day, bestAmount: bestDay?.este_mes, worstDay: worstDay?.day, worstAmount: worstDay?.este_mes }
})

// ── Comparativa mensual por categoría ─────────────────────────────────────────
ipcMain.handle('dashboard:categoryComparison', () => {
  const db = getDB()
  const mo = (offset) => db.prepare(`
    SELECT COALESCE(p.category,'Sin categoría') as category,
           COALESCE(SUM(COALESCE(si.net_price,si.quantity*si.unit_price)),0) as revenue
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    LEFT JOIN products p ON p.id=si.product_id
    WHERE s.voided=0
      AND strftime('%Y-%m',s.created_at,'localtime')=strftime('%Y-%m','now','localtime','${offset} month')
    GROUP BY category ORDER BY revenue DESC
  `).all()

  const curr = mo('+0')
  const prev = mo('-1')
  const prevMap = Object.fromEntries(prev.map(r => [r.category, r.revenue]))
  return curr.map(r => ({
    category: r.category,
    este_mes: r.revenue,
    mes_anterior: prevMap[r.category] ?? 0,
    diff: r.revenue - (prevMap[r.category] ?? 0),
    pct: prevMap[r.category] > 0 ? ((r.revenue - prevMap[r.category]) / prevMap[r.category] * 100).toFixed(1) : null,
  }))
})

ipcMain.handle('dashboard:heatmap', () =>
  getDB().prepare(`
    SELECT strftime('%w', created_at, 'localtime') as dow,
           strftime('%H', created_at, 'localtime') as hour,
           COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND created_at >= date('now','localtime','-90 days')
    GROUP BY dow, hour ORDER BY dow, hour
  `).all()
)

ipcMain.handle('dashboard:monthlyProfit', async () => {
  const db = getDB()
  const monthlySales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0
      AND strftime('%Y-%m', created_at,'localtime') = strftime('%Y-%m','now','localtime')
  `).get()
  // Ganancia bruta real = Σ (precio_venta - precio_costo) × cantidad por item.
  // Se excluyen los items sin costo cargado (unit_cost 0 o NULL): no se puede
  // saber su ganancia, así que no aportan ni al numerador ni al margen.
  const grossProfit = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(si.profit,(si.unit_price - si.unit_cost) * si.quantity)),0) as total,
           COALESCE(SUM(COALESCE(si.net_price, si.unit_price * si.quantity)),0) as revenueWithCost
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.voided=0
      AND si.unit_cost IS NOT NULL AND si.unit_cost > 0
      AND strftime('%Y-%m', s.created_at,'localtime') = strftime('%Y-%m','now','localtime')
  `).get()
  const monthlyExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total
    FROM expenses
    WHERE strftime('%Y-%m', created_at,'localtime') = strftime('%Y-%m','now','localtime')
  `).get()
  const fixedCostsTotal = db.prepare(
    'SELECT COALESCE(SUM(amount),0) as total FROM fixed_costs WHERE active=1'
  ).get()
  // 30-day avg daily sales for projection
  const avgDaily = db.prepare(`
    SELECT COALESCE(SUM(total),0) / 30.0 as avg
    FROM sales WHERE voided=0
      AND created_at >= date('now','localtime','-30 days')
  `).get()
  const dayOfMonth = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric' }), 10)
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const daysLeft = daysInMonth - dayOfMonth
  const projected = monthlySales.total + (avgDaily.avg * daysLeft)
  const monthlyGoalSetting = db.prepare("SELECT value FROM settings WHERE key='monthly_goal'").get()
  const monthlyGoal = parseFloat(monthlyGoalSetting?.value || '0')
  // Ganancia neta = ganancia bruta − gastos variables − gastos fijos del mes.
  const realProfit = grossProfit.total - monthlyExpenses.total - fixedCostsTotal.total
  // Margen % = ganancia neta / ventas totales × 100. (sobre local: TN no tiene costo)
  const margin = monthlySales.total > 0 ? (realProfit / monthlySales.total) * 100 : 0
  // Ventas de Tienda Nube del mes (API en vivo, aditivo). Se suman al total de ventas
  // pero NO a la ganancia/margen (no tenemos costo de las ventas web).
  let tnMonthlySales = 0
  try {
    const { getTnSalesForPeriod } = require('./tiendanube')
    const tn = await getTnSalesForPeriod('month')
    if (tn?.connected && !tn.error) tnMonthlySales = tn.total || 0
  } catch {}
  return {
    monthlySales: monthlySales.total,
    monthlyCount: monthlySales.count,
    tnMonthlySales,
    combinedMonthlySales: monthlySales.total + tnMonthlySales,
    grossProfit: grossProfit.total,
    monthlyExpenses: monthlyExpenses.total,
    fixedCostsTotal: fixedCostsTotal.total,
    realProfit,
    margin,
    projected,
    monthlyGoal,
    dayOfMonth,
    daysInMonth,
    daysLeft,
  }
})
