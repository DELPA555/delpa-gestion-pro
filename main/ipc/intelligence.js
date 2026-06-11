const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('intelligence:recommendations', () => {
  const db = getDB()
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Sales per product/size in the last 90 days
  const sold = db.prepare(`
    SELECT si.product_id, si.size, p.name as product_name, p.color,
           SUM(si.quantity) as units_sold
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.voided = 0 AND s.created_at >= ? AND p.active = 1
    GROUP BY si.product_id, si.size
  `).all(cutoff)

  // Current stock per product/size
  const stockMap = {}
  const stockRows = db.prepare(`
    SELECT ps.product_id, ps.size, ps.stock
    FROM product_sizes ps
    JOIN products p ON p.id = ps.product_id
    WHERE p.active = 1
  `).all()
  for (const r of stockRows) {
    stockMap[`${r.product_id}-${r.size}`] = r.stock
  }

  // Seasonal detection: same period last year
  const lastYearStart = new Date(Date.now() - (90 + 365) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const lastYearEnd   = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const lastYearSales = db.prepare(`
    SELECT si.product_id, si.size, SUM(si.quantity) as units_sold
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND s.created_at >= ? AND s.created_at <= ?
    GROUP BY si.product_id, si.size
  `).all(lastYearStart, lastYearEnd)
  const lyMap = {}
  for (const r of lastYearSales) lyMap[`${r.product_id}-${r.size}`] = r.units_sold

  // Weekly pattern: which days of week sell each product most
  const dayPatterns = db.prepare(`
    SELECT si.product_id, si.size, strftime('%w', s.created_at) as dow, SUM(si.quantity) as qty
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.voided = 0 AND s.created_at >= ?
    GROUP BY si.product_id, si.size, dow
  `).all(cutoff)
  const dayMap = {}
  for (const r of dayPatterns) {
    const k = `${r.product_id}-${r.size}`
    if (!dayMap[k]) dayMap[k] = {}
    dayMap[k][r.dow] = (dayMap[k][r.dow] || 0) + r.qty
  }
  const DOW_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

  const results = []

  for (const row of sold) {
    const key = `${row.product_id}-${row.size}`
    const currentStock = stockMap[key] ?? 0
    const dailyVelocity = row.units_sold / 90
    const daysLeft = dailyVelocity > 0 ? Math.floor(currentStock / dailyVelocity) : 999
    const unitsNeeded = Math.ceil(dailyVelocity * 14)

    let urgency
    if (daysLeft < 3) urgency = 'critical'
    else if (daysLeft < 7) urgency = 'high'
    else if (daysLeft < 14) urgency = 'medium'
    else urgency = 'low'

    const lyUnits = lyMap[key] || 0
    const isSeasonal = lyUnits > row.units_sold * 1.5 && lyUnits >= 5

    // Build message
    let message
    const N = daysLeft
    const v = dailyVelocity.toFixed(2)
    const name = row.product_name
    const sz = row.size

    if (urgency === 'critical') {
      message = `El talle ${sz} de "${name}" se agota en ${N} días — pedí ${unitsNeeded} unidades hoy`
    } else if (urgency === 'high') {
      message = `T.${sz} de "${name}" se agota en ${N} días (vende ${v} u/día)`
    } else if (isSeasonal) {
      urgency = 'seasonal'
      message = `"${name}" T.${sz} tuvo pico esta época el año pasado (${lyUnits} u. vs ${row.units_sold} este año) — considerá reponer`
    } else {
      // Check day pattern
      const patterns = dayMap[key] || {}
      const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1])
      if (sorted.length > 0) {
        const topDays = sorted.slice(0, 2).map(([d]) => DOW_NAMES[Number(d)]).join(' y ')
        message = `Esta semana necesitás T.${sz} de "${name}" — se vende principalmente los ${topDays}`
      } else {
        message = `T.${sz} de "${name}" tiene ${daysLeft} días de stock a ritmo actual`
      }
    }

    // Only include medium or better unless seasonal
    if (urgency === 'low') continue

    results.push({
      product_id: row.product_id,
      product_name: row.product_name,
      size: row.size,
      color: row.color,
      days_left: daysLeft,
      daily_velocity: parseFloat(dailyVelocity.toFixed(3)),
      current_stock: currentStock,
      units_needed: unitsNeeded,
      urgency,
      message,
    })
  }

  // Sort by urgency severity then days_left
  const urgencyOrder = { critical: 0, high: 1, seasonal: 2, medium: 3 }
  results.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9
    const ub = urgencyOrder[b.urgency] ?? 9
    if (ua !== ub) return ua - ub
    return a.days_left - b.days_left
  })

  return results.slice(0, 5)
})

ipcMain.handle('intelligence:stockBreaks', () => {
  const db = getDB()
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const sold = db.prepare(`
    SELECT si.product_id, si.size, p.name as product_name, p.color,
           SUM(si.quantity) as units_30d
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.voided = 0 AND s.created_at >= ? AND p.active = 1
    GROUP BY si.product_id, si.size
  `).all(cutoff)

  const stockMap = {}
  const stockRows = db.prepare(`
    SELECT ps.product_id, ps.size, ps.stock
    FROM product_sizes ps JOIN products p ON p.id = ps.product_id
    WHERE p.active = 1
  `).all()
  for (const r of stockRows) stockMap[`${r.product_id}-${r.size}`] = r.stock

  const results = []

  for (const row of sold) {
    const key = `${row.product_id}-${row.size}`
    const currentStock = stockMap[key] ?? 0
    const dailyVelocity = row.units_30d / 30
    const daysLeft = dailyVelocity > 0 ? Math.floor(currentStock / dailyVelocity) : 999

    if (daysLeft >= 15) continue

    let level
    if (daysLeft < 3) level = 'red'
    else if (daysLeft < 7) level = 'orange'
    else level = 'yellow'

    results.push({
      product_id: row.product_id,
      product_name: row.product_name,
      size: row.size,
      color: row.color,
      daily_velocity: parseFloat(dailyVelocity.toFixed(3)),
      current_stock: currentStock,
      days_left: daysLeft,
      level,
      units_30d: row.units_30d,
    })
  }

  results.sort((a, b) => a.days_left - b.days_left)
  return results.slice(0, 30)
})
