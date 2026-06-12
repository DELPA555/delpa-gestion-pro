const { ipcMain, BrowserWindow, dialog, app } = require('electron')
const { getDB } = require('../../database/db')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

// ── Número correlativo ────────────────────────────────────────────────────────

function nextNumber(db) {
  const year = new Date().getFullYear()
  const prefix = `EGR-${year}-`
  const last = db.prepare(
    "SELECT number FROM stock_egresos WHERE number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(prefix + '%')
  if (!last) return `${prefix}0001`
  const seq = parseInt(last.number.slice(prefix.length), 10) || 0
  return `${prefix}${String(seq + 1).padStart(4, '0')}`
}

// ── egreso:list ───────────────────────────────────────────────────────────────

ipcMain.handle('egreso:list', (_, { page = 1, limit = 30 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const { count } = db.prepare('SELECT COUNT(*) as count FROM stock_egresos').get()
  const rows = db.prepare(`
    SELECT e.id, e.number, e.date, e.supplier_name, e.reason, e.notes,
           e.total_amount, e.total_units, e.status, e.created_at,
           COUNT(i.id) as item_count
    FROM stock_egresos e
    LEFT JOIN stock_egreso_items i ON i.egreso_id = e.id
    GROUP BY e.id
    ORDER BY e.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset)
  return { egresos: rows, total: count, pages: Math.ceil(count / limit) }
})

// ── egreso:get ────────────────────────────────────────────────────────────────

ipcMain.handle('egreso:get', (_, id) => {
  const db = getDB()
  const egreso = db.prepare('SELECT * FROM stock_egresos WHERE id=?').get(id)
  if (!egreso) return null
  egreso.items = db.prepare('SELECT * FROM stock_egreso_items WHERE egreso_id=? ORDER BY id').all(id)
  // Populate supplier
  if (egreso.supplier_id) {
    const sup = db.prepare('SELECT name, address, phone, email, cuit FROM suppliers WHERE id=?').get(egreso.supplier_id)
    egreso.supplier = sup || null
  }
  return egreso
})

// ── egreso:create ─────────────────────────────────────────────────────────────

ipcMain.handle('egreso:create', (_, data) => {
  const db  = getDB()
  const { supplier_id, supplier_name, date, reason, notes, items } = data

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Sin productos en el egreso' }
  }

  const warnings = []

  const run = db.transaction(() => {
    const number = nextNumber(db)
    let totalAmount = 0
    let totalUnits  = 0

    // Insert egreso header
    const { lastInsertRowid: egresoId } = db.prepare(`
      INSERT INTO stock_egresos (number, supplier_id, supplier_name, date, reason, notes, total_amount, total_units, status)
      VALUES (?,?,?,?,?,?,0,0,'pending')
    `).run(number, supplier_id || null, supplier_name || '', date, reason || '', notes || '')

    const insItem = db.prepare(`
      INSERT INTO stock_egreso_items (egreso_id, product_id, product_name, size, color, quantity, cost_price, subtotal)
      VALUES (?,?,?,?,?,?,?,?)
    `)

    for (const item of items) {
      const qty  = Number(item.quantity) || 0
      const cost = Number(item.cost_price) || 0
      if (qty <= 0) continue

      const sub = qty * cost
      totalAmount += sub
      totalUnits  += qty

      insItem.run(egresoId, item.product_id || null, item.product_name || '', item.size || '', item.color || '', qty, cost, sub)

      // Descontar stock
      if (item.product_id && item.size) {
        const row = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(item.product_id, item.size)
        if (row) {
          const newStock = row.stock - qty
          if (newStock < 0) {
            warnings.push(`Stock negativo: "${item.product_name}" T.${item.size} quedaría en ${newStock}`)
          }
          db.prepare('UPDATE product_sizes SET stock=?, stock_modified_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=?')
            .run(newStock, item.product_id, item.size)
          console.log(`[EGRESO] ${item.product_name} T.${item.size}: ${row.stock} → ${newStock}`)
        } else {
          warnings.push(`Talle no encontrado: "${item.product_name}" T.${item.size}`)
        }
      }
    }

    // Update totals
    db.prepare('UPDATE stock_egresos SET total_amount=?, total_units=? WHERE id=?')
      .run(totalAmount, totalUnits, egresoId)

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','egresos',?,?,?)`)
      .run(egresoId, `Egreso ${number} — ${supplier_name}`, JSON.stringify({ number, reason, total_amount: totalAmount, total_units: totalUnits }))

    return { id: egresoId, number }
  })

  const { id, number } = run()

  // TN sync: discount stock on TN for affected products
  try {
    const { syncStockAfterSale } = require('./tiendanube')
    const syncItems = items
      .filter(i => i.product_id && i.size && i.size !== 'N/A')
      .map(i => ({ productId: Number(i.product_id), size: i.size }))
    if (syncItems.length) syncStockAfterSale(syncItems)
  } catch {}

  return { ok: true, id, number, warnings }
})

