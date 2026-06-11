const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

const TASKS = [
  { id: 'add_product',  label: 'Agregar tu primer producto',        route: '/productos',     check: `SELECT COUNT(*) as n FROM products WHERE active=1` },
  { id: 'add_supplier', label: 'Agregar un proveedor',              route: '/proveedores',   check: `SELECT COUNT(*) as n FROM suppliers WHERE active=1` },
  { id: 'add_client',   label: 'Agregar una clienta',               route: '/clientes',      check: `SELECT COUNT(*) as n FROM clients WHERE active=1` },
  { id: 'make_sale',    label: 'Registrar tu primera venta',        route: '/ventas',        check: `SELECT COUNT(*) as n FROM sales WHERE voided=0` },
  { id: 'open_cashbox', label: 'Abrir la caja por primera vez',     route: '/caja',          check: `SELECT COUNT(*) as n FROM cashbox` },
  { id: 'add_expense',  label: 'Registrar un gasto',                route: '/gastos',        check: `SELECT COUNT(*) as n FROM expenses` },
  { id: 'setup_email',  label: 'Configurar email para informes',    route: '/configuracion', check: `SELECT value as n FROM settings WHERE key='email_to' AND value != ''` },
  { id: 'setup_biz',    label: 'Personalizar nombre del negocio',   route: '/configuracion', check: `SELECT value as n FROM settings WHERE key='business_name' AND value != '' AND value != 'DELPA'` },
]

ipcMain.handle('onboarding:status', () => {
  const db = getDB()
  const dismissed = db.prepare(`SELECT value FROM settings WHERE key='onboarding_dismissed'`).get()?.value === '1'
  const tasks = TASKS.map(task => {
    let completed = false
    try {
      const row = db.prepare(task.check).get()
      completed = Number(row?.n || row?.value || 0) > 0
    } catch {}
    return { id: task.id, label: task.label, route: task.route, completed }
  })
  const completedCount = tasks.filter(t => t.completed).length
  return { tasks, completedCount, total: tasks.length, dismissed }
})

ipcMain.handle('onboarding:dismiss', () => {
  const db = getDB()
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_dismissed', '1')`).run()
  return { ok: true }
})

ipcMain.handle('onboarding:reset', () => {
  const db = getDB()
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_dismissed', '0')`).run()
  return { ok: true }
})

// ── Business Health Score ──────────────────────────────────────────────────────

