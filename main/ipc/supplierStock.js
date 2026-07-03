const { ipcMain, BrowserWindow, dialog } = require('electron')
const { getDB } = require('../../database/db')
const path = require('path')
const fs = require('fs')
const os = require('os')

const fmtARS = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)

// ── Helpers de datos ────────────────────────────────────────────────────────

function getBiz() {
  const db = getDB()
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'business_%'").all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

function getEmailConfig() {
  const db = getDB()
  const rows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'email%'").all()
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

// Bloques de stock por proveedor. Si supplierId es null → todos los proveedores con productos asociados.
function gatherSupplierStock(db, supplierId) {
  let suppliers
  if (supplierId) {
    const s = db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplierId)
    suppliers = s ? [s] : []
  } else {
    suppliers = db.prepare(`
      SELECT s.* FROM suppliers s
      WHERE s.active=1 AND EXISTS (SELECT 1 FROM products p WHERE p.supplier_id=s.id AND p.active=1)
      ORDER BY s.name
    `).all()
  }

  const prodStmt = db.prepare(`
    SELECT id, name, color, category, cost, price
    FROM products WHERE supplier_id=? AND active=1 ORDER BY name
  `)
  const sizeStmt = db.prepare('SELECT size, stock FROM product_sizes WHERE product_id=? AND stock>0 ORDER BY size')

  return suppliers.map(supplier => {
    const rawProducts = prodStmt.all(supplier.id)
    const products = []
    for (const p of rawProducts) {
      const sizes = sizeStmt.all(p.id)
      const units = sizes.reduce((s, x) => s + x.stock, 0)
      if (units === 0) continue
      products.push({
        ...p,
        sizes,
        units,
        value_cost: units * (p.cost || 0),
        value_price: units * (p.price || 0),
      })
    }
    const totals = {
      product_count: products.length,
      units: products.reduce((s, p) => s + p.units, 0),
      value_cost: products.reduce((s, p) => s + p.value_cost, 0),
      value_price: products.reduce((s, p) => s + p.value_price, 0),
    }
    return { supplier, products, totals }
  })
}

// Bloques de stock en consignación por proveedor.
function gatherConsignmentStock(db, supplierId) {
  const where = supplierId ? 'AND cp.supplier_id=?' : ''
  const params = supplierId ? [supplierId] : []
  const rows = db.prepare(`
    SELECT cp.product_id, cp.cost_per_unit, cp.supplier_id,
           p.name, p.color, p.category,
           s.name AS supplier_name, s.email AS supplier_email, s.id AS sid
    FROM consignment_products cp
    JOIN products p ON p.id = cp.product_id
    LEFT JOIN suppliers s ON s.id = cp.supplier_id
    WHERE cp.active=1 ${where}
    ORDER BY s.name, p.name
  `).all(...params)

  const sizeStmt = db.prepare('SELECT size, stock FROM product_sizes WHERE product_id=? AND stock>0 ORDER BY size')
  const soldStmt = db.prepare(`
    SELECT COALESCE(SUM(quantity),0) AS sold,
           COALESCE(SUM(CASE WHEN liquidated=1 THEN quantity ELSE 0 END),0) AS liquidated,
           COALESCE(SUM(CASE WHEN liquidated=0 THEN quantity ELSE 0 END),0) AS pending
    FROM consignment_sales WHERE product_id=?
  `)

  // Agrupar por proveedor
  const bySupplier = new Map()
  for (const r of rows) {
    const sid = r.supplier_id
    if (!bySupplier.has(sid)) {
      bySupplier.set(sid, {
        supplier: { id: sid, name: r.supplier_name || 'Sin proveedor', email: r.supplier_email || '' },
        products: [],
        totals: { product_count: 0, in_stock: 0, sold: 0, value_remaining: 0 },
      })
    }
    const block = bySupplier.get(sid)
    const sizes = sizeStmt.all(r.product_id)
    const inStock = sizes.reduce((s, x) => s + x.stock, 0)
    const sales = soldStmt.get(r.product_id)
    const initial = inStock + sales.sold
    const valueRemaining = inStock * (r.cost_per_unit || 0)
    block.products.push({
      product_id: r.product_id,
      name: r.name,
      color: r.color,
      sizes,
      cost_per_unit: r.cost_per_unit || 0,
      initial,
      sold: sales.sold,
      sold_liquidated: sales.liquidated,
      sold_pending: sales.pending,
      in_stock: inStock,
      value_remaining: valueRemaining,
    })
    block.totals.product_count++
    block.totals.in_stock += inStock
    block.totals.sold += sales.sold
    block.totals.value_remaining += valueRemaining
  }

  return Array.from(bySupplier.values())
}

// ── Builders de HTML / PDF ───────────────────────────────────────────────────

function buildSupplierStockHTML(block, biz, dateStr) {
  const { supplier, products, totals } = block
  const rows = products.map(p => {
    const sizesStr = p.sizes.map(s => `${s.size}:${s.stock}`).join(' · ') || '—'
    return `<tr>
      <td>${p.name}</td>
      <td style="font-size:10px">${sizesStr}</td>
      <td>${p.color || '—'}</td>
      <td class="r">${p.units}</td>
      <td class="r">${fmtARS(p.cost)}</td>
      <td class="r" style="font-weight:bold">${fmtARS(p.value_cost)}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Stock — ${supplier.name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:24px}
  h1{font-size:18px;font-weight:bold;margin-bottom:2px}
  h2{font-size:12px;font-weight:bold;margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid #333;text-transform:uppercase;letter-spacing:.5px}
  .biz-info{color:#555;margin-bottom:12px}.biz-info p{margin:2px 0}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.3px;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}.total-row td{font-weight:bold;background:#f9f9f9}
  .stats{display:flex;gap:12px;margin:12px 0}
  .stat{border:1px solid #ddd;border-radius:4px;padding:8px 14px;flex:1;text-align:center}
  .stat .n{font-size:18px;font-weight:bold}.stat .l{font-size:9px;color:#777;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:9px;text-align:center}
  @media print{@page{size:A4;margin:14mm}}
</style></head><body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:46px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
<h1>${biz.business_name || 'DELPA'}</h1>
<div class="biz-info">
  ${biz.business_address ? `<p>${biz.business_address}</p>` : ''}
  ${biz.business_phone ? `<p>Tel: ${biz.business_phone}</p>` : ''}
</div>
<h2>Stock de productos — ${supplier.name}</h2>
<p style="color:#777;margin-bottom:6px">Fecha: ${dateStr}</p>
<div class="stats">
  <div class="stat"><div class="n">${totals.product_count}</div><div class="l">Productos</div></div>
  <div class="stat"><div class="n">${totals.units}</div><div class="l">Unidades</div></div>
  <div class="stat"><div class="n">${fmtARS(totals.value_cost)}</div><div class="l">Valor al costo</div></div>
</div>
<table>
  <thead><tr><th>Producto</th><th>Stock por talle</th><th>Color</th><th class="r">Unid.</th><th class="r">Precio costo</th><th class="r">Valor total</th></tr></thead>
  <tbody>
    ${rows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:16px">Sin stock</td></tr>'}
    <tr class="total-row"><td colspan="3">TOTAL</td><td class="r">${totals.units}</td><td></td><td class="r">${fmtARS(totals.value_cost)}</td></tr>
  </tbody>
</table>
<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body></html>`
}

function buildConsignmentStockHTML(block, biz, dateStr) {
  const { supplier, products, totals } = block
  const rows = products.map(p => {
    const sizesStr = p.sizes.map(s => `${s.size}:${s.stock}`).join(' · ') || '—'
    return `<tr>
      <td>${p.name}</td>
      <td style="font-size:10px">${sizesStr}</td>
      <td>${p.color || '—'}</td>
      <td class="r">${p.initial}</td>
      <td class="r">${p.sold}</td>
      <td class="r" style="font-weight:bold">${p.in_stock}</td>
      <td class="r">${fmtARS(p.cost_per_unit)}</td>
      <td class="r" style="font-weight:bold">${fmtARS(p.value_remaining)}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Consignación — ${supplier.name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:24px}
  h1{font-size:18px;font-weight:bold;margin-bottom:2px}
  h2{font-size:12px;font-weight:bold;margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid #333;text-transform:uppercase;letter-spacing:.5px}
  .biz-info{color:#555;margin-bottom:12px}.biz-info p{margin:2px 0}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.3px;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}.total-row td{font-weight:bold;background:#f9f9f9}
  .stats{display:flex;gap:12px;margin:12px 0}
  .stat{border:1px solid #ddd;border-radius:4px;padding:8px 14px;flex:1;text-align:center}
  .stat .n{font-size:18px;font-weight:bold}.stat .l{font-size:9px;color:#777;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .sign{margin-top:48px;display:flex;justify-content:space-between}
  .sign div{width:45%;border-top:1px solid #333;padding-top:4px;font-size:10px;color:#555;text-align:center}
  .footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:9px;text-align:center}
  @media print{@page{size:A4;margin:14mm}}
</style></head><body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:46px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
<h1>${biz.business_name || 'DELPA'}</h1>
<div class="biz-info">
  ${biz.business_address ? `<p>${biz.business_address}</p>` : ''}
  ${biz.business_phone ? `<p>Tel: ${biz.business_phone}</p>` : ''}
</div>
<h2>Detalle de consignación — ${supplier.name}</h2>
<p style="color:#777;margin-bottom:6px">Fecha: ${dateStr}</p>
<div class="stats">
  <div class="stat"><div class="n">${totals.product_count}</div><div class="l">Productos</div></div>
  <div class="stat"><div class="n">${totals.in_stock}</div><div class="l">En stock</div></div>
  <div class="stat"><div class="n">${totals.sold}</div><div class="l">Vendidas</div></div>
  <div class="stat"><div class="n">${fmtARS(totals.value_remaining)}</div><div class="l">Valor en stock</div></div>
</div>
<table>
  <thead><tr><th>Producto</th><th>Stock por talle</th><th>Color</th><th class="r">Stock inicial</th><th class="r">Vendidas</th><th class="r">En stock</th><th class="r">Costo unit.</th><th class="r">Valor</th></tr></thead>
  <tbody>
    ${rows || '<tr><td colspan="8" style="text-align:center;color:#999;padding:16px">Sin productos en consignación</td></tr>'}
    <tr class="total-row"><td colspan="3">TOTAL</td><td></td><td class="r">${totals.sold}</td><td class="r">${totals.in_stock}</td><td></td><td class="r">${fmtARS(totals.value_remaining)}</td></tr>
  </tbody>
</table>
<div class="sign">
  <div>Firma ${biz.business_name || 'el local'}</div>
  <div>Firma proveedor (${supplier.name})</div>
</div>
<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body></html>`
}

async function htmlToPDF(html) {
  const tmpFile = path.join(os.tmpdir(), `supplier-stock-${Date.now()}.html`)
  fs.writeFileSync(tmpFile, html, 'utf8')
  const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { contextIsolation: true } })
  try {
    await win.loadFile(tmpFile)
    return await win.webContents.printToPDF({ landscape: true, printBackground: true, pageSize: 'A4' })
  } finally {
    win.destroy()
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

function buildHTML(mode, block, biz, dateStr) {
  return mode === 'consignment'
    ? buildConsignmentStockHTML(block, biz, dateStr)
    : buildSupplierStockHTML(block, biz, dateStr)
}

// ── IPC: datos ────────────────────────────────────────────────────────────────

// Proveedores que tienen productos asociados (para los selectores)
ipcMain.handle('supplierStock:suppliers', () => {
  const db = getDB()
  return db.prepare(`
    SELECT s.id, s.name, s.email,
           (SELECT COUNT(*) FROM products p WHERE p.supplier_id=s.id AND p.active=1) AS product_count
    FROM suppliers s
    WHERE s.active=1
    ORDER BY s.name
  `).all()
})

ipcMain.handle('supplierStock:report', (_, { supplier_id } = {}) => {
  return gatherSupplierStock(getDB(), supplier_id || null)
})

ipcMain.handle('supplierStock:consignment', (_, { supplier_id } = {}) => {
  return gatherConsignmentStock(getDB(), supplier_id || null)
})

// ── IPC: exportar PDF (diálogo de guardado) ─────────────────────────────────────

ipcMain.handle('supplierStock:exportPDF', async (_, { supplier_id, mode } = {}) => {
  const db = getDB()
  const blocks = mode === 'consignment'
    ? gatherConsignmentStock(db, supplier_id || null)
    : gatherSupplierStock(db, supplier_id || null)
  if (!blocks.length) return { ok: false, error: 'No hay datos para exportar' }

  const biz = getBiz()
  const dateStr = new Date().toLocaleDateString('es-AR')
  // Un solo PDF: si hay varios proveedores, se concatenan con salto de página
  const sep = '<div style="page-break-before:always"></div>'
  const html = blocks.map(b => buildHTML(mode, b, biz, dateStr)).join(sep)

  const label = blocks.length === 1 ? blocks[0].supplier.name.replace(/\s+/g, '-') : 'todos'
  const prefix = mode === 'consignment' ? 'consignacion' : 'stock-proveedor'
  const { filePath } = await dialog.showSaveDialog({
    title: 'Guardar PDF',
    defaultPath: `${prefix}_${label}_${new Date().toISOString().slice(0, 10)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!filePath) return { ok: false }

  const pdf = await htmlToPDF(html)
  fs.writeFileSync(filePath, pdf)
  return { ok: true, filePath }
})

// ── IPC: enviar por email al proveedor ──────────────────────────────────────────

ipcMain.handle('supplierStock:emailSupplier', async (_, { supplier_id, mode } = {}) => {
  try {
    if (!supplier_id) return { ok: false, error: 'Falta el proveedor' }
    const db = getDB()
    const s = getEmailConfig()
    const smtpUser = s.email_user || s.email_from
    if (!smtpUser || !s.email_pass) return { ok: false, error: 'Configurá el email de envío en Configuración → Email' }

    const blocks = mode === 'consignment'
      ? gatherConsignmentStock(db, supplier_id)
      : gatherSupplierStock(db, supplier_id)
    if (!blocks.length) return { ok: false, error: 'No hay datos para este proveedor' }
    const block = blocks[0]

    const supplierEmail = block.supplier.email
    if (!supplierEmail) {
      return { ok: false, error: 'Cargá el email del proveedor en su ficha para poder enviar', noEmail: true }
    }

    const biz = getBiz()
    const bizName = biz.business_name || 'DELPA'
    const dateStr = new Date().toLocaleDateString('es-AR')
    const monthYear = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    const supplierName = block.supplier.name

    let subject, bodyText
    if (mode === 'consignment') {
      subject = `Detalle de consignación — ${bizName} — ${dateStr}`
      bodyText = `Hola ${supplierName}, te enviamos el detalle actualizado de tu mercadería en consignación. Stock disponible, unidades vendidas y pendiente de liquidación.`
    } else if (mode === 'report') {
      subject = `Reporte de stock — ${bizName} — ${monthYear}`
      bodyText = `Hola ${supplierName}, adjuntamos el reporte de stock actualizado de tus productos.`
    } else {
      subject = `Stock de ${bizName} — ${dateStr}`
      bodyText = `Hola ${supplierName}, te enviamos el detalle del stock actual de tus productos en nuestro local. Cualquier consulta estamos a disposición.`
    }

    const html = buildHTML(mode, block, biz, dateStr)
    let pdf = null
    try { pdf = await htmlToPDF(html) } catch (e) { console.error('[supplierStock] PDF error:', e.message) }

    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: (s.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
      port: parseInt(s.email_port || '587', 10),
      secure: s.email_port === '465',
      requireTLS: s.email_port !== '465',
      auth: { user: smtpUser, pass: s.email_pass },
      tls: { minVersion: 'TLSv1.2' },
    })

    const mailOpts = {
      from: `"${bizName}" <${smtpUser}>`,
      to: supplierEmail,
      subject,
      html: `<div style="font-family:sans-serif;max-width:560px;color:#333">
        ${biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
        <h2 style="color:#333;margin-bottom:6px">${bizName}</h2>
        <p style="color:#555;font-size:14px;line-height:1.5">${bodyText}</p>
        <p style="color:#999;font-size:12px;margin-top:16px">Se adjunta el detalle en PDF. Enviado desde DELPA Gestión PRO.</p>
      </div>`,
    }
    if (pdf) {
      const prefix = mode === 'consignment' ? 'Consignacion' : 'Stock'
      mailOpts.attachments = [{
        filename: `${prefix}-${supplierName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }]
    }
    await transporter.sendMail(mailOpts)
    return { ok: true, email: supplierEmail }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

module.exports = {}