// ── egreso:updateStatus ───────────────────────────────────────────────────────

ipcMain.handle('egreso:updateStatus', (_, { id, status }) => {
  const db = getDB()
  if (!['pending', 'sent', 'confirmed', 'cancelled'].includes(status)) return { ok: false, error: 'Estado inválido' }
  const egreso = db.prepare('SELECT * FROM stock_egresos WHERE id=?').get(id)
  if (!egreso) return { ok: false, error: 'Egreso no encontrado' }
  if (egreso.status === 'cancelled') return { ok: false, error: 'El egreso ya fue cancelado' }

  if (status === 'cancelled') {
    db.transaction(() => {
      const items = db.prepare('SELECT * FROM stock_egreso_items WHERE egreso_id=?').all(id)
      for (const item of items) {
        if (item.product_id && item.size) {
          db.prepare('UPDATE product_sizes SET stock=stock+?, stock_modified_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=?')
            .run(item.quantity, item.product_id, item.size)
        }
      }
      db.prepare('UPDATE stock_egresos SET status=? WHERE id=?').run('cancelled', id)
      db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('UPDATE','egresos',?,?)`)
        .run(id, `Egreso ${egreso.number} cancelado — stock restaurado (${items.length} items)`)
    })()
  } else {
    db.prepare('UPDATE stock_egresos SET status=? WHERE id=?').run(status, id)
  }
  return { ok: true }
})

// ── egreso:pdf ────────────────────────────────────────────────────────────────

ipcMain.handle('egreso:pdf', async (_, id) => {
  const db = getDB()
  const egreso = db.prepare('SELECT * FROM stock_egresos WHERE id=?').get(id)
  if (!egreso) return { ok: false, error: 'Egreso no encontrado' }

  const items = db.prepare('SELECT * FROM stock_egreso_items WHERE egreso_id=? ORDER BY id').all(id)
  const biz   = Object.fromEntries(
    db.prepare("SELECT key,value FROM settings WHERE key LIKE 'business_%'").all().map(r => [r.key, r.value])
  )
  const supplier = egreso.supplier_id
    ? db.prepare('SELECT name, address, phone, email, cuit FROM suppliers WHERE id=?').get(egreso.supplier_id)
    : null

  const { filePath } = await dialog.showSaveDialog({
    title: 'Guardar egreso',
    defaultPath: path.join(os.homedir(), 'Desktop', `egreso_${egreso.number}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!filePath) return { ok: false }

  const fmt = n => '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })
  const bizLogo = biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;margin-bottom:4px">` : ''
  const REASON_LABELS = {
    defecto: 'Defecto de fábrica', talle: 'Talle incorrecto',
    danada: 'Mercadería dañada', exceso: 'Exceso de stock', otro: 'Otro',
  }

  const rows = items.map(i => `
    <tr>
      <td>${i.product_name}</td>
      <td style="text-align:center">${i.size}</td>
      <td style="text-align:center">${i.color || '—'}</td>
      <td style="text-align:right">${i.quantity}</td>
      <td style="text-align:right">${fmt(i.cost_price)}</td>
      <td style="text-align:right">${fmt(i.subtotal)}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Egreso ${egreso.number}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:24px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #1a3a5c}
.biz h1{font-size:18px;font-weight:bold;color:#1a3a5c;margin-bottom:2px}
.biz p{color:#555;font-size:10px}
.doc-info{text-align:right}
.doc-info h2{font-size:16px;font-weight:bold;color:#c9a84c;letter-spacing:1px}
.doc-info .num{font-size:18px;font-weight:bold;color:#1a3a5c}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.party{background:#f8f9fa;border-radius:6px;padding:10px 14px;border:1px solid #e0e0e0}
.party label{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#777;font-weight:bold}
.party p{font-size:11px;color:#222;margin-top:2px;font-weight:600}
.party span{font-size:10px;color:#555;display:block}
.reason-box{background:#fff8e1;border:1px solid #f0c040;border-radius:6px;padding:8px 14px;margin-bottom:14px;font-size:11px}
.reason-box strong{color:#c9a84c}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px}
th{background:#1a3a5c;color:#fff;padding:6px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.3px}
td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:middle}
tr:nth-child(even)td{background:#f9f9f9}
.totals{background:#f0f4f8;border:1px solid #d0d8e4;border-radius:6px;padding:10px 14px;margin-left:auto;max-width:260px;font-size:11px}
.totals .row{display:flex;justify-content:space-between;margin-bottom:4px}
.totals .total-row{font-weight:bold;font-size:13px;border-top:1px solid #c9a84c;padding-top:6px;margin-top:6px;color:#1a3a5c}
.signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:32px}
.sig-box{border-top:2px solid #1a3a5c;padding-top:8px;text-align:center}
.sig-box p{font-size:10px;color:#555;margin-bottom:2px}
.sig-box strong{font-size:11px;color:#1a3a5c}
.legal{margin-top:20px;padding:10px;background:#f0f4f8;border-radius:6px;font-size:9px;color:#555;text-align:center;border:1px solid #d0d8e4}
.footer{margin-top:14px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:9px;text-align:center}
@media print{@page{size:A4;margin:15mm}body{padding:0}}
</style></head><body>

<div class="header">
  <div class="biz">
    ${bizLogo}
    <h1>${biz.business_name || 'DELPA'}</h1>
    <p>CUIT: ${biz.business_cuit || '—'}</p>
    <p>${biz.business_address || ''}</p>
    <p>${biz.business_phone || ''}</p>
  </div>
  <div class="doc-info">
    <h2>DEVOLUCIÓN A PROVEEDOR</h2>
    <div class="num">${egreso.number}</div>
    <p style="font-size:10px;color:#555;margin-top:4px">Fecha: ${new Date(egreso.date).toLocaleDateString('es-AR')}</p>
    <p style="font-size:10px;color:#555">Hora: ${new Date(egreso.created_at).toLocaleTimeString('es-AR')}</p>
  </div>
</div>

<div class="parties">
  <div class="party">
    <label>Remitente</label>
    <p>${biz.business_name || 'DELPA'}</p>
    <span>CUIT: ${biz.business_cuit || '—'}</span>
    <span>${biz.business_address || ''}</span>
  </div>
  <div class="party">
    <label>Destinatario (Proveedor)</label>
    <p>${egreso.supplier_name || '—'}</p>
    ${supplier?.cuit ? `<span>CUIT: ${supplier.cuit}</span>` : ''}
    ${supplier?.address ? `<span>${supplier.address}</span>` : ''}
    ${supplier?.phone ? `<span>Tel: ${supplier.phone}</span>` : ''}
  </div>
</div>

<div class="reason-box">
  <strong>Motivo de devolución:</strong> ${REASON_LABELS[egreso.reason] || egreso.reason || '—'}
  ${egreso.notes ? `<br><strong>Observaciones:</strong> ${egreso.notes}` : ''}
</div>

<table>
  <thead>
    <tr>
      <th>Producto</th>
      <th style="text-align:center;width:60px">Talle</th>
      <th style="text-align:center;width:70px">Color</th>
      <th style="text-align:right;width:60px">Cant.</th>
      <th style="text-align:right;width:90px">P. Costo</th>
      <th style="text-align:right;width:90px">Subtotal</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div style="display:flex;justify-content:flex-end">
  <div class="totals">
    <div class="row"><span>Total unidades:</span><span>${egreso.total_units}</span></div>
    <div class="row total-row"><span>Crédito a favor:</span><span>${fmt(egreso.total_amount)}</span></div>
  </div>
</div>

<div class="signatures">
  <div class="sig-box">
    <strong>${biz.business_name || 'DELPA'}</strong>
    <p>Firma del remitente</p>
  </div>
  <div class="sig-box">
    <strong>${egreso.supplier_name || 'Proveedor'}</strong>
    <p>Firma y aclaración del proveedor</p>
    <p style="font-style:italic;color:#888">Confirma recepción de la mercadería detallada</p>
  </div>
</div>

<div class="legal">
  El proveedor firmante confirma haber recibido la mercadería detallada en este documento en las condiciones indicadas.
  Este documento es válido como constancia de devolución. N° ${egreso.number}
</div>

<div class="footer">
  ${biz.business_name || 'DELPA'} · Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}
</div>

</body></html>`

  const tmpFile = path.join(os.tmpdir(), `egreso-${egreso.number}-${Date.now()}.html`)
  fs.writeFileSync(tmpFile, html, 'utf8')

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } })
  try {
    await win.loadFile(tmpFile)
    const pdfBuffer = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    fs.writeFileSync(filePath, pdfBuffer)
  } finally {
    win.destroy()
    try { fs.unlinkSync(tmpFile) } catch {}
  }

  return { ok: true, filePath }
})
