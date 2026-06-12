const { ipcMain, BrowserWindow } = require('electron')
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { getDB } = require('../../database/db')

function getEmailConfig() {
  const db = getDB()
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'email%'").all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

function buildTransporter(s) {
  const nodemailer = require('nodemailer')
  const user = s.email_user || s.email_from
  if (!user || !s.email_pass) throw new Error('Configuración de email incompleta (usuario y contraseña requeridos)')
  if (!s.email_to) throw new Error('Falta el email destinatario')
  return nodemailer.createTransport({
    host: (s.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
    port: parseInt(s.email_port || '587', 10),
    secure: s.email_port === '465',
    requireTLS: s.email_port !== '465',
    auth: { user, pass: s.email_pass },
    tls: { minVersion: 'TLSv1.2' },
  })
}

async function generatePDF(html) {
  const tmpFile = path.join(os.tmpdir(), `delpa-caja-${Date.now()}.html`)
  fs.writeFileSync(tmpFile, html, 'utf8')
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { contextIsolation: true } })
  try {
    await win.loadFile(tmpFile)
    return await win.webContents.printToPDF({ landscape: false, printBackground: true, pageSize: 'A4' })
  } finally {
    win.destroy()
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

function buildFullReportHTML(data, biz) {
  const { cashbox: cb, byMethod, allSales, voidedSales, expenses, totalSales, totalExpenses, expectedCash, paymentCounts } = data
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const fmtDate = s => s ? new Date(s).toLocaleString('es-AR') : '—'
  const fmtTime = s => s ? new Date(s).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const gananciaNet = totalSales - totalExpenses
  const cbDiff = cb.difference || 0

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe de Cierre #${cb.id}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px}
  h1{font-size:20px;font-weight:bold;margin-bottom:2px}
  h2{font-size:12px;font-weight:bold;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #333;text-transform:uppercase;letter-spacing:.5px}
  .biz-info{color:#555;margin-bottom:16px}.biz-info p{margin:2px 0}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}.total-row td{font-weight:bold;background:#f9f9f9}
  .grn{color:#16a34a}.red{color:#dc2626}
  .sb{border:1px solid #ccc;border-radius:4px;padding:12px;margin-bottom:16px}
  .sr{display:flex;justify-content:space-between;padding:3px 0}
  .sr.bold{font-weight:bold;font-size:13px;border-top:1px solid #ccc;padding-top:6px;margin-top:4px}
  .badge{background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:3px;font-size:9px}
  .item-row td{color:#777;font-size:10px;background:#fafafa}
  .footer{margin-top:24px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:10px;text-align:center}
  @media print{@page{size:A4;margin:15mm}}
</style>
</head>
<body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:50px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
<h1>${biz.business_name || 'DELPA'}</h1>
<div class="biz-info">
  ${biz.business_address ? `<p>${biz.business_address}</p>` : ''}
  ${biz.business_phone ? `<p>Tel: ${biz.business_phone}</p>` : ''}
  ${biz.business_cuit ? `<p>CUIT: ${biz.business_cuit}</p>` : ''}
</div>

<h2>Informe de Cierre de Caja N° ${cb.id}</h2>
<div class="sb">
  <div class="sr"><span>Apertura:</span><span>${fmtDate(cb.opened_at)}</span></div>
  <div class="sr"><span>Cierre:</span><span>${fmtDate(cb.closed_at)}</span></div>
  <div class="sr"><span>Efectivo inicial:</span><span>${fmt(cb.opening_cash)}</span></div>
  ${cb.notes ? `<div class="sr"><span>Notas:</span><span>${cb.notes}</span></div>` : ''}
</div>

<h2>Resumen por medio de pago</h2>
<table>
  <thead><tr><th>Método</th><th class="r">Ventas</th><th class="r">Sistema</th><th class="r">Real contado</th><th class="r">Diferencia</th></tr></thead>
  <tbody>
    ${byMethod.map(m => {
      const real = paymentCounts[m.payment_method]?.real ?? m.total
      const d = real - m.total
      return `<tr>
        <td>${m.payment_method}</td><td class="r">${m.count}</td>
        <td class="r">${fmt(m.total)}</td><td class="r">${fmt(real)}</td>
        <td class="r ${d >= 0 ? 'grn' : 'red'}">${d >= 0 ? '+' : ''}${fmt(d)}</td>
      </tr>`
    }).join('')}
    <tr class="total-row">
      <td>TOTAL</td><td class="r">${allSales.length}</td>
      <td class="r">${fmt(totalSales)}</td><td></td><td></td>
    </tr>
  </tbody>
</table>

<h2>Ventas del período (${allSales.length})</h2>
<table>
  <thead><tr><th>N° Venta</th><th>Hora</th><th>Cliente</th><th>Vendedora</th><th>Método</th><th class="r">Total</th></tr></thead>
  <tbody>
    ${allSales.map(s => `<tr>
      <td>${s.sale_number || '#' + s.id}</td>
      <td>${fmtTime(s.created_at)}</td>
      <td>${s.client_name || '—'}</td>
      <td>${s.seller_name || '—'}</td>
      <td>${s.payment_method}${s.installments > 1 ? ` (${s.installments}c)` : ''}</td>
      <td class="r">${fmt(s.total)}</td>
    </tr>${(s.items || []).map(it => `<tr class="item-row">
      <td></td>
      <td colspan="4" style="padding-left:16px">↳ ${it.product_name} T.${it.size} ×${it.quantity} — ${fmt(it.unit_price)} c/u</td>
      <td class="r">${fmt(it.unit_price * it.quantity)}</td>
    </tr>`).join('')}`).join('')}
    <tr class="total-row"><td colspan="5">TOTAL VENTAS</td><td class="r">${fmt(totalSales)}</td></tr>
  </tbody>
</table>

${voidedSales && voidedSales.length > 0 ? `
<h2>Ventas anuladas (${voidedSales.length})</h2>
<table>
  <thead><tr><th>N° Venta</th><th class="r">Total</th><th>Motivo</th></tr></thead>
  <tbody>
    ${voidedSales.map(s => `<tr>
      <td>${s.sale_number || '#' + s.id} <span class="badge">ANULADA</span></td>
      <td class="r">${fmt(s.total)}</td>
      <td>${s.void_reason || '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

${expenses && expenses.length > 0 ? `
<h2>Gastos del período (${expenses.length})</h2>
<table>
  <thead><tr><th>Concepto</th><th>Método</th><th class="r">Monto</th></tr></thead>
  <tbody>
    ${expenses.map(e => `<tr>
      <td>${e.concept}</td><td>${e.payment_method || 'Efectivo'}</td>
      <td class="r">${fmt(e.amount)}</td>
    </tr>`).join('')}
    <tr class="total-row"><td colspan="2">TOTAL GASTOS</td><td class="r">${fmt(totalExpenses)}</td></tr>
  </tbody>
</table>` : ''}

<h2>Resumen final</h2>
<div class="sb">
  <div class="sr"><span>Total ventas:</span><span class="grn">${fmt(totalSales)}</span></div>
  <div class="sr red"><span>Total gastos:</span><span>-${fmt(totalExpenses)}</span></div>
  <div class="sr bold ${gananciaNet >= 0 ? 'grn' : 'red'}"><span>Ganancia neta:</span><span>${gananciaNet >= 0 ? '' : '-'}${fmt(Math.abs(gananciaNet))}</span></div>
  <div class="sr" style="margin-top:8px"><span>Efectivo esperado:</span><span>${fmt(expectedCash)}</span></div>
  <div class="sr"><span>Efectivo real contado:</span><span>${fmt(cb.real_cash)}</span></div>
  <div class="sr bold ${cbDiff === 0 ? 'grn' : cbDiff > 0 ? 'grn' : 'red'}">
    <span>Diferencia:</span><span>${cbDiff >= 0 ? '+' : ''}${fmt(cbDiff)}</span>
  </div>
</div>

<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body>
</html>`
}

function buildSummaryEmailHtml(data, biz) {
  const { byMethod, totalSales, totalExpenses, expectedCash, cashbox: cb } = data
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const gananciaNet = totalSales - totalExpenses
  const bizName = biz.business_name || 'DELPA'
  const cbDiff = cb.difference || 0

  const rows = byMethod.map(m => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #ddd">${m.payment_method}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:center">${m.count}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;text-align:right">${fmt(m.total)}</td>
    </tr>`).join('')

  return `<div style="font-family:sans-serif;max-width:600px">
    ${biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
    <h2 style="color:#333">${bizName} — Cierre de Caja</h2>
    <p style="color:#666;margin:0 0 16px">Fecha de cierre: ${new Date().toLocaleString('es-AR')}</p>

    <div style="display:flex;gap:12px;margin-bottom:16px">
      <div style="flex:1;border:1px solid #d1fae5;background:#f0fdf4;border-radius:6px;padding:12px;text-align:center">
        <p style="color:#6b7280;font-size:11px;margin:0">Total Ventas</p>
        <p style="color:#059669;font-size:18px;font-weight:bold;margin:4px 0">${fmt(totalSales)}</p>
      </div>
      <div style="flex:1;border:1px solid #fee2e2;background:#fef2f2;border-radius:6px;padding:12px;text-align:center">
        <p style="color:#6b7280;font-size:11px;margin:0">Total Gastos</p>
        <p style="color:#dc2626;font-size:18px;font-weight:bold;margin:4px 0">${fmt(totalExpenses)}</p>
      </div>
      <div style="flex:1;border:1px solid #dbeafe;background:#eff6ff;border-radius:6px;padding:12px;text-align:center">
        <p style="color:#6b7280;font-size:11px;margin:0">Ganancia Neta</p>
        <p style="color:${gananciaNet >= 0 ? '#059669' : '#dc2626'};font-size:18px;font-weight:bold;margin:4px 0">${fmt(gananciaNet)}</p>
      </div>
    </div>

    <hr style="border:1px solid #eee;margin-bottom:12px">
    <h3 style="color:#555;font-size:12px;margin:0 0 8px">Desglose por medio de pago</h3>
    <table style="border-collapse:collapse;font-size:13px;width:100%;margin-bottom:16px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Medio de pago</th>
          <th style="padding:6px 12px;border:1px solid #ddd">Ventas</th>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div style="background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:12px;font-size:13px">
      <p style="margin:4px 0"><strong>Efectivo inicial:</strong> ${fmt(cb.opening_cash)}</p>
      <p style="margin:4px 0"><strong>Efectivo esperado:</strong> ${fmt(expectedCash)}</p>
      ${cb.real_cash != null ? `<p style="margin:4px 0"><strong>Efectivo real contado:</strong> ${fmt(cb.real_cash)}</p>` : ''}
      ${cb.difference != null ? `<p style="margin:4px 0;font-weight:bold;color:${cbDiff >= 0 ? '#059669' : '#dc2626'}">Diferencia: ${cbDiff >= 0 ? '+' : ''}${fmt(cbDiff)}</p>` : ''}
    </div>

    <p style="color:#999;font-size:11px;margin-top:16px">Se adjunta el informe completo en PDF. Generado por DELPA Gestión PRO.</p>
  </div>`
}

async function sendCashboxReport(cashboxId) {
  const s = getEmailConfig()
  if (!s.email_user && !s.email_from) return false
  if (!s.email_pass || !s.email_to)  return false

  const db = getDB()
  const cashbox    = db.prepare('SELECT * FROM cashbox WHERE id=?').get(cashboxId)
  const byMethod   = db.prepare(`SELECT payment_method, SUM(total) as total, COUNT(*) as count FROM sales WHERE cashbox_id=? AND voided=0 GROUP BY payment_method ORDER BY total DESC`).all(cashboxId)
  const totalSales = db.prepare('SELECT COALESCE(SUM(total),0) as total FROM sales WHERE cashbox_id=? AND voided=0').get(cashboxId).total
  const totalExpenses = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE cashbox_id=?').get(cashboxId).total
  const voidedSales = db.prepare('SELECT id, sale_number, total, void_reason FROM sales WHERE cashbox_id=? AND voided=1').all(cashboxId)
  const allSales   = db.prepare(`
    SELECT s.id, s.sale_number, s.total, s.created_at, s.payment_method, s.installments,
           c.name as client_name, s.seller_name
    FROM sales s LEFT JOIN clients c ON c.id=s.client_id
    WHERE s.cashbox_id=? AND s.voided=0 ORDER BY s.created_at ASC
  `).all(cashboxId)
  const getItems = db.prepare('SELECT product_name, size, quantity, unit_price FROM sale_items WHERE sale_id=?')
  for (const sale of allSales) sale.items = getItems.all(sale.id)
  const expenses = db.prepare('SELECT * FROM expenses WHERE cashbox_id=? ORDER BY created_at ASC').all(cashboxId)

  const manualMovements = db.prepare('SELECT * FROM cashbox_movements WHERE cashbox_id=? ORDER BY created_at ASC').all(cashboxId)
  const totalManualIngresos = manualMovements.filter(m => m.type === 'ingreso').reduce((s, m) => s + m.amount, 0)
  const totalManualEgresos  = manualMovements.filter(m => m.type === 'egreso').reduce((s, m) => s + m.amount, 0)
  const cashSales    = byMethod.find(m => m.payment_method === 'Efectivo')?.total || 0
  const cashManualIn  = manualMovements.filter(m => m.type === 'ingreso' && m.payment_method === 'Efectivo').reduce((s, m) => s + m.amount, 0)
  const cashManualOut = manualMovements.filter(m => m.type === 'egreso'  && m.payment_method === 'Efectivo').reduce((s, m) => s + m.amount, 0)
  const expectedCash = cashbox.opening_cash + cashSales + cashManualIn - cashManualOut - totalExpenses
  let paymentCounts = {}
  try { paymentCounts = JSON.parse(cashbox.payment_counts_json || '{}') } catch {}

  const biz = {
    business_name:    db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA',
    business_address: db.prepare("SELECT value FROM settings WHERE key='business_address'").get()?.value || '',
    business_phone:   db.prepare("SELECT value FROM settings WHERE key='business_phone'").get()?.value || '',
    business_cuit:    db.prepare("SELECT value FROM settings WHERE key='business_cuit'").get()?.value || '',
    business_logo:    db.prepare("SELECT value FROM settings WHERE key='business_logo'").get()?.value || '',
  }

  const reportData = { cashbox, byMethod, allSales, voidedSales, expenses, manualMovements, totalSales, totalExpenses, totalManualIngresos, totalManualEgresos, expectedCash, paymentCounts }
  const summaryHtml = buildSummaryEmailHtml(reportData, biz)
  const fullHtml    = buildFullReportHTML(reportData, biz)

  let pdfBuffer = null
  try { pdfBuffer = await generatePDF(fullHtml) } catch (e) {
    console.error('[Email] PDF generation error:', e.message)
  }

  const transporter = buildTransporter(s)
  const mailOpts = {
    from: `"${biz.business_name}" <${s.email_user || s.email_from}>`,
    to: s.email_to,
    subject: `[${biz.business_name}] Cierre de caja — ${new Date().toLocaleDateString('es-AR')}`,
    html: summaryHtml,
  }
  if (pdfBuffer) {
    mailOpts.attachments = [{
      filename: `Informe-Caja-${new Date().toISOString().split('T')[0]}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }]
  }
  await transporter.sendMail(mailOpts)
  return true
}

ipcMain.handle('email:sendReport', async (_, cashboxId) => {
  try { await sendCashboxReport(cashboxId); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('email:test', async () => {
  const s = getEmailConfig()
  try {
    const db = getDB()
    const bizName = db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA'
    const transporter = buildTransporter(s)
    await transporter.verify()
    await transporter.sendMail({
      from: `"${bizName}" <${s.email_user || s.email_from}>`,
      to: s.email_to,
      subject: `[${bizName}] Email de prueba`,
      html: `<div style="font-family:sans-serif"><p>¡El email está configurado correctamente para <strong>${bizName}</strong>!</p><p style="color:#888;font-size:12px">Enviado desde DELPA Gestión PRO.</p></div>`,
    })
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('email:sendSaleInvoice', async (_, { saleId, toEmail }) => {
  try {
    const s = getEmailConfig()
    if (!s.email_user && !s.email_from) return { ok: false, error: 'Email de envío no configurado en Configuración' }
    if (!s.email_pass) return { ok: false, error: 'Contraseña de email no configurada' }

    const db = getDB()
    const bizName = db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA'
    const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId)
    if (!sale) return { ok: false, error: 'Venta no encontrada' }
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(saleId)

    let to = toEmail
    if (!to && sale.client_id) {
      to = db.prepare('SELECT email FROM clients WHERE id=?').get(sale.client_id)?.email || null
    }
    if (!to) return { ok: false, error: 'No hay email de destino' }

    const tipoLabel = sale.tipo_cbte === 1 ? 'FACTURA A' : sale.tipo_cbte === 6 ? 'FACTURA B' : sale.tipo_cbte === 11 ? 'FACTURA C' : 'TICKET'
    const cbteNum = sale.cae && sale.pto_venta
      ? `${String(sale.pto_venta).padStart(4,'0')}-${String(sale.cbte_nro).padStart(8,'0')}`
      : ''
    const caeFmtVto = sale.cae_fch_vto
      ? String(sale.cae_fch_vto).replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1')
      : ''

    const itemsHtml = items.map(it => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #ddd">${it.product_name} T.${it.size}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:center">${it.quantity}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">$${Number(it.unit_price).toFixed(2)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">$${Number(it.unit_price * it.quantity).toFixed(2)}</td>
      </tr>`).join('')

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333">
        <h2 style="text-align:center;margin-bottom:4px">${bizName}</h2>
        <div style="text-align:center;margin:8px 0 16px">
          <span style="border:2px solid #333;padding:4px 14px;font-weight:bold;font-size:14px;letter-spacing:1px">${tipoLabel}</span>
          ${cbteNum ? `<p style="color:#666;font-size:12px;margin:6px 0 0">N° ${cbteNum}</p>` : ''}
        </div>
        <hr style="border:1px solid #eee">
        <p style="margin:8px 0"><strong>Fecha:</strong> ${new Date(sale.created_at).toLocaleString('es-AR')}</p>
        ${sale.client_name ? `<p style="margin:4px 0"><strong>Cliente:</strong> ${sale.client_name}</p>` : ''}
        <table style="border-collapse:collapse;width:100%;font-size:13px;margin:12px 0">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Producto</th>
              <th style="padding:6px 10px;border:1px solid #ddd">Cant.</th>
              <th style="padding:6px 10px;border:1px solid #ddd;text-align:right">P. Unit.</th>
              <th style="padding:6px 10px;border:1px solid #ddd;text-align:right">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        ${sale.discount > 0 ? `<p style="text-align:right;margin:4px 0"><strong>Descuento:</strong> -$${Number(sale.discount).toFixed(2)}</p>` : ''}
        <p style="text-align:right;font-size:18px;font-weight:bold;margin:8px 0">TOTAL: $${Number(sale.total).toFixed(2)}</p>
        <p style="margin:4px 0;font-size:13px"><strong>Medio de pago:</strong> ${sale.payment_method}${sale.installments > 1 ? ` (${sale.installments} cuotas)` : ''}</p>
        ${sale.cae ? `
        <div style="background:#f0f0ff;border:1px solid #cce;padding:10px 14px;border-radius:6px;margin-top:16px">
          <p style="color:#446;font-weight:bold;margin:0 0 6px;font-size:13px">Comprobante Electrónico AFIP/ARCA</p>
          <p style="margin:3px 0;font-size:12px"><strong>CAE:</strong> <span style="font-family:monospace">${sale.cae}</span></p>
          ${caeFmtVto ? `<p style="margin:3px 0;font-size:12px"><strong>Vto. CAE:</strong> ${caeFmtVto}</p>` : ''}
        </div>` : ''}
        <p style="color:#aaa;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:8px">Enviado desde ${bizName} Gestión.</p>
      </div>`

    const transporter = buildTransporter(s)
    await transporter.sendMail({
      from: `"${bizName}" <${s.email_user || s.email_from}>`,
      to,
      subject: `[${bizName}] ${tipoLabel}${cbteNum ? ' N° ' + cbteNum : ''} — $${Number(sale.total).toFixed(2)}`,
      html,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

function buildTicketEmailHtml(sale, items, biz) {
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const tipoLabel = sale.tipo_cbte === 1 ? 'FACTURA A' : sale.tipo_cbte === 6 ? 'FACTURA B' : sale.tipo_cbte === 11 ? 'FACTURA C' : 'TICKET'
  const cbteNum = sale.cae && sale.pto_venta
    ? `${String(sale.pto_venta).padStart(4,'0')}-${String(sale.cbte_nro).padStart(8,'0')}`
    : ''
  const caeFmtVto = sale.cae_fch_vto
    ? String(sale.cae_fch_vto).replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1')
    : ''
  const bizName = biz.business_name || 'DELPA'

  const itemsHtml = items.map(it => `
    <tr>
      <td style="padding:5px 10px;border:1px solid #ddd">${it.product_name} T.${it.size}</td>
      <td style="padding:5px 10px;border:1px solid #ddd;text-align:center">${it.quantity}</td>
      <td style="padding:5px 10px;border:1px solid #ddd;text-align:right">${fmt(it.unit_price)}</td>
      <td style="padding:5px 10px;border:1px solid #ddd;text-align:right">${fmt(it.unit_price * it.quantity)}</td>
    </tr>`).join('')

  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#333">
    ${biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
    <h2 style="text-align:center;margin-bottom:4px">${bizName}</h2>
    ${biz.business_address ? `<p style="text-align:center;color:#666;font-size:12px;margin:2px 0">${biz.business_address}</p>` : ''}
    ${biz.business_phone ? `<p style="text-align:center;color:#666;font-size:12px;margin:2px 0">Tel: ${biz.business_phone}</p>` : ''}
    <div style="text-align:center;margin:10px 0">
      <span style="border:2px solid #333;padding:4px 14px;font-weight:bold;font-size:13px;letter-spacing:1px">${tipoLabel}</span>
      ${cbteNum ? `<p style="color:#666;font-size:11px;margin:4px 0">N° ${cbteNum}</p>` : ''}
    </div>
    <hr style="border:1px solid #eee">
    <p style="margin:6px 0;font-size:13px"><strong>Fecha:</strong> ${new Date(sale.created_at).toLocaleString('es-AR')}</p>
    <p style="margin:4px 0;font-size:13px"><strong>N° Venta:</strong> ${sale.sale_number || '#' + sale.id}</p>
    ${sale.client_name ? `<p style="margin:4px 0;font-size:13px"><strong>Cliente:</strong> ${sale.client_name}</p>` : ''}
    <table style="border-collapse:collapse;width:100%;font-size:12px;margin:12px 0">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:5px 10px;border:1px solid #ddd;text-align:left">Producto</th>
          <th style="padding:5px 10px;border:1px solid #ddd">Cant.</th>
          <th style="padding:5px 10px;border:1px solid #ddd;text-align:right">P.Unit.</th>
          <th style="padding:5px 10px;border:1px solid #ddd;text-align:right">Subtotal</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    ${sale.discount > 0 ? `<p style="text-align:right;font-size:12px;margin:3px 0"><strong>Descuento:</strong> -${fmt(sale.discount)}</p>` : ''}
    ${sale.surcharge_rate > 0 ? `<p style="text-align:right;font-size:12px;margin:3px 0;color:#b45309"><strong>Recargo ${sale.surcharge_rate}%:</strong> +${fmt(sale.total - (sale.subtotal - (sale.discount||0)))}</p>` : ''}
    <p style="text-align:right;font-size:18px;font-weight:bold;margin:8px 0">TOTAL: ${fmt(sale.total)}</p>
    <p style="font-size:13px;margin:4px 0"><strong>Pago:</strong> ${sale.payment_method}${sale.installments > 1 ? ` (${sale.installments} cuotas)` : ''}</p>
    ${sale.cae ? `<div style="background:#f0f0ff;border:1px solid #cce;padding:8px 12px;border-radius:4px;margin-top:12px;font-size:12px">
      <p style="color:#446;font-weight:bold;margin:0 0 4px">Comprobante Electrónico AFIP/ARCA</p>
      <p style="margin:2px 0"><strong>CAE:</strong> <span style="font-family:monospace">${sale.cae}</span></p>
      ${caeFmtVto ? `<p style="margin:2px 0"><strong>Vto. CAE:</strong> ${caeFmtVto}</p>` : ''}
    </div>` : ''}
    <p style="color:#aaa;font-size:11px;margin-top:20px;border-top:1px solid #eee;padding-top:6px">Gracias por su compra. Enviado desde ${bizName}.</p>
  </div>`
}

ipcMain.handle('email:sendTicket', async (_, { saleId, toEmail }) => {
  try {
    const s = getEmailConfig()
    if (!s.email_user && !s.email_from) return { ok: false, error: 'Email de envío no configurado en Configuración' }
    if (!s.email_pass) return { ok: false, error: 'Contraseña de email no configurada' }
    if (!toEmail) return { ok: false, error: 'No hay email de destino' }

    const db = getDB()
    const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId)
    if (!sale) return { ok: false, error: 'Venta no encontrada' }
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(saleId)
    const biz = {
      business_name:    db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA',
      business_address: db.prepare("SELECT value FROM settings WHERE key='business_address'").get()?.value || '',
      business_phone:   db.prepare("SELECT value FROM settings WHERE key='business_phone'").get()?.value || '',
      business_logo:    db.prepare("SELECT value FROM settings WHERE key='business_logo'").get()?.value || '',
    }

    const html = buildTicketEmailHtml(sale, items, biz)
    const bizName = biz.business_name || 'DELPA'
    const tipoLabel = sale.tipo_cbte === 11 ? 'Factura C' : sale.tipo_cbte === 6 ? 'Factura B' : sale.tipo_cbte === 1 ? 'Factura A' : 'Ticket'

    const transporter = buildTransporter(s)
    await transporter.sendMail({
      from: `"${bizName}" <${s.email_user || s.email_from}>`,
      to: toEmail,
      subject: `[${bizName}] ${tipoLabel} — ${new Date(sale.created_at).toLocaleDateString('es-AR')}`,
      html,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('email:saveTicketPDF', async (_, saleId) => {
  try {
    const { app } = require('electron')
    const db = getDB()
    const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId)
    if (!sale) return { ok: false, error: 'Venta no encontrada' }
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(saleId)
    const biz = {
      business_name:    db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA',
      business_address: db.prepare("SELECT value FROM settings WHERE key='business_address'").get()?.value || '',
      business_phone:   db.prepare("SELECT value FROM settings WHERE key='business_phone'").get()?.value || '',
      business_logo:    db.prepare("SELECT value FROM settings WHERE key='business_logo'").get()?.value || '',
    }

    const html = buildTicketEmailHtml(sale, items, biz)
    const pdfBuffer = await generatePDF(html)

    const downloadsPath = app.getPath('downloads')
    const saleLabel = sale.sale_number || `V${sale.id}`
    const filename = `Ticket-${saleLabel}-${new Date().toISOString().slice(0,10)}.pdf`
    const filePath = path.join(downloadsPath, filename)
    fs.writeFileSync(filePath, pdfBuffer)
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

function buildInventoryReportHTML(session, items, operatorName, biz) {
  const fmt = n => new Intl.NumberFormat('es-AR').format(n ?? 0)
  const fmtDate = s => s ? new Date(s).toLocaleString('es-AR') : '—'
  const withDiff = items.filter(i => i.difference !== 0)
  const bizName = biz.business_name || 'DELPA'

  const rows = items.map(it => {
    const d = it.difference
    const cls = d < 0 ? 'color:#dc2626' : d > 0 ? 'color:#16a34a' : 'color:#666'
    return `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee">${it.product_name}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">${it.size}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.system_stock)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.real_stock)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;${cls}">${d > 0 ? '+' : ''}${fmt(d)}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Inventario #${session.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px}
h1{font-size:18px;font-weight:bold;margin-bottom:4px}h2{font-size:11px;font-weight:bold;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #333;padding-bottom:3px}
table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f0f0f0;padding:5px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#555}
.sb{border:1px solid #ccc;border-radius:4px;padding:10px 14px;margin-bottom:14px;font-size:12px}.sr{display:flex;justify-content:space-between;padding:2px 0}
.footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:10px;text-align:center}
@media print{@page{size:A4;margin:15mm}}</style>
</head><body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin-bottom:6px" alt="logo">` : ''}
<h1>${bizName} — Reporte de Inventario</h1>
<div class="sb">
  <div class="sr"><span>Sesión N°:</span><span>${session.id}</span></div>
  <div class="sr"><span>Inicio:</span><span>${fmtDate(session.created_at)}</span></div>
  <div class="sr"><span>Cierre:</span><span>${fmtDate(session.closed_at)}</span></div>
  ${session.notes ? `<div class="sr"><span>Notas:</span><span>${session.notes}</span></div>` : ''}
  ${operatorName ? `<div class="sr"><span>Operario:</span><span>${operatorName}</span></div>` : ''}
</div>
<div class="sb">
  <div class="sr"><span>Total productos relevados:</span><span>${items.length}</span></div>
  <div class="sr"><span>Con diferencia:</span><span style="font-weight:bold;color:${withDiff.length > 0 ? '#dc2626' : '#16a34a'}">${withDiff.length}</span></div>
  <div class="sr"><span>Sin diferencia:</span><span>${items.length - withDiff.length}</span></div>
</div>
<h2>Detalle completo</h2>
<table>
  <thead><tr><th>Producto</th><th style="text-align:center">Talle</th><th style="text-align:right">Sistema</th><th style="text-align:right">Contado</th><th style="text-align:right">Diferencia</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${operatorName ? `<div style="margin-top:40px;border-top:1px solid #333;width:200px;padding-top:4px;font-size:11px">Firma: ${operatorName}</div>` : ''}
<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body></html>`
}

async function sendInventoryReport(session, items, operatorName) {
  const s = getEmailConfig()
  if (!s.email_user && !s.email_from) return
  if (!s.email_pass || !s.email_to) return

  const db = getDB()
  const biz = {
    business_name:  db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA',
    business_logo:  db.prepare("SELECT value FROM settings WHERE key='business_logo'").get()?.value || '',
  }

  const html = buildInventoryReportHTML(session, items, operatorName, biz)
  let pdfBuffer = null
  try { pdfBuffer = await generatePDF(html) } catch {}

  const transporter = buildTransporter(s)
  const mailOpts = {
    from: `"${biz.business_name}" <${s.email_user || s.email_from}>`,
    to: s.email_to,
    subject: `[${biz.business_name}] Inventario cerrado — ${new Date().toLocaleDateString('es-AR')}`,
    html: `<div style="font-family:sans-serif"><h2>Inventario cerrado</h2>
      <p>${items.length} productos relevados, ${items.filter(i=>i.difference!==0).length} con diferencia.</p>
      <p style="color:#888;font-size:12px">Se adjunta el reporte completo en PDF.</p></div>`,
  }
  if (pdfBuffer) {
    mailOpts.attachments = [{
      filename: `Inventario-${new Date().toISOString().split('T')[0]}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }]
  }
  await transporter.sendMail(mailOpts)
}

function buildPointsEmailHtml(data, biz) {
  const { clientName, saleNumber, saleTotal, itemsHtml, earned, totalPoints, pointValue, pointsPerPesos, minRedeem } = data
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const bizName = biz.business_name || 'DELPA'
  const moneyEquiv = totalPoints * pointValue

  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#333">
    ${biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
    <h2 style="margin-bottom:4px">${bizName}</h2>
    ${biz.business_address ? `<p style="color:#888;font-size:12px;margin:2px 0">${biz.business_address}</p>` : ''}
    ${biz.business_phone ? `<p style="color:#888;font-size:12px;margin:2px 0">Tel: ${biz.business_phone}</p>` : ''}
    <p style="color:#666;font-size:13px;margin:12px 0 16px">Hola <strong>${clientName}</strong>, ¡gracias por tu compra en ${bizName}!</p>
    <hr style="border:1px solid #eee;margin-bottom:16px">
    <p style="font-size:13px;margin:0 0 4px"><strong>N° Venta:</strong> ${saleNumber}</p>
    <p style="font-size:13px;margin:0 0 16px"><strong>Total:</strong> ${fmt(saleTotal)}</p>
    ${itemsHtml ? `<table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:16px">
      <thead><tr style="background:#f5f5f5">
        <th style="padding:5px 10px;border:1px solid #ddd;text-align:left">Producto</th>
        <th style="padding:5px 10px;border:1px solid #ddd">Cant.</th>
        <th style="padding:5px 10px;border:1px solid #ddd;text-align:right">Subtotal</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>` : ''}
    <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #86efac;border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">
      <p style="color:#166534;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.5px">Puntos ganados en esta compra</p>
      <p style="color:#15803d;font-size:32px;font-weight:bold;margin:0">+${earned} puntos</p>
    </div>
    <div style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;padding:12px 16px">
      <div style="display:flex;justify-content:space-between;margin:4px 0;font-size:13px">
        <span style="color:#666">Tu saldo total de puntos:</span>
        <span style="font-weight:bold">${totalPoints} puntos</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin:4px 0;font-size:13px">
        <span style="color:#666">Podés canjearlos por:</span>
        <span style="font-weight:bold;color:#15803d">${fmt(moneyEquiv)} de descuento</span>
      </div>
    </div>
    ${pointsPerPesos ? `
    <div style="margin-top:20px;background:linear-gradient(135deg,#fff0f6,#ffe4ef);border:1px solid #f9a8d4;border-radius:10px;padding:18px">
      <p style="color:#be185d;font-size:13px;font-weight:bold;margin:0 0 10px;text-align:center">💗 ¿Cómo funciona nuestro programa de fidelización?</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr>
          <td style="padding:5px 8px;color:#9d174d">✨ Por cada <strong>${fmt(pointsPerPesos)}</strong> de compra acumulás</td>
          <td style="padding:5px 8px;text-align:right;font-weight:bold;color:#be185d">1 punto</td>
        </tr>
        <tr style="background:rgba(255,255,255,0.5)">
          <td style="padding:5px 8px;color:#9d174d">💰 Cada punto equivale a</td>
          <td style="padding:5px 8px;text-align:right;font-weight:bold;color:#be185d">${fmt(pointValue)} de descuento</td>
        </tr>
        ${minRedeem ? `<tr>
          <td style="padding:5px 8px;color:#9d174d">🎁 Con <strong>${minRedeem} puntos</strong> podés canjear</td>
          <td style="padding:5px 8px;text-align:right;font-weight:bold;color:#be185d">${fmt(minRedeem * pointValue)}</td>
        </tr>` : ''}
      </table>
      <p style="color:#be185d;font-size:11px;text-align:center;margin:10px 0 0">¡Seguí comprando y acumulá más beneficios!</p>
    </div>` : ''}
    <p style="color:#aaa;font-size:11px;margin-top:20px;border-top:1px solid #eee;padding-top:8px">
      ${biz.business_address || biz.business_phone ? `${biz.business_address || ''}${biz.business_address && biz.business_phone ? ' · ' : ''}${biz.business_phone ? 'Tel: ' + biz.business_phone : ''}<br>` : ''}
      Enviado automáticamente por ${bizName} Gestión PRO.
    </p>
  </div>`
}

async function sendPointsSummaryAsync({ clientId, saleId, saleNumber, saleTotal, earned }) {
  try {
    const s = getEmailConfig()
    const smtpUser = s.email_user || s.email_from
    if (!smtpUser || !s.email_pass) return

    const db = getDB()
    const client = db.prepare('SELECT name, email, points FROM clients WHERE id=?').get(clientId)
    if (!client?.email) return

    const biz = {
      business_name:    db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA',
      business_logo:    db.prepare("SELECT value FROM settings WHERE key='business_logo'").get()?.value || '',
      business_address: db.prepare("SELECT value FROM settings WHERE key='business_address'").get()?.value || '',
      business_phone:   db.prepare("SELECT value FROM settings WHERE key='business_phone'").get()?.value || '',
    }
    const pointValue     = parseInt(db.prepare("SELECT value FROM settings WHERE key='point_value'").get()?.value     || '100',  10)
    const pointsPerPesos = parseInt(db.prepare("SELECT value FROM settings WHERE key='points_per_pesos'").get()?.value || '1000', 10)
    const minRedeem      = parseInt(db.prepare("SELECT value FROM settings WHERE key='points_min_redeem'").get()?.value || '5',    10)
    const items = db.prepare('SELECT product_name, size, quantity, unit_price FROM sale_items WHERE sale_id=?').all(saleId)
    const itemsHtml = items.map(it => `<tr>
      <td style="padding:4px 10px;border:1px solid #ddd">${it.product_name} T.${it.size}</td>
      <td style="padding:4px 10px;border:1px solid #ddd;text-align:center">${it.quantity}</td>
      <td style="padding:4px 10px;border:1px solid #ddd;text-align:right">$${Number(it.unit_price * it.quantity).toFixed(2)}</td>
    </tr>`).join('')

    const html = buildPointsEmailHtml({
      clientName: client.name,
      saleNumber,
      saleTotal,
      itemsHtml,
      earned,
      totalPoints: client.points || 0,
      pointValue,
      pointsPerPesos,
      minRedeem,
    }, biz)

    // Build transporter directly — client points email doesn't need email_to (operator address)
    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: (s.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
      port: parseInt(s.email_port || '587', 10),
      secure: s.email_port === '465',
      requireTLS: s.email_port !== '465',
      auth: { user: smtpUser, pass: s.email_pass },
      tls: { minVersion: 'TLSv1.2' },
    })
    await transporter.sendMail({
      from: `"${biz.business_name}" <${smtpUser}>`,
      to: client.email,
      subject: `Tu compra en ${biz.business_name} - Puntos acumulados`,
      html,
    })

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('EMAIL','sales',?,'Email de puntos enviado al cliente',?)`)
      .run(saleId, JSON.stringify({ clientId, email: client.email, earned, totalPoints: client.points }))
  } catch (e) {
    console.error('[email:points]', e.message)
  }
}

ipcMain.handle('email:sendPointsSummary', async (_, data) => {
  try { await sendPointsSummaryAsync(data); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

async function sendExpiryNotification(daysDiff, expiryDate) {
  try {
    const s = getEmailConfig()
    if (!s.email_user && !s.email_from) return
    if (!s.email_pass || !s.email_to) return

    const db = getDB()
    const bizName = db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA'
    const fmtDate = `${expiryDate.slice(6, 8)}/${expiryDate.slice(4, 6)}/${expiryDate.slice(0, 4)}`
    const isExpired = daysDiff < 0
    const isUrgent  = daysDiff <= 3

    const subject = isExpired
      ? `[${bizName}] ⚠️ Licencia VENCIDA — Renovar urgente`
      : `[${bizName}] ⏰ Licencia vence en ${daysDiff} día${daysDiff !== 1 ? 's' : ''}`

    const color = isExpired ? '#dc2626' : isUrgent ? '#dc2626' : '#d97706'

    const html = `<div style="font-family:sans-serif;max-width:520px;color:#333">
      <h2 style="color:${color}">${isExpired ? '⚠️ Licencia vencida' : `⏰ Licencia vence en ${daysDiff} día${daysDiff !== 1 ? 's' : ''}`}</h2>
      <p>La licencia de <strong>${bizName}</strong> ${isExpired ? `venció el <strong>${fmtDate}</strong>.` : `vence el <strong>${fmtDate}</strong>.`}</p>
      ${isExpired
        ? `<p style="color:#dc2626;font-weight:bold">El sistema está en período de gracia de 3 días. Si no se renueva, el acceso quedará bloqueado.</p>`
        : `<p>Contactá a tu proveedor para obtener un nuevo código de activación antes del vencimiento.</p>`
      }
      <p style="color:#aaa;font-size:11px;margin-top:20px">DELPA Gestión PRO — aviso automático</p>
    </div>`

    const transporter = buildTransporter(s)
    await transporter.sendMail({
      from: `"${bizName}" <${s.email_user || s.email_from}>`,
      to: s.email_to,
      subject,
      html,
    })
  } catch (e) {
    console.error('[email:expiry]', e.message)
  }
}

function buildStockReportHTML(products, biz) {
  const fmt  = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const bizName = biz.business_name || 'DELPA'
  const totalUnits = products.reduce((s, p) => s + p.sizes.reduce((ss, x) => ss + x.stock, 0), 0)
  const totalValue = products.reduce((s, p) => s + p.sizes.reduce((ss, x) => ss + x.stock * p.price, 0), 0)
  const low = products.filter(p => p.sizes.reduce((s, x) => s + x.stock, 0) <= (p.min_stock || 5))

  const rows = products.map(p => {
    const sizes = p.sizes.filter(s => s.stock > 0)
    const total = sizes.reduce((s, x) => s + x.stock, 0)
    const isLow = total <= (p.min_stock || 5)
    return `<tr style="background:${isLow ? '#fff0f0' : 'white'}">
      <td style="padding:4px 6px;border-bottom:1px solid #eee">${p.name}${p.color ? ` <span style="color:#888">${p.color}</span>` : ''}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #eee;color:#777">${p.category || '—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;color:#555">${p.barcode || ''}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${fmt(p.price)}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px">${sizes.map(s => `${s.size}:${s.stock}`).join(' | ') || '—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:${isLow ? '#dc2626' : '#166534'}">${total}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;padding:16px;color:#1a1a1a}
h1{font-size:18px;font-weight:bold;margin-bottom:2px}
.meta{color:#666;font-size:11px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#f0f0f0;padding:5px 6px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#555}
.summary{margin-top:16px;padding:12px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:12px}
.summary p{margin:3px 0}.low{color:#dc2626;font-weight:bold}
@media print{@page{size:A4;margin:12mm}}</style>
</head><body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:36px;object-fit:contain;margin-bottom:6px" alt="logo">` : ''}
<h1>${bizName} — Reporte de Stock</h1>
<p class="meta">Generado: ${new Date().toLocaleString('es-AR')} · ${products.length} productos · ${totalUnits} unidades totales</p>
<table>
<thead><tr><th>Producto</th><th>Categoría</th><th>Código</th><th style="text-align:right">Precio</th><th>Stock por talle</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="summary">
  <p><strong>Total de productos:</strong> ${products.length}</p>
  <p><strong>Total de unidades:</strong> ${totalUnits.toLocaleString('es-AR')}</p>
  <p><strong>Valor total del inventario:</strong> ${fmt(totalValue)}</p>
  ${low.length > 0 ? `<p class="low">⚠ ${low.length} productos con stock bajo o sin stock</p>` : ''}
</div>
<div style="margin-top:16px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:10px;text-align:center">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body></html>`
}

ipcMain.handle('email:sendStockReport', async () => {
  try {
    const s = getEmailConfig()
    if (!s.email_user && !s.email_from) return { ok: false, error: 'Email de envío no configurado en Configuración → Email' }
    if (!s.email_pass) return { ok: false, error: 'Contraseña de email no configurada' }
    if (!s.email_to)   return { ok: false, error: 'Email destinatario no configurado' }

    const db = getDB()
    const biz = {
      business_name:    db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA',
      business_address: db.prepare("SELECT value FROM settings WHERE key='business_address'").get()?.value || '',
      business_phone:   db.prepare("SELECT value FROM settings WHERE key='business_phone'").get()?.value || '',
      business_cuit:    db.prepare("SELECT value FROM settings WHERE key='business_cuit'").get()?.value || '',
      business_logo:    db.prepare("SELECT value FROM settings WHERE key='business_logo'").get()?.value || '',
    }

    const rawProducts = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY name ASC').all()
    const getSizes = db.prepare('SELECT size, stock FROM product_sizes WHERE product_id=? ORDER BY size ASC')
    const products = rawProducts.map(p => ({ ...p, sizes: getSizes.all(p.id) }))

    const html = buildStockReportHTML(products, biz)
    let pdfBuffer = null
    try { pdfBuffer = await generatePDF(html) } catch (e) {
      console.error('[email:stock] PDF error:', e.message)
    }

    const bizName = biz.business_name || 'DELPA'
    const dateStr = new Date().toLocaleDateString('es-AR')
    const transporter = buildTransporter(s)
    const mailOpts = {
      from: `"${bizName}" <${s.email_user || s.email_from}>`,
      to: s.email_to,
      subject: `Stock general - ${bizName} - ${dateStr}`,
      html: `<div style="font-family:sans-serif;max-width:560px">
        <h2 style="color:#333">${bizName} — Reporte de Stock</h2>
        <p style="color:#666">Fecha: ${dateStr}</p>
        <p style="color:#555;font-size:13px">${products.length} productos · ${products.reduce((s,p)=>s+p.sizes.reduce((ss,x)=>ss+x.stock,0),0)} unidades totales</p>
        <p style="color:#999;font-size:12px;margin-top:16px">Se adjunta el reporte completo en PDF. Generado por DELPA Gestión PRO.</p>
      </div>`,
    }
    if (pdfBuffer) {
      mailOpts.attachments = [{
        filename: `Stock-${bizName.replace(/\s+/g,'-')}-${new Date().toISOString().split('T')[0]}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }]
    }
    await transporter.sendMail(mailOpts)
    return { ok: true, email_to: s.email_to }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

async function sendWaitlistArrivalEmail(entry) {
  const s = getEmailConfig()
  if (!s.email_host || !s.email_user || !s.email_pass) return
  if (!entry.client_phone) return
  const db = getDB()
  const client = db.prepare("SELECT email FROM clients WHERE phone=? AND email!='' AND active=1 LIMIT 1").get(entry.client_phone)
  if (!client?.email) return
  const biz = Object.fromEntries(
    db.prepare("SELECT key,value FROM settings WHERE key LIKE 'business_%'").all().map(r => [r.key, r.value])
  )
  const transporter = buildTransporter(s)
  await transporter.sendMail({
    from: `"${biz.business_name || 'DELPA'}" <${s.email_user}>`,
    to: client.email,
    subject: `¡Tu producto llegó! — ${entry.product_name}`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin-bottom:8px">¡Buenas noticias, ${entry.client_name}!</h2>
      <p>El producto que estabas esperando ya está disponible:</p>
      <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0;font-size:15px">
        <strong>${entry.product_name}</strong>
        ${entry.size  ? `<br><span style="color:#555">Talle: ${entry.size}</span>`  : ''}
        ${entry.color ? `<br><span style="color:#555">Color: ${entry.color}</span>` : ''}
      </div>
      <p>Acercate al local o comunicate con nosotros para reservarlo antes de que se agote.</p>
      <p style="color:#888;font-size:12px;margin-top:24px">${biz.business_name || ''} ${biz.business_phone ? `— ${biz.business_phone}` : ''}</p>
    </div>`,
  })
}

module.exports = { sendCashboxReport, sendInventoryReport, sendPointsSummaryAsync, sendExpiryNotification, sendWaitlistArrivalEmail }
