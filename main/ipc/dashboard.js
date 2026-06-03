const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('dashboard:stats', () => {
  const db = getDB()
  const ventas = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime')
  `).get()
  const bruta = db.prepare(`
    SELECT COALESCE(SUM((si.unit_price - si.unit_cost)*si.quantity),0) as total
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
  return {
    ventas: ventas.total,
    cantidadVentas: ventas.count,
    gananciaBruta: bruta.total,
    gastos: gastos.total,
    gananciaNeta: bruta.total - gastos.total,
    inversionStock: stock.inversion,
    ventaPotencial: stock.potencial,
    cuentasCorrientes: cuentas.total,
    unidadesHoy: unidades.total,
  }
})

ipcMain.handle('dashboard:salesTrend', () =>
  getDB().prepare(`
    SELECT date(created_at,'localtime') as day,
           SUM(total) as total, COUNT(*) as count
    FROM sales WHERE voided=0
      AND created_at >= date('now','localtime','-30 days')
    GROUP BY date(created_at,'localtime') ORDER BY day ASC
  `).all()
)

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
           COALESCE(SUM(si.quantity*si.unit_price),0) as revenue
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

ipcMain.handle('dashboard:monthlyProfit', () => {
  const db = getDB()
  const monthlySales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count
    FROM sales WHERE voided=0
      AND strftime('%Y-%m', created_at,'localtime') = strftime('%Y-%m','now','localtime')
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
  return {
    monthlySales: monthlySales.total,
    monthlyCount: monthlySales.count,
    monthlyExpenses: monthlyExpenses.total,
    fixedCostsTotal: fixedCostsTotal.total,
    realProfit: monthlySales.total - monthlyExpenses.total - fixedCostsTotal.total,
    projected,
    monthlyGoal,
    dayOfMonth,
    daysInMonth,
    daysLeft,
  }
})
