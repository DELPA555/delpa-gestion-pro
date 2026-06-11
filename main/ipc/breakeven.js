const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('breakeven:data', () => {
  const db = getDB()

  // Fixed costs
  let fixedCosts = 0
  try { fixedCosts = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM fixed_costs WHERE active=1`).get()?.total || 0 } catch {}

  // This month's sales + costs
  const monthStart = new Date().toISOString().slice(0, 7) + '-01'
  const monthlySales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total FROM sales
    WHERE voided=0 AND date(created_at,'localtime') >= ?
  `).get(monthStart)?.total || 0

  // Variable expenses this month
  const varExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE date >= ?
  `).get(monthStart)?.total || 0

  // Contribution margin from sale items this month
  const itemStats = db.prepare(`
    SELECT COALESCE(SUM(si.quantity * si.unit_price),0) as revenue,
           COALESCE(SUM(si.quantity * COALESCE(si.unit_cost,0)),0) as cost
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') >= ? AND si.unit_price > 0
  `).get(monthStart)
  const revenue = itemStats?.revenue || 0
  const costGS = itemStats?.cost || 0
  const marginRate = revenue > 0 ? (revenue - costGS) / revenue : 0.35

  // Break-even = fixed costs / contribution margin rate
  const breakeven = marginRate > 0 ? fixedCosts / marginRate : 0
  const pct = breakeven > 0 ? Math.min(100, (monthlySales / breakeven) * 100) : (monthlySales > 0 ? 100 : 0)
  const achieved = breakeven > 0 ? monthlySales >= breakeven : false

  // Days elapsed in month
  const today = new Date()
  const daysElapsed = today.getDate()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  return {
    fixedCosts,
    varExpenses,
    marginRate,
    breakeven,
    monthlySales,
    pct,
    achieved,
    remaining: Math.max(0, breakeven - monthlySales),
    daysElapsed,
    daysInMonth,
  }
})
