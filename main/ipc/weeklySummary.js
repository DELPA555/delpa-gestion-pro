const { getDB } = require('../../database/db')

const TZ = 'America/Argentina/Buenos_Aires'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getEmailConfig() {
  const db = getDB()
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'email%' OR key='business_name'").all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

function fmtARS(v) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
}

// Milisegundos hasta H:MM en Argentina hoy (positivo = aún no llegó; negativo = ya pasó)
function msUntilTimeArgToday(hour, minute = 0) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TZ, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find(p => p.type === 'hour').value)
  const m = parseInt(parts.find(p => p.type === 'minute').value)
  const s = parseInt(parts.find(p => p.type === 'second').value)
  const ms = ((hour - h) * 3600 + (minute - m) * 60 - s) * 1000
  return ms
}

// Fecha legible en Argentina
function argDateStr(date) {
  return date.toLocaleDateString('es-AR', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

// Próximo lunes a las H hs en Argentina
function nextMondayAt(hour) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now)
  const dow = parts.find(p => p.type === 'weekday').value // Mon, Tue, ...
  const h   = parseInt(parts.find(p => p.type === 'hour').value)

  // Días hasta el próximo lunes
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const today = dowMap[dow] ?? 0
  let daysUntilMonday = (1 - today + 7) % 7
  // Si hoy es lunes y ya pasó la hora target → próximo lunes
  if (daysUntilMonday === 0 && h >= hour) daysUntilMonday = 7

  const d = new Date(now.getTime() + daysUntilMonday * 86400000)
  return d
}

// Próximo día 1 del mes a las H hs
function nextFirstOfMonthAt(hour) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', hour12: false,
  }).formatToParts(now)
  const day = parseInt(parts.find(p => p.type === 'day').value)
  const h   = parseInt(parts.find(p => p.type === 'hour').value)
  const mon = parseInt(parts.find(p => p.type === 'month').value)
  const yr  = parseInt(parts.find(p => p.type === 'year').value)

  if (day === 1 && h < hour) {
    // Hoy es día 1 y aún no llegó la hora
    return new Date(yr, mon - 1, 1)
  }
  // Primer día del mes siguiente
  const next = mon === 12 ? new Date(yr + 1, 0, 1) : new Date(yr, mon, 1)
  return next
}

// ── HTML del resumen semanal ──────────────────────────────────────────────────