ipcMain.handle('health:score', () => {
  const db = getDB()
  const scores = []

  // 1. Actividad de ventas (20 pts)
  try {
    const recent7 = db.prepare(`SELECT COUNT(*) as n FROM sales WHERE voided=0 AND created_at >= date('now','-7 days','localtime')`).get()?.n || 0
    const total30 = db.prepare(`SELECT COALESCE(SUM(total),0) as t FROM sales WHERE voided=0 AND date(created_at,'localtime') >= date('now','-30 days','localtime')`).get()?.t || 0
    const week7   = db.prepare(`SELECT COALESCE(SUM(total),0) as t FROM sales WHERE voided=0 AND date(created_at,'localtime') >= date('now','-7 days','localtime')`).get()?.t || 0
    const weeklyPace = total30 > 0 ? (week7 * 4.3) / total30 : 0
    let pts = 0
    if (recent7 >= 1) pts = 8
    if (recent7 >= 5) pts = 13
    if (recent7 >= 10) pts = 17
    if (weeklyPace >= 1) pts = 20
    scores.push({ label: 'Ventas activas', pts: Math.min(20, pts), max: 20, tip: recent7 === 0 ? 'Sin ventas en los últimos 7 días' : weeklyPace < 0.9 ? 'El ritmo esta semana está por debajo del promedio mensual' : null })
  } catch { scores.push({ label: 'Ventas activas', pts: 0, max: 20, tip: 'Sin datos suficientes' }) }

  // 2. Estado del stock (20 pts)
  try {
    const totalP = db.prepare(`SELECT COUNT(DISTINCT product_id) as n FROM product_sizes WHERE stock > 0`).get()?.n || 0
    const lowP   = db.prepare(`SELECT COUNT(DISTINCT ps.product_id) as n FROM product_sizes ps WHERE ps.stock <= ps.min_stock AND ps.min_stock > 0 AND ps.stock >= 0`).get()?.n || 0
    const zeroP  = db.prepare(`SELECT COUNT(DISTINCT product_id) as n FROM product_sizes WHERE stock <= 0`).get()?.n || 0
    let pts = 20
    pts -= Math.min(10, Math.round((lowP / Math.max(totalP, 1)) * 20))
    pts -= Math.min(10, Math.round((zeroP / Math.max(totalP, 1)) * 20))
    scores.push({ label: 'Stock saludable', pts: Math.max(0, pts), max: 20, tip: lowP > 0 ? `${lowP} producto${lowP !== 1 ? 's' : ''} en mínimo crítico` : null })
  } catch { scores.push({ label: 'Stock saludable', pts: 0, max: 20, tip: 'Sin datos' }) }

  // 3. Clientes y deudas (20 pts)
  try {
    const totalC  = db.prepare(`SELECT COUNT(*) as n FROM clients WHERE active=1`).get()?.n || 0
    const debtors = db.prepare(`SELECT COUNT(*) as n FROM clients WHERE balance > 1000 AND active=1`).get()?.n || 0
    let pts = 0
    if (totalC >= 1)  pts = 6
    if (totalC >= 20) pts = 12
    if (totalC >= 50) pts = 16
    if (debtors === 0) pts += 4
    scores.push({ label: 'Clientes y cuentas', pts: Math.min(20, pts), max: 20, tip: debtors > 0 ? `${debtors} cliente${debtors !== 1 ? 's' : ''} con deuda > $1.000` : totalC < 5 ? 'Pocos clientes registrados' : null })
  } catch { scores.push({ label: 'Clientes y cuentas', pts: 0, max: 20, tip: 'Sin datos' }) }

  // 4. Rentabilidad (20 pts)
  try {
    const monthStart = new Date().toISOString().slice(0, 7) + '-01'
    const stats = db.prepare(`
      SELECT COALESCE(SUM(si.quantity * si.unit_price),0) as revenue,
             COALESCE(SUM(si.quantity * COALESCE(si.unit_cost,0)),0) as cost
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.voided=0 AND date(s.created_at,'localtime') >= ? AND si.unit_price > 0
    `).get(monthStart)
    const rev = stats?.revenue || 0
    const cst = stats?.cost || 0
    const margin = rev > 0 ? (rev - cst) / rev : 0
    let pts = 0
    if (margin > 0)    pts = 6
    if (margin >= 0.2) pts = 12
    if (margin >= 0.35) pts = 17
    if (margin >= 0.5)  pts = 20
    scores.push({ label: 'Rentabilidad', pts, max: 20, tip: margin <= 0 ? 'Margen negativo este mes — revisá costos' : margin < 0.2 ? `Margen ${(margin*100).toFixed(0)}% — considerá ajustar precios` : null })
  } catch { scores.push({ label: 'Rentabilidad', pts: 0, max: 20, tip: 'Sin datos' }) }

  // 5. Configuración completa (20 pts)
  try {
    const sRows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('email_to','cuit_nro','business_name','business_phone')`).all()
    const s = Object.fromEntries(sRows.map(r => [r.key, r.value]))
    let pts = 0
    if (s.business_name && s.business_name !== 'DELPA') pts += 5
    if (s.business_phone && s.business_phone.length > 5) pts += 5
    if (s.email_to && s.email_to.includes('@')) pts += 5
    if (s.cuit_nro && s.cuit_nro.length > 5) pts += 5
    scores.push({ label: 'Perfil del negocio', pts, max: 20, tip: !s.email_to ? 'Configurá un email para informes automáticos' : !s.cuit_nro ? 'Agregá tu CUIT para habilitiar facturación' : null })
  } catch { scores.push({ label: 'Perfil del negocio', pts: 0, max: 20, tip: 'Sin datos' }) }

  const total = scores.reduce((s, r) => s + r.pts, 0)
  const color = total >= 80 ? 'green' : total >= 60 ? 'yellow' : total >= 40 ? 'orange' : 'red'
  const label = total >= 80 ? 'Excelente' : total >= 60 ? 'Bueno' : total >= 40 ? 'Regular' : 'Necesita atención'

  return { scores, total, color, label }
})
