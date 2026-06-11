const { ipcMain, dialog, app } = require('electron')
const { getDB } = require('../../database/db')
const fs = require('fs')
const path = require('path')

function getPeriodDates(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

ipcMain.handle('ivabook:ventas', (_, { year, month }) => {
  const db = getDB()
  const { from, to } = getPeriodDates(year, month)
  const ivaRate = 0.21

  const rows = db.prepare(`
    SELECT
      i.id,
      date(i.created_at) as fecha,
      i.tipo_cbte,
      i.pto_venta,
      i.cbte_nro,
      i.cae,
      i.client_name as razon_social,
      i.client_dni as cuit_cliente,
      i.total,
      s.doc_nro
    FROM invoices i
    LEFT JOIN sales s ON s.id = i.sale_id
    WHERE i.cae IS NOT NULL AND i.cae != ''
      AND date(i.created_at) BETWEEN ? AND ?
    ORDER BY i.created_at
  `).all(from, to)

  return rows.map(r => {
    const neto = parseFloat((r.total / (1 + ivaRate)).toFixed(2))
    const iva  = parseFloat((r.total - neto).toFixed(2))
    const tipo = r.tipo_cbte === 1 ? 'FA' : r.tipo_cbte === 6 ? 'FB' : r.tipo_cbte === 11 ? 'FC' : 'XX'
    const pv   = String(r.pto_venta || 1).padStart(4, '0')
    const nro  = String(r.cbte_nro || 0).padStart(8, '0')
    return {
      fecha: r.fecha,
      tipo,
      punto_venta: pv,
      numero: nro,
      cuit_cliente: r.cuit_cliente || r.doc_nro || '',
      razon_social: r.razon_social || 'Consumidor Final',
      neto_gravado: neto,
      iva,
      total: r.total,
      cae: r.cae,
    }
  })
})

ipcMain.handle('ivabook:compras', (_, { year, month }) => {
  const db = getDB()
  const { from, to } = getPeriodDates(year, month)
  const ivaRate = 0.21

  const rows = db.prepare(`
    SELECT
      p.id,
      date(p.created_at) as fecha,
      p.invoice_number,
      p.total,
      s.name as supplier_name,
      s.cuit as supplier_cuit
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE date(p.created_at) BETWEEN ? AND ?
    ORDER BY p.created_at
  `).all(from, to)

  return rows.map((r, i) => {
    const neto = parseFloat((r.total / (1 + ivaRate)).toFixed(2))
    const iva  = parseFloat((r.total - neto).toFixed(2))
    // Parse invoice number to extract punto_venta / numero if formatted as PPPP-NNNNNNNN
    let pv = '0001', nro = String(i + 1).padStart(8, '0')
    if (r.invoice_number) {
      const match = r.invoice_number.match(/^(\d{4})-(\d+)$/)
      if (match) { pv = match[1]; nro = match[2].padStart(8, '0') }
    }
    return {
      fecha: r.fecha,
      tipo: 'FC',
      punto_venta: pv,
      numero: nro,
      cuit_proveedor: r.supplier_cuit || '',
      razon_social: r.supplier_name || '',
      neto: neto,
      iva,
      total: r.total,
    }
  })
})

ipcMain.handle('ivabook:exportCSV', async (_, { type, year, month }) => {
  const db = getDB()
  const { from, to } = getPeriodDates(year, month)
  const ivaRate = 0.21

  let csvContent = ''
  let defaultName = ''

  if (type === 'ventas') {
    const rows = db.prepare(`
      SELECT date(i.created_at) as fecha, i.tipo_cbte, i.pto_venta, i.cbte_nro, i.cae,
             i.client_name, i.client_dni, i.total
      FROM invoices i
      WHERE i.cae IS NOT NULL AND i.cae != ''
        AND date(i.created_at) BETWEEN ? AND ?
      ORDER BY i.created_at
    `).all(from, to)

    csvContent = 'Fecha,Tipo,Pto.Venta,Numero,CUIT Cliente,Razon Social,Neto Gravado,IVA 21%,Total,CAE\n'
    csvContent += rows.map(r => {
      const neto = (r.total / (1 + ivaRate)).toFixed(2)
      const iva  = (r.total - parseFloat(neto)).toFixed(2)
      const tipo = r.tipo_cbte === 1 ? 'FA' : r.tipo_cbte === 6 ? 'FB' : r.tipo_cbte === 11 ? 'FC' : 'XX'
      return [
        r.fecha,
        tipo,
        String(r.pto_venta || 1).padStart(4, '0'),
        String(r.cbte_nro || 0).padStart(8, '0'),
        r.client_dni || '',
        `"${(r.client_name || 'Consumidor Final').replace(/"/g, '""')}"`,
        neto, iva,
        r.total.toFixed(2),
        r.cae || '',
      ].join(',')
    }).join('\n')
    defaultName = `IVA_Ventas_${year}_${String(month).padStart(2, '0')}.csv`
  } else {
    const rows = db.prepare(`
      SELECT date(p.created_at) as fecha, p.invoice_number, p.total,
             s.name as supplier_name, s.cuit as supplier_cuit
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE date(p.created_at) BETWEEN ? AND ?
      ORDER BY p.created_at
    `).all(from, to)

    csvContent = 'Fecha,Tipo,Pto.Venta,Numero,CUIT Proveedor,Razon Social,Neto,IVA 21%,Total\n'
    csvContent += rows.map((r, i) => {
      const neto = (r.total / (1 + ivaRate)).toFixed(2)
      const iva  = (r.total - parseFloat(neto)).toFixed(2)
      let pv = '0001', nro = String(i + 1).padStart(8, '0')
      if (r.invoice_number) {
        const match = r.invoice_number.match(/^(\d{4})-(\d+)$/)
        if (match) { pv = match[1]; nro = match[2].padStart(8, '0') }
      }
      return [
        r.fecha, 'FC', pv, nro,
        r.supplier_cuit || '',
        `"${(r.supplier_name || '').replace(/"/g, '""')}"`,
        neto, iva, r.total.toFixed(2),
      ].join(',')
    }).join('\n')
    defaultName = `IVA_Compras_${year}_${String(month).padStart(2, '0')}.csv`
  }

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Guardar Libro IVA',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }

  fs.writeFileSync(filePath, '﻿' + csvContent, 'utf8') // BOM for Excel
  return { ok: true, filePath }
})

ipcMain.handle('ivabook:exportSIAP', async (_, { year, month }) => {
  const db = getDB()
  const { from, to } = getPeriodDates(year, month)
  const ivaRate = 0.21

  const rows = db.prepare(`
    SELECT date(i.created_at) as fecha, i.tipo_cbte, i.pto_venta, i.cbte_nro,
           i.client_dni, i.client_name, i.total
    FROM invoices i
    WHERE i.cae IS NOT NULL AND i.cae != ''
      AND date(i.created_at) BETWEEN ? AND ?
    ORDER BY i.created_at
  `).all(from, to)

  const lines = rows.map(r => {
    const neto = (r.total / (1 + ivaRate)).toFixed(2)
    const iva  = (r.total - parseFloat(neto)).toFixed(2)
    const tipo = String(r.tipo_cbte || 6).padStart(3, '0')
    const pv   = String(r.pto_venta || 1).padStart(5, '0')
    const nro  = String(r.cbte_nro || 0).padStart(8, '0')
    const fechaFormatted = (r.fecha || '').replace(/-/g, '')
    return `${fechaFormatted}|${tipo}|${pv}|${nro}|${r.client_dni || '0'}|${r.client_name || 'CONSUMIDOR FINAL'}|${neto}|${iva}|${r.total.toFixed(2)}`
  }).join('\n')

  const defaultName = `SIAP_Ventas_${year}_${String(month).padStart(2, '0')}.txt`
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Guardar archivo SIAP',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Texto SIAP', extensions: ['txt'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }

  fs.writeFileSync(filePath, lines, 'utf8')
  return { ok: true, filePath }
})

ipcMain.handle('ivabook:emailContador', async (_, { year, month }) => {
  const db = getDB()
  const emailContador = db.prepare("SELECT value FROM settings WHERE key='email_contador'").get()?.value || ''
  if (!emailContador) return { ok: false, error: 'No hay email de contador configurado (email_contador en Configuración)' }

  // Generate CSV files and email them
  const { from, to } = getPeriodDates(year, month)
  const ivaRate = 0.21
  const tmpDir = app.getPath('temp')

  const ventas = db.prepare(`
    SELECT date(i.created_at) as fecha, i.tipo_cbte, i.pto_venta, i.cbte_nro, i.cae,
           i.client_name, i.client_dni, i.total
    FROM invoices i
    WHERE i.cae IS NOT NULL AND i.cae != ''
      AND date(i.created_at) BETWEEN ? AND ?
    ORDER BY i.created_at
  `).all(from, to)

  const compras = db.prepare(`
    SELECT date(p.created_at) as fecha, p.invoice_number, p.total,
           s.name as supplier_name, s.cuit as supplier_cuit
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE date(p.created_at) BETWEEN ? AND ?
    ORDER BY p.created_at
  `).all(from, to)

  const monthPad = String(month).padStart(2, '0')
  const ventasPath  = path.join(tmpDir, `IVA_Ventas_${year}_${monthPad}.csv`)
  const comprasPath = path.join(tmpDir, `IVA_Compras_${year}_${monthPad}.csv`)

  let ventasCSV = 'Fecha,Tipo,Pto.Venta,Numero,CUIT Cliente,Razon Social,Neto Gravado,IVA 21%,Total,CAE\n'
  ventasCSV += ventas.map(r => {
    const neto = (r.total / (1 + ivaRate)).toFixed(2)
    const iva  = (r.total - parseFloat(neto)).toFixed(2)
    const tipo = r.tipo_cbte === 1 ? 'FA' : r.tipo_cbte === 6 ? 'FB' : r.tipo_cbte === 11 ? 'FC' : 'XX'
    return [r.fecha, tipo, String(r.pto_venta||1).padStart(4,'0'), String(r.cbte_nro||0).padStart(8,'0'), r.client_dni||'', `"${(r.client_name||'Consumidor Final').replace(/"/g,'""')}"`, neto, iva, r.total.toFixed(2), r.cae||''].join(',')
  }).join('\n')

  let comprasCSV = 'Fecha,Tipo,Pto.Venta,Numero,CUIT Proveedor,Razon Social,Neto,IVA 21%,Total\n'
  comprasCSV += compras.map((r, i) => {
    const neto = (r.total / (1 + ivaRate)).toFixed(2)
    const iva  = (r.total - parseFloat(neto)).toFixed(2)
    let pv = '0001', nro = String(i+1).padStart(8,'0')
    if (r.invoice_number) { const m = r.invoice_number.match(/^(\d{4})-(\d+)$/); if(m){pv=m[1];nro=m[2].padStart(8,'0')} }
    return [r.fecha,'FC',pv,nro,r.supplier_cuit||'',`"${(r.supplier_name||'').replace(/"/g,'""')}"`,neto,iva,r.total.toFixed(2)].join(',')
  }).join('\n')

  fs.writeFileSync(ventasPath,  '﻿' + ventasCSV,  'utf8')
  fs.writeFileSync(comprasPath, '﻿' + comprasCSV, 'utf8')

  try {
    const nodemailer = require('nodemailer')
    const cfgRows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'email%'").all()
    const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]))
    const user = cfg.email_user || cfg.email_from
    if (!user || !cfg.email_pass) return { ok: false, error: 'Configuración de email incompleta' }

    const bizName = db.prepare("SELECT value FROM settings WHERE key='business_name'").get()?.value || 'DELPA'
    const transporter = nodemailer.createTransport({
      host: (cfg.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
      port: parseInt(cfg.email_port || '587', 10),
      secure: cfg.email_port === '465',
      requireTLS: cfg.email_port !== '465',
      auth: { user, pass: cfg.email_pass },
      tls: { minVersion: 'TLSv1.2' },
    })

    await transporter.sendMail({
      from: `"${bizName}" <${user}>`,
      to: emailContador,
      subject: `Libro IVA ${String(month).padStart(2,'0')}/${year} — ${bizName}`,
      text: `Adjunto los archivos de Libro IVA (ventas y compras) correspondientes al período ${String(month).padStart(2,'0')}/${year}.\n\nGenerado por DELPA Gestión PRO.`,
      attachments: [
        { filename: path.basename(ventasPath),  path: ventasPath },
        { filename: path.basename(comprasPath), path: comprasPath },
      ],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
