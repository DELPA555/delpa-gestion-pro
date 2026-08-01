const { ipcMain, BrowserWindow } = require('electron')
const { getDB } = require('../../database/db')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { getCurrentSession } = require('./auth')

const fmtARS = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ── Config helpers ────────────────────────────────────────────────────────────

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

function isAdminSession() {
  return getCurrentSession()?.role === 'admin'
}

// Normaliza y sanea los filtros del renderer. El costo/valor SOLO se habilitan
// si la sesión es admin (la vendedora nunca ve el precio de costo).
function normalize(filters = {}) {
  const admin = isAdminSession()
  return {
    categories: Array.isArray(filters.categories) ? filters.categories : [],
    supplierIds: Array.isArray(filters.supplierIds) ? filters.supplierIds.map(Number).filter(Boolean) : [],
    productIds: Array.isArray(filters.productIds) ? filters.productIds.map(Number).filter(Boolean) : [],
    onlyWithStock: filters.onlyWithStock !== false,
    showPrice: filters.showPrice !== false,
    showCost: admin && !!filters.showCost,
    showValue: admin && !!filters.showValue,
    sortBy: ['name', 'category', 'supplier', 'stock'].includes(filters.sortBy) ? filters.sortBy : 'name',
  }
}

// ── Datos ─────────────────────────────────────────────────────────────────────

// Devuelve una lista plana de líneas (una por talle con stock).
function gatherItems(db, f) {
  const where = ['p.active=1']
  const params = []
  if (f.categories.length) {
    where.push(`p.category IN (${f.categories.map(() => '?').join(',')})`)
    params.push(...f.categories)
  }
  if (f.supplierIds.length) {
    where.push(`p.supplier_id IN (${f.supplierIds.map(() => '?').join(',')})`)
    params.push(...f.supplierIds)
  }
  if (f.productIds.length) {
    where.push(`p.id IN (${f.productIds.map(() => '?').join(',')})`)
    params.push(...f.productIds)
  }

  const prods = db.prepare(`
    SELECT p.id, p.name, p.color, p.category, p.cost, p.price, p.min_stock,
           p.supplier_id, s.name AS supplier_name
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.name
  `).all(...params)

  const sizeStmt = db.prepare(`
    SELECT size, stock FROM product_sizes WHERE product_id=?
    ORDER BY CASE WHEN size GLOB '[0-9]*' THEN CAST(size AS INTEGER) ELSE 999999 END, size
  `)

  const items = []
  for (const p of prods) {
    const sizes = sizeStmt.all(p.id)
    const rows = f.onlyWithStock ? sizes.filter(s => s.stock > 0) : sizes
    // Si se pide solo con stock y no queda nada, se salta el producto entero.
    if (f.onlyWithStock && rows.length === 0) continue
    const emit = rows.length ? rows : [{ size: '—', stock: 0 }]
    for (const s of emit) {
      items.push({
        product_id: p.id,
        name: p.name,
        color: p.color || '',
        category: p.category || 'Sin categoría',
        supplier_name: p.supplier_name || 'Sin proveedor',
        size: s.size,
        stock: s.stock,
        cost: p.cost || 0,
        price: p.price || 0,
      })
    }
  }
  return items
}

// Etiqueta legible del filtro aplicado, para el título del reporte.
function buildLabel(db, f) {
  const parts = []
  if (f.categories.length) parts.push('Categoría: ' + f.categories.join(', '))
  if (f.supplierIds.length) {
    const names = f.supplierIds
      .map(id => db.prepare('SELECT name FROM suppliers WHERE id=?').get(id)?.name)
      .filter(Boolean)
    if (names.length) parts.push('Proveedor: ' + names.join(', '))
  }
  if (f.productIds.length) parts.push(`Productos seleccionados (${f.productIds.length})`)
  return parts.length ? parts.join(' + ') : 'General'
}

// ── HTML / PDF ──────────────────────────────────────────────────────────────