function buildWeeklyHTML(data, bizName) {
  const { totalSales, totalRevenue, topProducts, topClients, lowStock, byDay, byHour, accountBalances } = data
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  const topProdRows = topProducts.map(p =>
    `<tr><td>${p.name}</td><td style="text-align:right">${p.qty}</td><td style="text-align:right">${fmtARS(p.revenue)}</td></tr>`
  ).join('')

  const topClientRows = topClients.map(c =>
    `<tr><td>${c.name}</td><td style="text-align:right">${c.count}</td><td style="text-align:right">${fmtARS(c.total)}</td></tr>`
  ).join('')

  const lowStockRows = lowStock.map(p =>
    `<tr><td>${p.name}</td><td style="text-align:right">${p.size}</td><td style="text-align:right;color:#c00">${p.stock}</td></tr>`
  ).join('')

  const byDayRows = byDay.map(d =>
    `<tr><td>${days[d.dow] || d.dow}</td><td style="text-align:right">${d.count}</td><td style="text-align:right">${fmtARS(d.total)}</td></tr>`
  ).join('')

  const peakHour = byHour.reduce((a, b) => (!a || b.count > a.count ? b : a), null)

  const accountRows = accountBalances.map(a =>
    `<tr><td>${a.name}</td><td style="text-align:right">${fmtARS(a.balance)}</td></tr>`
  ).join('')

  const now = new Date()
  const endDate   = now.toLocaleDateString('es-AR')
  const startDate = new Date(now - 7 * 86400000).toLocaleDateString('es-AR')

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Resumen Semanal</title>
<style>
body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;padding:0;margin:0;background:#f5f5f5}
.wrap{max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)}
.header{background:#070707;color:#fff;padding:24px;text-align:center}
.header h1{font-size:22px;margin:0 0 4px}
.header p{color:#aaa;font-size:12px;margin:0}
.kpis{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#e0e0e0}
.kpi{background:#fff;padding:16px;text-align:center}
.kpi .v{font-size:22px;font-weight:bold;color:#00c853}
.kpi .l{font-size:11px;color:#777;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
.section{padding:20px 24px}
.section h2{font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#333;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid #f0f0f0}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:6px 4px;border-bottom:1px solid #eee;color:#999;font-size:11px;text-transform:uppercase}
td{padding:6px 4px;border-bottom:1px solid #fafafa}
tr:last-child td{border-bottom:none}
.footer{background:#f9f9f9;padding:16px 24px;text-align:center;font-size:11px;color:#999}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>${bizName}</h1>
    <p>Resumen semanal · ${startDate} al ${endDate}</p>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="v">${fmtARS(totalRevenue)}</div><div class="l">Ventas totales</div></div>
    <div class="kpi"><div class="v">${totalSales}</div><div class="l">Transacciones</div></div>
  </div>
  ${topProducts.length ? `
  <div class="section">
    <h2>Top 5 productos</h2>
    <table><thead><tr><th>Producto</th><th style="text-align:right">Unid.</th><th style="text-align:right">Ingresos</th></tr></thead>
    <tbody>${topProdRows}</tbody></table>
  </div>` : ''}
  ${topClients.length ? `
  <div class="section" style="padding-top:0">
    <h2>Top 3 clientes</h2>
    <table><thead><tr><th>Cliente</th><th style="text-align:right">Compras</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${topClientRows}</tbody></table>
  </div>` : ''}
  ${byDay.length ? `
  <div class="section" style="padding-top:0">
    <h2>Ventas por día</h2>
    <table><thead><tr><th>Día</th><th style="text-align:right">Transacc.</th><th style="text-align:right">Monto</th></tr></thead>
    <tbody>${byDayRows}</tbody></table>
    ${peakHour ? `<p style="margin-top:8px;font-size:11px;color:#666">Horario pico: <strong>${peakHour.hour}hs</strong></p>` : ''}
  </div>` : ''}
  ${lowStock.length ? `
  <div class="section" style="padding-top:0">
    <h2>Stock crítico (&lt;3 unidades)</h2>
    <table><thead><tr><th>Producto</th><th style="text-align:right">Talle</th><th style="text-align:right">Stock</th></tr></thead>
    <tbody>${lowStockRows}</tbody></table>
  </div>` : ''}
  ${accountBalances.length ? `
  <div class="section" style="padding-top:0">
    <h2>Saldo de cuentas</h2>
    <table><thead><tr><th>Cuenta</th><th style="text-align:right">Saldo</th></tr></thead>
    <tbody>${accountRows}</tbody></table>
  </div>` : ''}
  <div class="footer">Generado automáticamente por DELPA Gestión PRO</div>
</div>
</body></html>`
}

// ── HTML del resumen mensual ──────────────────────────────────────────────────

function buildMonthlyHTML(data, bizName, monthLabel) {
  const { totalSales, totalRevenue, totalExpenses, topProducts, topClients, lowStock, byDay, bestDay, accountBalances } = data
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const profit = (totalRevenue || 0) - (totalExpenses || 0)

  const topProdRows = topProducts.map(p =>
    `<tr><td>${p.name}</td><td style="text-align:right">${p.qty}</td><td style="text-align:right">${fmtARS(p.revenue)}</td></tr>`
  ).join('')

  const topClientRows = topClients.map(c =>
    `<tr><td>${c.name}</td><td style="text-align:right">${c.count}</td><td style="text-align:right">${fmtARS(c.total)}</td></tr>`
  ).join('')

  const lowStockRows = lowStock.map(p =>
    `<tr><td>${p.name}</td><td style="text-align:right">${p.size}</td><td style="text-align:right;color:#c00">${p.stock}</td></tr>`
  ).join('')

  const byDayRows = byDay.map(d =>
    `<tr><td>${days[d.dow] || d.dow}</td><td style="text-align:right">${d.count}</td><td style="text-align:right">${fmtARS(d.total)}</td></tr>`
  ).join('')

  const accountRows = accountBalances.map(a =>
    `<tr><td>${a.name}</td><td style="text-align:right">${fmtARS(a.balance)}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Resumen Mensual</title>
<style>
body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;padding:0;margin:0;background:#f5f5f5}
.wrap{max-width:600px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)}
.header{background:#070707;color:#fff;padding:24px;text-align:center}
.header h1{font-size:22px;margin:0 0 4px}
.header p{color:#aaa;font-size:12px;margin:0}
.kpis{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#e0e0e0}
.kpi{background:#fff;padding:16px;text-align:center}
.kpi .v{font-size:18px;font-weight:bold}
.kpi .v.green{color:#00c853}.kpi .v.red{color:#c00}.kpi .v.blue{color:#1565c0}
.kpi .l{font-size:11px;color:#777;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
.section{padding:20px 24px}
.section h2{font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#333;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid #f0f0f0}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:6px 4px;border-bottom:1px solid #eee;color:#999;font-size:11px;text-transform:uppercase}
td{padding:6px 4px;border-bottom:1px solid #fafafa}
tr:last-child td{border-bottom:none}
.footer{background:#f9f9f9;padding:16px 24px;text-align:center;font-size:11px;color:#999}
.highlight{background:#f0fff4;border-left:3px solid #00c853;padding:10px 16px;margin-bottom:12px;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>${bizName}</h1>
    <p>Resumen mensual · ${monthLabel}</p>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="v green">${fmtARS(totalRevenue)}</div><div class="l">Ventas</div></div>
    <div class="kpi"><div class="v red">${fmtARS(totalExpenses)}</div><div class="l">Gastos</div></div>
    <div class="kpi"><div class="v blue">${fmtARS(profit)}</div><div class="l">Resultado</div></div>
  </div>
  <div class="section">
    <div class="kpis" style="border:1px solid #eee;border-radius:6px;overflow:hidden">
      <div class="kpi" style="padding:10px"><div class="v blue" style="font-size:16px">${totalSales}</div><div class="l">Transacciones</div></div>
      ${bestDay ? `<div class="kpi" style="padding:10px"><div class="v green" style="font-size:13px">${bestDay.date}</div><div class="l">Mejor día (${fmtARS(bestDay.total)})</div></div>` : ''}
    </div>
  </div>
  ${topProducts.length ? `
  <div class="section" style="padding-top:0">
    <h2>Top 10 productos del mes</h2>
    <table><thead><tr><th>Producto</th><th style="text-align:right">Unid.</th><th style="text-align:right">Ingresos</th></tr></thead>
    <tbody>${topProdRows}</tbody></table>
  </div>` : ''}
  ${topClients.length ? `
  <div class="section" style="padding-top:0">
    <h2>Top 5 clientes del mes</h2>
    <table><thead><tr><th>Cliente</th><th style="text-align:right">Compras</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${topClientRows}</tbody></table>
  </div>` : ''}
  ${byDay.length ? `
  <div class="section" style="padding-top:0">
    <h2>Ventas por día de la semana</h2>
    <table><thead><tr><th>Día</th><th style="text-align:right">Transacc.</th><th style="text-align:right">Monto</th></tr></thead>
    <tbody>${byDayRows}</tbody></table>
  </div>` : ''}
  ${lowStock.length ? `
  <div class="section" style="padding-top:0">
    <h2>Stock crítico (&lt;3 unidades)</h2>
    <table><thead><tr><th>Producto</th><th style="text-align:right">Talle</th><th style="text-align:right">Stock</th></tr></thead>
    <tbody>${lowStockRows}</tbody></table>
  </div>` : ''}
  ${accountBalances.length ? `
  <div class="section" style="padding-top:0">
    <h2>Saldo de cuentas al cierre</h2>
    <table><thead><tr><th>Cuenta</th><th style="text-align:right">Saldo</th></tr></thead>
    <tbody>${accountRows}</tbody></table>
  </div>` : ''}
  <div class="footer">Generado automáticamente por DELPA Gestión PRO · Cierre ${monthLabel}</div>
</div>
</body></html>`
}

// ── Recolección de datos ──────────────────────────────────────────────────────

function gatherWeekData() {
  const db = getDB()

  const sales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as totalRevenue, COUNT(*) as totalSales
    FROM sales WHERE voided=0 AND date(created_at,'localtime') >= date('now','localtime','-7 days')
  `).get()

  const topProducts = db.prepare(`
    SELECT p.name, SUM(si.quantity) as qty, SUM(si.quantity * si.unit_price) as revenue
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.voided=0 AND date(s.created_at,'localtime') >= date('now','localtime','-7 days')
    GROUP BY si.product_id ORDER BY qty DESC LIMIT 5
  `).all()

  const topClients = db.prepare(`
    SELECT c.name, COUNT(*) as count, SUM(s.total) as total
    FROM sales s JOIN clients c ON c.id = s.client_id
    WHERE s.voided=0 AND s.client_id IS NOT NULL
      AND date(s.created_at,'localtime') >= date('now','localtime','-7 days')
    GROUP BY s.client_id ORDER BY total DESC LIMIT 3
  `).all()

  const lowStock = db.prepare(`
    SELECT p.name, ps.size, ps.stock
    FROM product_sizes ps JOIN products p ON p.id = ps.product_id
    WHERE ps.stock > 0 AND ps.stock < 3
    ORDER BY ps.stock ASC LIMIT 15
  `).all()

  const byDay = db.prepare(`
    SELECT CAST(strftime('%w', created_at, 'localtime') AS INTEGER) as dow,
           COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND date(created_at,'localtime') >= date('now','localtime','-7 days')
    GROUP BY dow ORDER BY dow
  `).all()

  const byHour = db.prepare(`
    SELECT strftime('%H', created_at, 'localtime') as hour, COUNT(*) as count
    FROM sales WHERE voided=0
      AND date(created_at,'localtime') >= date('now','localtime','-7 days')
    GROUP BY hour ORDER BY count DESC LIMIT 1
  `).all()

  let accountBalances = []
  try {
    accountBalances = db.prepare(`
      SELECT name, balance FROM clients
      WHERE balance IS NOT NULL AND balance <> 0
      ORDER BY balance DESC LIMIT 15
    `).all()
  } catch (e) { accountBalances = [] }

  return { totalSales: sales.totalSales, totalRevenue: sales.totalRevenue, topProducts, topClients, lowStock, byDay, byHour, accountBalances }
}

function gatherMonthData() {
  const db = getDB()

  const sales = db.prepare(`
    SELECT COALESCE(SUM(total),0) as totalRevenue, COUNT(*) as totalSales
    FROM sales WHERE voided=0 AND strftime('%Y-%m', created_at,'localtime') = strftime('%Y-%m', 'now','localtime','-1 month')
  `).get()

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as totalExpenses
    FROM expenses WHERE strftime('%Y-%m', date,'localtime') = strftime('%Y-%m', 'now','localtime','-1 month')
  `).get()

  const topProducts = db.prepare(`
    SELECT p.name, SUM(si.quantity) as qty, SUM(si.quantity * si.unit_price) as revenue
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.voided=0 AND strftime('%Y-%m', s.created_at,'localtime') = strftime('%Y-%m', 'now','localtime','-1 month')
    GROUP BY si.product_id ORDER BY qty DESC LIMIT 10
  `).all()

  const topClients = db.prepare(`
    SELECT c.name, COUNT(*) as count, SUM(s.total) as total
    FROM sales s JOIN clients c ON c.id = s.client_id
    WHERE s.voided=0 AND s.client_id IS NOT NULL
      AND strftime('%Y-%m', s.created_at,'localtime') = strftime('%Y-%m', 'now','localtime','-1 month')
    GROUP BY s.client_id ORDER BY total DESC LIMIT 5
  `).all()

  const lowStock = db.prepare(`
    SELECT p.name, ps.size, ps.stock
    FROM product_sizes ps JOIN products p ON p.id = ps.product_id
    WHERE ps.stock > 0 AND ps.stock < 3
    ORDER BY ps.stock ASC LIMIT 15
  `).all()

  const byDay = db.prepare(`
    SELECT CAST(strftime('%w', created_at, 'localtime') AS INTEGER) as dow,
           COUNT(*) as count, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND strftime('%Y-%m', created_at,'localtime') = strftime('%Y-%m', 'now','localtime','-1 month')
    GROUP BY dow ORDER BY dow
  `).all()

  const bestDay = db.prepare(`
    SELECT date(created_at,'localtime') as date, COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND strftime('%Y-%m', created_at,'localtime') = strftime('%Y-%m', 'now','localtime','-1 month')
    GROUP BY date ORDER BY total DESC LIMIT 1
  `).get()

  let accountBalances = []
  try {
    accountBalances = db.prepare(`
      SELECT name, balance FROM clients
      WHERE balance IS NOT NULL AND balance <> 0
      ORDER BY balance DESC LIMIT 15
    `).all()
  } catch (e) { accountBalances = [] }

  return {
    totalSales: sales.totalSales,
    totalRevenue: sales.totalRevenue,
    totalExpenses: expenses.totalExpenses,
    topProducts, topClients, lowStock, byDay, bestDay, accountBalances,
  }
}

// ── Envíos ────────────────────────────────────────────────────────────────────

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

async function sendWeeklySummary() {
  const cfg = getEmailConfig()
  const user = cfg.email_user || cfg.email_from
  if (!user || !cfg.email_pass) return

  const transporter = await createTransporter(cfg)
  const data = gatherWeekData()
  const bizName = cfg.business_name || 'DELPA'
  const html = buildWeeklyHTML(data, bizName)
  const dateStr = new Date().toLocaleDateString('es-AR')

  await transporter.sendMail({
    from: `"${bizName}" <${user}>`,
    to: cfg.email_to || 'delpa555@gmail.com',
    subject: `Resumen semanal ${bizName} — ${dateStr}`,
    html,
  })
  console.log('[DELPA] Informe semanal enviado:', dateStr)
}

async function sendMonthlySummary() {
  const cfg = getEmailConfig()
  const user = cfg.email_user || cfg.email_from
  if (!user || !cfg.email_pass) return

  const transporter = await createTransporter(cfg)
  const data = gatherMonthData()
  const bizName = cfg.business_name || 'DELPA'

  // Etiqueta del mes anterior
  const now = new Date()
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const monthLabel = prevMonth.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: TZ })

  const html = buildMonthlyHTML(data, bizName, monthLabel)

  await transporter.sendMail({
    from: `"${bizName}" <${user}>`,
    to: cfg.email_to || 'delpa555@gmail.com',
    subject: `Resumen mensual ${bizName} — ${monthLabel}`,
    html,
  })
  console.log('[DELPA] Informe mensual enviado:', monthLabel)
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function scheduleWeeklySummary() {
  try {
    const cron = require('node-cron')

    // ── Informe semanal ──────────────────────────────────────────────────────
    // Cron: todos los lunes a las 19:00
    cron.schedule('0 19 * * 1', async () => {
      try { await sendWeeklySummary() } catch (e) { console.error('[DELPA] Error informe semanal:', e.message) }
    }, { timezone: TZ })

    // Primera ejecución hoy a las 20:45 (para verificar que funciona)
    const msWeekly = msUntilTimeArgToday(20, 45)
    if (msWeekly > 0) {
      const hoy2045 = new Date(Date.now() + msWeekly)
      console.log('[DELPA] Próximo informe semanal (prueba hoy):', argDateStr(hoy2045), '20:45')
      setTimeout(async () => {
        try { await sendWeeklySummary() } catch (e) { console.error('[DELPA] Error informe semanal hoy:', e.message) }
      }, msWeekly)
    } else {
      const nextMonday = nextMondayAt(19)
      console.log('[DELPA] Próximo informe semanal:', argDateStr(nextMonday), '19:00')
    }

    // ── Informe mensual ──────────────────────────────────────────────────────
    // Cron: primer día de cada mes a las 19:00
    cron.schedule('0 19 1 * *', async () => {
      try { await sendMonthlySummary() } catch (e) { console.error('[DELPA] Error informe mensual:', e.message) }
    }, { timezone: TZ })

    const nextFirst = nextFirstOfMonthAt(19)
    console.log('[DELPA] Próximo informe mensual:', argDateStr(nextFirst), '19:00')

  } catch (e) {
    console.error('[DELPA] node-cron no disponible:', e.message)
  }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

const { ipcMain } = require('electron')

ipcMain.handle('weeklySummary:send', async () => {
  try { await sendWeeklySummary(); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('monthlySummary:send', async () => {
  try { await sendMonthlySummary(); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

module.exports = { scheduleWeeklySummary, sendWeeklySummary, sendMonthlySummary }
