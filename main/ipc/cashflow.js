const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('cashflow:projection', () => {
  const db = getDB()

  // Last 60 days of daily sales
  const sales = db.prepare(`
    SELECT date(created_at,'localtime') as day, SUM(total) as total
    FROM sales WHERE voided=0 AND created_at >= date('now','-60 days','localtime')
    GROUP BY day ORDER BY day
  `).all()

  // Average over last 30 days
  const recent30 = sales.slice(-30)
  const avgDaily = recent30.length > 0
    ? recent30.reduce((s, r) => s + r.total, 0) / 30
    : 0

  // Last 30 days variable expenses (daily avg)
  const expTotal = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM expenses WHERE date >= date('now','-30 days')
  `).get()?.total || 0
  const avgExpDaily = expTotal / 30

  // Fixed costs (monthly → daily)
  let fixedMonthly = 0
  try { fixedMonthly = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM fixed_costs WHERE active=1`).get()?.total || 0 } catch {}
  const fixedDaily = fixedMonthly / 30

  // Current cash balance from open cashbox
  const cashbox = db.prepare(`SELECT opening_cash FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1`).get()
  const todaySales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as t FROM sales
    WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime')
  `).get()?.t || 0
  const currentBalance = (cashbox?.opening_cash || 0) + todaySales

  // Build 30-day projection
  const projection = []
  let running = currentBalance
  for (let i = 1; i <= 30; i++) {
    const d = new Date(Date.now() + i * 86400000)
    const dow = d.getDay()
    const isWeekend = dow === 0 || dow === 6
    const dayRevenue = avgDaily * (isWeekend ? 1.15 : 0.95)
    const dayExpenses = avgExpDaily + fixedDaily
    running += dayRevenue - dayExpenses
    projection.push({
      day: i,
      date: d.toISOString().slice(0, 10),
      ingresos: Math.round(dayRevenue),
      egresos: Math.round(dayExpenses),
      balance: Math.round(running),
      negative: running < 0,
    })
  }

  const negativeDays = projection.filter(p => p.negative).length
  const status = negativeDays === 0 ? 'green' : negativeDays <= 7 ? 'yellow' : 'red'

  return {
    projection,
    avgDaily: Math.round(avgDaily),
    avgExpDaily: Math.round(avgExpDaily + fixedDaily),
    currentBalance: Math.round(currentBalance),
    negativeDays,
    status,
  }
})