function buildStockHTML(items, f, biz, meta) {
  const { showCost, showPrice, showValue } = f
  const groupBy = f.sortBy === 'category' ? 'category' : f.sortBy === 'supplier' ? 'supplier' : null

  const sorters = {
    name:     (a, b) => a.name.localeCompare(b.name, 'es') || String(a.size).localeCompare(String(b.size), 'es'),
    category: (a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'),
    supplier: (a, b) => a.supplier_name.localeCompare(b.supplier_name, 'es') || a.name.localeCompare(b.name, 'es'),
    stock:    (a, b) => b.stock - a.stock || a.name.localeCompare(b.name, 'es'),
  }
  const sorted = [...items].sort(sorters[f.sortBy] || sorters.name)

  const totalCols = 4 + (showPrice ? 1 : 0) + (showCost ? 1 : 0) + (showValue ? 1 : 0)

  const rowHTML = it => `<tr>
    <td>${esc(it.name)}</td>
    <td class="c">${esc(it.size)}</td>
    <td>${esc(it.color) || '—'}</td>
    <td class="r">${it.stock}</td>
    ${showPrice ? `<td class="r">${fmtARS(it.price)}</td>` : ''}
    ${showCost ? `<td class="r">${fmtARS(it.cost)}</td>` : ''}
    ${showValue ? `<td class="r b">${fmtARS(it.stock * it.cost)}</td>` : ''}
  </tr>`

  const subtotalRow = (label, units, value) => `<tr class="sub">
    <td colspan="3">${esc(label)}</td>
    <td class="r">${units}</td>
    ${showPrice ? '<td></td>' : ''}
    ${showCost ? '<td></td>' : ''}
    ${showValue ? `<td class="r">${fmtARS(value)}</td>` : ''}
  </tr>`

  let bodyRows = ''
  if (groupBy && sorted.length) {
    const groups = new Map()
    for (const it of sorted) {
      const key = groupBy === 'category' ? it.category : it.supplier_name
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(it)
    }
    const groupWord = groupBy === 'category' ? 'Categoría' : 'Proveedor'
    for (const [name, groupItems] of groups) {
      const units = groupItems.reduce((s, it) => s + it.stock, 0)
      const value = groupItems.reduce((s, it) => s + it.stock * it.cost, 0)
      bodyRows += `<tr class="grp"><td colspan="${totalCols}">${groupWord}: ${esc(name)}</td></tr>`
      bodyRows += groupItems.map(rowHTML).join('')
      bodyRows += subtotalRow(`Subtotal ${name}`, units, value)
    }
  } else {
    bodyRows = sorted.map(rowHTML).join('')
  }

  const totalUnits = sorted.reduce((s, it) => s + it.stock, 0)
  const totalValue = sorted.reduce((s, it) => s + it.stock * it.cost, 0)
  const productCount = new Set(sorted.map(it => it.product_id)).size

  const header = `<tr>
    <th>Producto</th><th class="c">Talle</th><th>Color</th><th class="r">Stock</th>
    ${showPrice ? '<th class="r">Precio venta</th>' : ''}
    ${showCost ? '<th class="r">Precio costo</th>' : ''}
    ${showValue ? '<th class="r">Valor</th>' : ''}
  </tr>`

  const grandTotal = `<tr class="total-row">
    <td colspan="3">TOTAL GENERAL</td>
    <td class="r">${totalUnits}</td>
    ${showPrice ? '<td></td>' : ''}
    ${showCost ? '<td></td>' : ''}
    ${showValue ? `<td class="r">${fmtARS(totalValue)}</td>` : ''}
  </tr>`

  const empty = `<tr><td colspan="${totalCols}" style="text-align:center;color:#999;padding:20px">Sin productos que coincidan con el filtro</td></tr>`

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(meta.title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:24px}
  h1{font-size:18px;font-weight:bold;margin-bottom:2px}
  h2{font-size:13px;font-weight:bold;margin:14px 0 4px}
  .biz-info{color:#555;margin-bottom:8px}.biz-info p{margin:2px 0}
  .meta{color:#777;margin-bottom:10px;font-size:11px}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.3px;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}.c{text-align:center}.b{font-weight:bold}
  .grp td{background:#333;color:#fff;font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:.4px;padding:5px 8px}
  .sub td{background:#f4f4f4;font-weight:bold;border-top:1px solid #ccc;border-bottom:1px solid #ccc}
  .total-row td{font-weight:bold;background:#eaeaea;border-top:2px solid #333;font-size:12px}
  .stats{display:flex;gap:12px;margin:10px 0 4px}
  .stat{border:1px solid #ddd;border-radius:4px;padding:8px 14px;flex:1;text-align:center}
  .stat .n{font-size:18px;font-weight:bold}.stat .l{font-size:9px;color:#777;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:9px;text-align:center}
  @media print{@page{size:A4 landscape;margin:12mm}}
</style></head><body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:46px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
<h1>${esc(biz.business_name || 'DELPA')}</h1>
<div class="biz-info">
  ${biz.business_address ? `<p>${esc(biz.business_address)}</p>` : ''}
  ${biz.business_phone ? `<p>Tel: ${esc(biz.business_phone)}</p>` : ''}
</div>
<h2>Reporte de Stock — ${esc(meta.label)}</h2>
<p class="meta">Generado: ${esc(meta.dateTimeStr)}</p>
<div class="stats">
  <div class="stat"><div class="n">${productCount}</div><div class="l">Productos</div></div>
  <div class="stat"><div class="n">${totalUnits.toLocaleString('es-AR')}</div><div class="l">Unidades</div></div>
  ${showValue ? `<div class="stat"><div class="n">${fmtARS(totalValue)}</div><div class="l">Valor al costo</div></div>` : ''}
</div>
<table>
  <thead>${header}</thead>
  <tbody>
    ${bodyRows || empty}
    ${sorted.length ? grandTotal : ''}
  </tbody>
</table>
<div class="footer">Generado por DELPA Gestión PRO · ${esc(meta.dateTimeStr)}</div>
</body></html>`
}

async function htmlToPDF(html) {
  const tmpFile = path.join(os.tmpdir(), `stock-report-${Date.now()}.html`)
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

// Construye el reporte completo (html + metadata) a partir de filtros ya normalizados.
function buildReport(db, f) {
  const items = gatherItems(db, f)
  const biz = getBiz()
  const now = new Date()
  const dateStr = now.toLocaleDateString('es-AR')
  const dateTimeStr = now.toLocaleString('es-AR')
  const label = buildLabel(db, f)
  const title = `Reporte de Stock — ${label} — ${dateStr}`
  const html = buildStockHTML(items, f, biz, { label, dateStr, dateTimeStr, title })
  return { html, title, label, count: items.length, biz }
}

// ── IPC ────────────────────────────────────────────────────────────────────────

// Opciones para los selectores del modal: categorías y proveedores disponibles.
ipcMain.handle('stockReport:options', () => {
  const db = getDB()
  const categories = db.prepare(`
    SELECT DISTINCT category FROM products
    WHERE active=1 AND category IS NOT NULL AND TRIM(category) <> ''
    ORDER BY category
  `).all().map(r => r.category)
  const suppliers = db.prepare(`
    SELECT s.id, s.name, s.email,
           (SELECT COUNT(*) FROM products p WHERE p.supplier_id=s.id AND p.active=1) AS product_count
    FROM suppliers s
    WHERE s.active=1
    ORDER BY s.name
  `).all()
  return { categories, suppliers, isAdmin: isAdminSession() }
})

// Devuelve el HTML del reporte para imprimir desde el renderer (diálogo nativo).
ipcMain.handle('stockReport:html', (_, filters = {}) => {
  const db = getDB()
  const f = normalize(filters)
  const { html, title, count } = buildReport(db, f)
  return { ok: true, html, title, count }
})

// Genera el PDF y lo envía por email. Si se filtró por UN proveedor con email
// cargado, va a ese proveedor; si no, al email operativo configurado.
ipcMain.handle('stockReport:email', async (_, filters = {}) => {
  try {
    const db = getDB()
    const f = normalize(filters)
    const { html, label, count, biz } = buildReport(db, f)
    if (!count) return { ok: false, error: 'No hay stock que coincida con el filtro seleccionado' }

    const s = getEmailConfig()
    const smtpUser = s.email_user || s.email_from || s.email_to
    if (!smtpUser || !s.email_pass) {
      return { ok: false, error: 'Configurá el email de envío en Configuración → Email' }
    }

    // Destinatario: proveedor único con email, o el email operativo.
    let recipient = s.email_to
    let toSupplier = false
    if (f.supplierIds.length === 1) {
      const sup = db.prepare('SELECT name, email FROM suppliers WHERE id=?').get(f.supplierIds[0])
      if (sup?.email) { recipient = sup.email; toSupplier = true }
    }
    if (!recipient) return { ok: false, error: 'No hay email destinatario configurado' }

    const bizName = biz.business_name || 'DELPA'
    const dateStr = new Date().toLocaleDateString('es-AR')

    let pdf = null
    try { pdf = await htmlToPDF(html) } catch (e) { console.error('[stockReport] PDF error:', e.message) }

    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: (s.email_smtp || 'smtp.gmail.com').replace(/^smtps?:\/\//i, '').trim(),
      port: parseInt(s.email_port || '587', 10),
      secure: s.email_port === '465',
      requireTLS: s.email_port !== '465',
      auth: { user: smtpUser, pass: s.email_pass },
      tls: { minVersion: 'TLSv1.2' },
    })

    const bodyText = toSupplier
      ? `Hola, te enviamos el reporte de stock actual de tus productos en ${bizName}.`
      : `Adjuntamos el reporte de stock (${label}) generado el ${dateStr}.`

    const mailOpts = {
      from: `"${bizName}" <${smtpUser}>`,
      to: recipient,
      subject: `Reporte de Stock — ${label} — ${dateStr}`,
      html: `<div style="font-family:sans-serif;max-width:560px;color:#333">
        ${biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
        <h2 style="color:#333;margin-bottom:6px">${esc(bizName)}</h2>
        <p style="color:#555;font-size:14px;line-height:1.5">${esc(bodyText)}</p>
        <p style="color:#999;font-size:12px;margin-top:16px">Se adjunta el detalle en PDF. Enviado desde DELPA Gestión PRO.</p>
      </div>`,
    }
    if (pdf) {
      mailOpts.attachments = [{
        filename: `Reporte-Stock-${new Date().toISOString().slice(0, 10)}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }]
    }
    await transporter.sendMail(mailOpts)
    return { ok: true, email: recipient }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

module.exports = {}
