const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// ─────────────────────────────────────────────────────────────────────────────
// Créditos personales (planes de cuotas con interés punitorio por mora).
// Tablas: credits (plan) + credit_installments (cuotas). Ver database/schema.js.
// Spec original: creditos → credits, cuotas → credit_installments (nombres en inglés
// por consistencia con el resto del schema; la UI va en español).
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const pad = (n) => String(n).padStart(2, '0')
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// Parse 'YYYY-MM-DD' como fecha local.
function parseDate(s) {
  const [y, m, d] = String(s || '').split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
function fmtDMY(s) {
  const d = parseDate(s)
  if (!d) return s || ''
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
function addMonths(dateStr, n) {
  const d = parseDate(dateStr) || new Date()
  const nd = new Date(d.getFullYear(), d.getMonth() + n, d.getDate())
  return `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())}`
}
function daysBetween(fromStr, toStr) {
  const a = parseDate(fromStr), b = parseDate(toStr)
  if (!a || !b) return 0
  return Math.max(0, Math.round((b - a) / 86400000))
}
const fmtMoney = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(Number(n) || 0)

// ─── Recálculo de mora ────────────────────────────────────────────────────────
// Para cada cuota impaga vencida: estado='vencida', interés = original × (tasa/100) ×
// días_mora / 30, total = original + interés. Cuotas no vencidas quedan 'pendiente' sin
// interés. Si todas las cuotas están pagas → crédito 'completado'.
function recalcCredit(db, credit) {
  const rate = Number(credit.late_interest_rate) || 0
  const today = todayStr()
  const insts = db.prepare('SELECT * FROM credit_installments WHERE credit_id=? ORDER BY number ASC').all(credit.id)
  const upVenc = db.prepare("UPDATE credit_installments SET status='vencida', interest_amount=?, total_amount=? WHERE id=?")
  const upPend = db.prepare("UPDATE credit_installments SET status='pendiente', interest_amount=0, total_amount=? WHERE id=?")
  for (const it of insts) {
    if (it.paid_date) continue // pagada: no se toca
    if (it.due_date < today) {
      const days = daysBetween(it.due_date, today)
      const interest = rate > 0 ? round2(it.original_amount * (rate / 100) * days / 30) : 0
      upVenc.run(interest, round2(it.original_amount + interest), it.id)
    } else if (it.status !== 'pendiente' || Number(it.interest_amount) !== 0 || Number(it.total_amount) !== Number(it.original_amount)) {
      upPend.run(it.original_amount, it.id)
    }
  }
  if (credit.status === 'activo') {
    const { c } = db.prepare('SELECT COUNT(*) c FROM credit_installments WHERE credit_id=? AND paid_date IS NULL').get(credit.id)
    if (c === 0) db.prepare("UPDATE credits SET status='completado' WHERE id=?").run(credit.id)
  }
}
function recalcAllOverdueCredits(db = getDB()) {
  try {
    const credits = db.prepare("SELECT * FROM credits WHERE status='activo'").all()
    const tx = db.transaction(() => { for (const cr of credits) recalcCredit(db, cr) })
    tx()
  } catch (e) { console.error('[credits] recalc error:', e.message) }
}

// Resumen de un crédito (cuotas pagadas/total, próximo vencimiento, saldo, mora).
function creditSummary(db, cr) {
  const insts = db.prepare('SELECT * FROM credit_installments WHERE credit_id=? ORDER BY number ASC').all(cr.id)
  const paid = insts.filter(i => i.paid_date)
  const unpaid = insts.filter(i => !i.paid_date)
  const overdue = unpaid.filter(i => i.status === 'vencida')
  const owed = round2(unpaid.reduce((s, i) => s + Number(i.total_amount || i.original_amount), 0))
  const nextDue = unpaid.length ? unpaid.map(i => i.due_date).sort()[0] : null
  const client = db.prepare('SELECT name, phone, email, dni FROM clients WHERE id=?').get(cr.client_id) || {}
  return {
    ...cr,
    client_name: client.name || '—',
    client_phone: client.phone || '',
    installments_total: insts.length,
    installments_paid: paid.length,
    overdue_count: overdue.length,
    owed,
    next_due: nextDue,
    situacion: cr.status !== 'activo' ? cr.status : (overdue.length > 0 ? 'con_mora' : 'al_dia'),
  }
}

// ─── credits:create ─────────────────────────────────────────────────────────
ipcMain.handle('credits:create', (_, data) => {
  const db = getDB()
  const {
    clientId, saleId, totalAmount, installmentsCount, firstDueDate,
    lateInterestRate, notes,
  } = data || {}
  const total = round2(totalAmount)
  const count = parseInt(installmentsCount, 10)
  if (!clientId) return { ok: false, error: 'Seleccioná un cliente' }
  if (!(total > 0)) return { ok: false, error: 'El monto total debe ser mayor a 0' }
  if (!(count >= 1 && count <= 36)) return { ok: false, error: 'La cantidad de cuotas debe ser entre 1 y 36' }
  if (!firstDueDate) return { ok: false, error: 'Indicá la fecha de la primera cuota' }
  const rate = Math.max(0, Number(lateInterestRate) || 0)

  const base = round2(total / count)
  const run = db.transaction(() => {
    const { lastInsertRowid: creditId } = db.prepare(`
      INSERT INTO credits (client_id,sale_id,total_amount,installments_count,installment_amount,late_interest_rate,start_date,status,notes)
      VALUES (?,?,?,?,?,?,?, 'activo', ?)
    `).run(clientId, saleId || null, total, count, base, rate, firstDueDate, notes || null)

    const ins = db.prepare(`
      INSERT INTO credit_installments (credit_id,number,original_amount,interest_amount,total_amount,due_date,status)
      VALUES (?,?,?,0,?,?, 'pendiente')
    `)
    let acc = 0
    for (let i = 1; i <= count; i++) {
      // La última cuota absorbe el redondeo para que la suma dé exactamente el total.
      const amount = i === count ? round2(total - acc) : base
      acc = round2(acc + amount)
      const due = addMonths(firstDueDate, i - 1)
      ins.run(creditId, i, amount, amount, due)
    }
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','credits',?,'Crédito creado',?)`)
      .run(creditId, JSON.stringify({ clientId, total, count, firstDueDate, rate }))
    return creditId
  })
  const id = run()
  // recalcular por si la primera cuota ya está vencida
  const cr = db.prepare('SELECT * FROM credits WHERE id=?').get(id)
  recalcCredit(db, cr)
  return { ok: true, id }
})

// Previsualización del plan (sin guardar) — para el formulario de nuevo crédito.
ipcMain.handle('credits:preview', (_, { totalAmount, installmentsCount, firstDueDate }) => {
  const total = round2(totalAmount)
  const count = parseInt(installmentsCount, 10)
  if (!(total > 0) || !(count >= 1 && count <= 36) || !firstDueDate) return []
  const base = round2(total / count)
  const rows = []
  let acc = 0
  for (let i = 1; i <= count; i++) {
    const amount = i === count ? round2(total - acc) : base
    acc = round2(acc + amount)
    rows.push({ number: i, amount, due_date: addMonths(firstDueDate, i - 1) })
  }
  return rows
})

// ─── credits:list ─────────────────────────────────────────────────────────────
ipcMain.handle('credits:list', (_, { status = '' } = {}) => {
  const db = getDB()
  recalcAllOverdueCredits(db)
  let where = 'WHERE 1=1'
  const params = []
  if (status) { where += ' AND c.status=?'; params.push(status) }
  const rows = db.prepare(`SELECT c.* FROM credits c ${where} ORDER BY c.created_at DESC`).all(...params)
  const list = rows.map(cr => creditSummary(db, cr))
  const activos = db.prepare("SELECT COUNT(*) c FROM credits WHERE status='activo'").get().c
  return { credits: list, activos }
})

// ─── credits:get ────────────────────────────────────────────────────────────
ipcMain.handle('credits:get', (_, id) => {
  const db = getDB()
  const cr = db.prepare('SELECT * FROM credits WHERE id=?').get(id)
  if (!cr) return null
  recalcCredit(db, cr)
  const fresh = db.prepare('SELECT * FROM credits WHERE id=?').get(id)
  const summary = creditSummary(db, fresh)
  summary.installments = db.prepare('SELECT * FROM credit_installments WHERE credit_id=? ORDER BY number ASC').all(id)
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(cr.client_id) || {}
  summary.client = client
  return summary
})

// ─── credits:registerPayment ──────────────────────────────────────────────────
ipcMain.handle('credits:registerPayment', (_, { installmentId, paymentMethod }) => {
  const db = getDB()
  const inst = db.prepare('SELECT * FROM credit_installments WHERE id=?').get(installmentId)
  if (!inst) return { ok: false, error: 'Cuota no encontrada' }
  if (inst.paid_date) return { ok: false, error: 'La cuota ya está pagada' }
  const cr = db.prepare('SELECT * FROM credits WHERE id=?').get(inst.credit_id)
  if (!cr) return { ok: false, error: 'Crédito no encontrado' }
  const metodo = paymentMethod || 'Efectivo'
  const amount = round2(inst.total_amount || inst.original_amount)
  const client = db.prepare('SELECT name FROM clients WHERE id=?').get(cr.client_id) || {}

  const run = db.transaction(() => {
    db.prepare("UPDATE credit_installments SET status='pagada', paid_date=?, payment_method=? WHERE id=?")
      .run(todayStr(), metodo, installmentId)
    // Movimiento de caja (medio de pago real), si hay caja abierta
    const cashbox = db.prepare("SELECT id FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()
    if (cashbox) {
      db.prepare(`INSERT INTO cashbox_movements (cashbox_id, type, concept, amount, payment_method) VALUES (?, 'ingreso', ?, ?, ?)`)
        .run(cashbox.id, `Cuota ${inst.number} crédito #${cr.id} — ${client.name || ''}`.trim(), amount, metodo)
    }
    // ¿Quedan cuotas impagas? Si no, completar el crédito.
    const { c } = db.prepare('SELECT COUNT(*) c FROM credit_installments WHERE credit_id=? AND paid_date IS NULL').get(cr.id)
    if (c === 0) db.prepare("UPDATE credits SET status='completado' WHERE id=?").run(cr.id)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('UPDATE','credits',?,'Cuota cobrada',?)`)
      .run(cr.id, JSON.stringify({ installmentId, number: inst.number, amount, metodo }))
  })
  run()
  return { ok: true, amount, completed: db.prepare("SELECT status FROM credits WHERE id=?").get(cr.id)?.status === 'completado' }
})

// ─── credits:cancel ───────────────────────────────────────────────────────────
ipcMain.handle('credits:cancel', (_, { id }) => {
  const db = getDB()
  const cr = db.prepare('SELECT * FROM credits WHERE id=?').get(id)
  if (!cr) return { ok: false, error: 'Crédito no encontrado' }
  db.prepare("UPDATE credits SET status='cancelado' WHERE id=?").run(id)
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('UPDATE','credits',?,'Crédito cancelado')`).run(id)
  return { ok: true }
})

// ─── Estado de cuenta por cliente (datos + HTML imprimible) ───────────────────
function getBiz(db) {
  const g = (k, d = '') => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || d
  return {
    name: g('business_name', 'DELPA'),
    logo: g('business_logo', ''),
    address: g('business_address', ''),
    phone: g('business_phone', ''),
    cuit: g('business_cuit', ''),
  }
}
function buildAccountStatement(db, clientId) {
  recalcAllOverdueCredits(db)
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId)
  if (!client) return null
  const creditsRows = db.prepare("SELECT * FROM credits WHERE client_id=? AND status IN ('activo','completado') ORDER BY created_at DESC").all(clientId)
  const credits = creditsRows.map(cr => {
    const s = creditSummary(db, cr)
    s.installments = db.prepare('SELECT * FROM credit_installments WHERE credit_id=? ORDER BY number ASC').all(cr.id)
    return s
  })
  const activos = credits.filter(c => c.status === 'activo')
  const totalOwed = round2(activos.reduce((s, c) => s + c.owed, 0))
  const overdueCount = activos.reduce((s, c) => s + c.overdue_count, 0)
  const biz = getBiz(db)
  const html = statementHtml(biz, client, credits, { totalOwed, overdueCount })
  return { client, credits, totals: { totalOwed, overdueCount }, html }
}
function statementHtml(biz, client, credits, totals) {
  const estadoBadge = (st) => st === 'pagada' ? '✓ Pagada' : st === 'vencida' ? '⚠ Vencida' : 'Pendiente'
  const estadoColor = (st) => st === 'pagada' ? '#16a34a' : st === 'vencida' ? '#dc2626' : '#64748b'
  const creditBlocks = credits.map(cr => {
    const rows = cr.installments.map(it => `
      <tr>
        <td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center">${it.number}</td>
        <td style="padding:5px 8px;border:1px solid #e5e7eb">${fmtDMY(it.due_date)}</td>
        <td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right">${fmtMoney(it.original_amount)}</td>
        <td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right">${Number(it.interest_amount) > 0 ? fmtMoney(it.interest_amount) : '—'}</td>
        <td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right;font-weight:600">${fmtMoney(it.total_amount || it.original_amount)}</td>
        <td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center;color:${estadoColor(it.status)}">${estadoBadge(it.status)}${it.paid_date ? ` (${fmtDMY(it.paid_date)})` : ''}</td>
      </tr>`).join('')
    return `
      <div style="margin:14px 0">
        <div style="font-size:13px;font-weight:700;margin-bottom:4px">Crédito #${cr.id} · ${fmtMoney(cr.total_amount)} en ${cr.installments_count} cuotas
          <span style="font-weight:400;color:#64748b">(inicio ${fmtDMY(cr.start_date)}${Number(cr.late_interest_rate) > 0 ? ` · mora ${cr.late_interest_rate}%/mes` : ''})</span></div>
        <table style="border-collapse:collapse;width:100%;font-size:12px">
          <thead><tr style="background:#f1f5f9">
            <th style="padding:5px 8px;border:1px solid #e5e7eb">#</th>
            <th style="padding:5px 8px;border:1px solid #e5e7eb;text-align:left">Vencimiento</th>
            <th style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right">Monto</th>
            <th style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right">Interés</th>
            <th style="padding:5px 8px;border:1px solid #e5e7eb;text-align:right">Total</th>
            <th style="padding:5px 8px;border:1px solid #e5e7eb">Estado</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
  }).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Estado de cuenta</title></head>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:760px;margin:0 auto;padding:24px">
    <div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #e5e7eb;padding-bottom:12px">
      ${biz.logo ? `<img src="${biz.logo}" style="height:46px;object-fit:contain">` : ''}
      <div>
        <div style="font-size:20px;font-weight:800">${biz.name}</div>
        ${biz.address ? `<div style="font-size:12px;color:#64748b">${biz.address}</div>` : ''}
        ${biz.phone ? `<div style="font-size:12px;color:#64748b">Tel: ${biz.phone}${biz.cuit ? ` · CUIT: ${biz.cuit}` : ''}</div>` : ''}
      </div>
    </div>
    <h2 style="font-size:16px;margin:16px 0 4px">Estado de cuenta</h2>
    <div style="font-size:13px">
      <strong>Cliente:</strong> ${client.name}${client.dni ? ` · DNI ${client.dni}` : ''}<br>
      ${client.phone ? `<strong>Tel:</strong> ${client.phone}<br>` : ''}
      <strong>Fecha:</strong> ${fmtDMY(todayStr())}
    </div>
    <div style="margin:14px 0;padding:12px;border-radius:8px;background:${totals.overdueCount > 0 ? '#fef2f2' : '#f0fdf4'};border:1px solid ${totals.overdueCount > 0 ? '#fecaca' : '#bbf7d0'}">
      <div style="font-size:13px">Total adeudado (créditos activos): <strong style="font-size:16px">${fmtMoney(totals.totalOwed)}</strong></div>
      <div style="font-size:12px;color:#64748b">Cuotas vencidas: <strong style="color:${totals.overdueCount > 0 ? '#dc2626' : '#16a34a'}">${totals.overdueCount}</strong></div>
    </div>
    ${creditBlocks || '<p style="color:#64748b;font-size:13px">Este cliente no tiene créditos activos.</p>'}
    <p style="font-size:11px;color:#94a3b8;margin-top:20px;text-align:center">Generado por ${biz.name} · Documento informativo, no es un comprobante fiscal.</p>
  </body></html>`
}

ipcMain.handle('credits:accountStatement', (_, { clientId }) => {
  const db = getDB()
  const res = buildAccountStatement(db, clientId)
  if (!res) return { ok: false, error: 'Cliente no encontrado' }
  return { ok: true, ...res }
})

// ─── credits:emailStatement ───────────────────────────────────────────────────
ipcMain.handle('credits:emailStatement', async (_, { clientId }) => {
  const db = getDB()
  const res = buildAccountStatement(db, clientId)
  if (!res) return { ok: false, error: 'Cliente no encontrado' }
  const client = res.client
  if (!client.email) return { ok: false, noEmail: true, error: 'El cliente no tiene email cargado en su ficha.' }

  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'email%'").all()
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]))
  const smtpUser = s.email_user || s.email_from
  if (!smtpUser || !s.email_pass) return { ok: false, error: 'Configurá el email en Configuración → Email.' }

  try {
    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: (s.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
      port: parseInt(s.email_port || '587', 10),
      secure: s.email_port === '465',
      requireTLS: s.email_port !== '465',
      auth: { user: smtpUser, pass: s.email_pass },
      tls: { minVersion: 'TLSv1.2' },
    })
    const biz = getBiz(db)
    await transporter.sendMail({
      from: `"${biz.name}" <${smtpUser}>`,
      to: client.email,
      subject: `Estado de cuenta — ${client.name} — ${fmtDMY(todayStr())}`,
      html: res.html,
    })
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('EMAIL','credits',?,'Estado de cuenta enviado',?)`)
      .run(clientId, JSON.stringify({ email: client.email, totalOwed: res.totals.totalOwed }))
    return { ok: true, email: client.email }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

module.exports = { recalcAllOverdueCredits }
