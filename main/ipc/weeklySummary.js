const { getDB } = require('../../database/db')

function getEmailConfig() {
  const db = getDB()
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'email%' OR key='business_name'").all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

function buildWeeklyHTML(data, bizName) {
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const { totalSales, totalRevenue, topProducts, topClients, lowStock, byDay, byHour, accountBalances } = data
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

  const topProdRows = topProducts.map(p =>
    `<tr><td>${p.name}</td><td style="text-align:right">${p.qty}</td><td style="text-align:right">${fmt(p.revenue)}</td></tr>`
  ).join('')

  const topClientRows = topClients.map(c =>
    `<tr><td>${c.name}</td><td style="text-align:right">${c.count}</td><td style="text-align:right">${fmt(c.total)}</td></tr>`
  ).join('')

  const lowStockRows = lowStock.map(p =>
    `<tr><td>${p.name}</td><td style="text-align:right">${p.size}</td><td style="text-align:right;color:#c00">${p.stock}</td></tr>`
  ).join('')

  const byDayRows = byDay.map(d =>
    `<tr><td>${days[d.dow] || d.dow}</td><td style="text-align:right">${d.count}</td><td style="text-align:right">${fmt(d.total)}</td></tr>`
  ).join('')

  const peakHour = byHour.reduce((a, b) => (!a || b.count > a.count ? b : a), null)
  const accountRows = accountBalances.map(a =>
    `<tr><td>${a.name}</td><td style="text-align:right">${fmt(a.balance)}</td></tr>`
  ).join('')

  const now = new Date()
  const endDate = now.toLocaleDateString('es-AR')
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
.badge{display:inline-block;background:#00c853;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:bold}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>${bizName}</h1>
    <p>Resumen semanal · ${startDate} al ${endDate}</p>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="v">${fmt(totalRevenue)}</div><div class="l">Ventas totales</div></div>
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

function gatherWeekData() {
  const db = getDB()
  const since = "date('now','localtime','-7 days')"

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
    SELECT strftime('%w', created_at, 'localtime') as dow,
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

  const accountBalances = db.prepare(`
    SELECT name, balance FROM accounts ORDER BY balance DESC
  `).all()

  return {
    totalSales: sales.totalSales,
    totalRevenue: sales.totalRevenue,
    topProducts, topClients, lowStock, byDay,
    byHour, accountBalances,
  }
}

async function sendWeeklySummary() {
  const cfg = getEmailConfig()
  const to = cfg.email_to || 'delpa555@gmail.com'
  const user = cfg.email_user || cfg.email_from
  if (!user || !cfg.email_pass) return

  const nodemailer = require('nodemailer')
  const transporter = nodemailer.createTransport({
    host: (cfg.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
    port: parseInt(cfg.email_port || '587', 10),
    secure: cfg.email_port === '465',
    requireTLS: cfg.email_port !== '465',
    auth: { user, pass: cfg.email_pass },
    tls: { minVersion: 'TLSv1.2' },
  })

  const data = gatherWeekData()
  const bizName = cfg.business_name || 'DELPA'
  const html = buildWeeklyHTML(data, bizName)
  const now = new Date()
  const dateStr = now.toLocaleDateString('es-AR')

  await transporter.sendMail({
    from: `"${bizName}" <${user}>`,
    to,
    subject: `Resumen semanal ${bizName} — ${dateStr}`,
    html,
  })
}

function scheduleWeeklySummary() {
  try {
    const cron = require('node-cron')
    cron.schedule('0 8 * * 1', async () => {
      try { await sendWeeklySummary() } catch (e) { console.error('Weekly summary error:', e.message) }
    }, { timezone: 'America/Argentina/Buenos_Aires' })
  } catch (e) {
    console.error('node-cron not available:', e.message)
  }
}

const { ipcMain } = require('electron')
ipcMain.handle('weeklySummary:send', async () => {
  try { await sendWeeklySummary(); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

module.exports = { scheduleWeeklySummary, sendWeeklySummary }
