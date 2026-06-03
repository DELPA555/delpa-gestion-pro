const { ipcMain, BrowserWindow, dialog } = require('electron')
const { getDB } = require('../../database/db')
const path = require('path')
const fs = require('fs')
const os = require('os')

// One-time migration: add color column to inventory_items if missing
function ensureColorColumn() {
  try {
    const db = getDB()
    const info = db.prepare("PRAGMA table_info('inventory_items')").all()
    if (!info.find(c => c.name === 'color')) {
      db.exec("ALTER TABLE inventory_items ADD COLUMN color TEXT DEFAULT ''")
    }
  } catch {}
}

// Build comparison data from raw items array
function buildComparison(items) {
  const scanned   = items.filter(i => i.real_stock > 0)
  const unscanned = items.filter(i => i.real_stock === 0 && i.system_stock > 0)
  const exact     = items.filter(i => i.real_stock > 0 && i.difference === 0)
  const withDiff  = items.filter(i => i.difference !== 0)
  const totalScannedQty = items.reduce((s, i) => s + i.real_stock, 0)
  return { items, scanned, unscanned, exact, withDiff, totalScannedQty }
}

// ── inventory:start ────────────────────────────────────────────────────────────
// Creates session and pre-populates ALL active product_sizes with real_stock=0
ipcMain.handle('inventory:start', (_, notes) => {
  const db = getDB()
  ensureColorColumn()

  const open = db.prepare("SELECT id FROM inventory_sessions WHERE status='open'").get()
  if (open) throw new Error('Ya hay un inventario activo (ID ' + open.id + '). Finalizalo primero.')

  const { lastInsertRowid: sessionId } = db.prepare(
    "INSERT INTO inventory_sessions (notes) VALUES (?)"
  ).run(notes || '')

  const sizes = db.prepare(`
    SELECT ps.product_id, ps.size, ps.stock, p.name AS product_name, p.color
    FROM product_sizes ps
    JOIN products p ON p.id = ps.product_id
    WHERE p.active = 1
    ORDER BY p.name, ps.size
  `).all()

  const ins = db.prepare(
    'INSERT INTO inventory_items (session_id,product_id,product_name,size,color,system_stock,real_stock,difference) VALUES (?,?,?,?,?,?,0,0)'
  )
  db.transaction(() => {
    for (const s of sizes) ins.run(sessionId, s.product_id, s.product_name, s.size, s.color || '', s.stock)
  })()

  return sessionId
})

// ── inventory:scan ─────────────────────────────────────────────────────────────
// Usa la MISMA lógica de products:searchByBarcode para garantizar compatibilidad
ipcMain.handle('inventory:scan', (_, { sessionId, barcode }) => {
  if (!barcode) return { found: false, barcode: '' }
  const db = getDB()
  const code = String(barcode).trim()
  console.log('[INVENTORY SCAN] código:', JSON.stringify(code), 'largo:', code.length)

  let productId, productName, color, matchedSize

  // 1. Igual que searchByBarcode paso 1: buscar por products.barcode exacto
  const byProduct = db.prepare(
    'SELECT id, name, color FROM products WHERE active=1 AND barcode=?'
  ).get(code)

  if (byProduct) {
    productId   = byProduct.id
    productName = byProduct.name
    color       = byProduct.color || ''
    // Barcode de producto — tomar el primer talle disponible en la sesión
    const firstInSession = db.prepare(
      'SELECT size FROM inventory_items WHERE session_id=? AND product_id=? ORDER BY id ASC LIMIT 1'
    ).get(sessionId, productId)
    matchedSize = firstInSession?.size
    console.log('[INVENTORY SCAN] encontrado por products.barcode, size sesión:', matchedSize)
  }

  // 2. Igual que searchByBarcode paso 2: buscar por product_sizes.size_barcode exacto
  if (!productId) {
    try {
      const bySize = db.prepare(`
        SELECT p.id, p.name, p.color, ps.size AS matched_size
        FROM product_sizes ps
        JOIN products p ON p.id = ps.product_id
        WHERE p.active=1 AND ps.size_barcode=?
        LIMIT 1
      `).get(code)
      if (bySize) {
        productId   = bySize.id
        productName = bySize.name
        color       = bySize.color || ''
        matchedSize = bySize.matched_size
        console.log('[INVENTORY SCAN] encontrado por size_barcode, size:', matchedSize)
      }
    } catch (e) {
      console.log('[INVENTORY SCAN] error en búsqueda size_barcode:', e.message)
    }
  }

  const result = productId ? { productId, productName, matchedSize, color } : null
  console.log('[INVENTORY SCAN] resultado:', result
    ? `${result.productName} T.${result.matchedSize}`
    : 'no encontrado')

  if (!result || !matchedSize) return { found: false, barcode: code }

  // Buscar item en la sesión
  let item = db.prepare(
    'SELECT * FROM inventory_items WHERE session_id=? AND product_id=? AND size=?'
  ).get(sessionId, productId, matchedSize)

  // Fallback: si el producto existe pero no estaba en la sesión (DB vieja / producto nuevo),
  // lo insertamos al vuelo con el stock actual del sistema
  if (!item) {
    console.log('[INVENTORY SCAN] item no en sesión — insertando al vuelo productId:', productId, 'size:', matchedSize)
    try {
      const currentStock = db.prepare(
        'SELECT stock FROM product_sizes WHERE product_id=? AND size=?'
      ).get(productId, matchedSize)
      const sysStock = currentStock?.stock ?? 0
      db.prepare(
        'INSERT INTO inventory_items (session_id,product_id,product_name,size,color,system_stock,real_stock,difference) VALUES (?,?,?,?,?,?,0,0)'
      ).run(sessionId, productId, productName, matchedSize, color, sysStock)
      item = db.prepare(
        'SELECT * FROM inventory_items WHERE session_id=? AND product_id=? AND size=?'
      ).get(sessionId, productId, matchedSize)
    } catch (e) {
      console.log('[INVENTORY SCAN] error insertando item al vuelo:', e.message)
      return { found: false, barcode: code }
    }
  }

  if (!item) return { found: false, barcode: code }

  const newReal = item.real_stock + 1
  const diff    = newReal - item.system_stock
  db.prepare('UPDATE inventory_items SET real_stock=?, difference=? WHERE id=?')
    .run(newReal, diff, item.id)

  return {
    found: true,
    item: {
      id:           item.id,
      product_id:   productId,
      product_name: productName,
      size:         matchedSize,
      color,
      real_stock:   newReal,
      system_stock: item.system_stock,
      difference:   diff,
    }
  }
})

// ── inventory:increment ────────────────────────────────────────────────────────
// Recibe productId + size ya resueltos (el frontend usó searchByBarcode para buscar)
ipcMain.handle('inventory:increment', (_, { sessionId, productId, size, productName, color }) => {
  const db = getDB()
  console.log('[INVENTORY:INCREMENT] sessionId:', sessionId, 'productId:', productId, 'size:', size)

  let item = db.prepare(
    'SELECT * FROM inventory_items WHERE session_id=? AND product_id=? AND size=?'
  ).get(sessionId, productId, size)

  // Si el item no existe en la sesión, insertarlo al vuelo
  if (!item) {
    const currentStock = db.prepare(
      'SELECT stock FROM product_sizes WHERE product_id=? AND size=?'
    ).get(productId, size)
    const sysStock = currentStock?.stock ?? 0
    console.log('[INVENTORY:INCREMENT] item no en sesión — insertando con system_stock:', sysStock)
    try {
      db.prepare(
        'INSERT INTO inventory_items (session_id,product_id,product_name,size,color,system_stock,real_stock,difference) VALUES (?,?,?,?,?,?,0,0)'
      ).run(sessionId, productId, productName || '', size, color || '', sysStock)
      item = db.prepare(
        'SELECT * FROM inventory_items WHERE session_id=? AND product_id=? AND size=?'
      ).get(sessionId, productId, size)
    } catch (e) {
      console.log('[INVENTORY:INCREMENT] error al insertar:', e.message)
      throw new Error('No se pudo registrar el item: ' + e.message)
    }
  }

  const newReal = item.real_stock + 1
  const diff    = newReal - item.system_stock
  db.prepare('UPDATE inventory_items SET real_stock=?, difference=? WHERE id=?')
    .run(newReal, diff, item.id)

  console.log('[INVENTORY:INCREMENT] OK — real_stock:', newReal, 'diff:', diff)
  return {
    id:           item.id,
    product_id:   productId,
    product_name: productName || item.product_name,
    size,
    color:        color || item.color || '',
    real_stock:   newReal,
    system_stock: item.system_stock,
    difference:   diff,
  }
})

// ── inventory:getCurrent ───────────────────────────────────────────────────────
ipcMain.handle('inventory:getCurrent', () => {
  const db = getDB()
  const session = db.prepare("SELECT * FROM inventory_sessions WHERE status='open' ORDER BY id DESC LIMIT 1").get()
  if (!session) return null
  const items = db.prepare(
    'SELECT * FROM inventory_items WHERE session_id=? ORDER BY product_name, size'
  ).all(session.id)
  return { session, ...buildComparison(items) }
})

// ── inventory:getReport ────────────────────────────────────────────────────────
ipcMain.handle('inventory:getReport', (_, sessionId) => {
  const db = getDB()
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(sessionId)
  if (!session) return null
  const items = db.prepare('SELECT * FROM inventory_items WHERE session_id=? ORDER BY product_name, size').all(sessionId)
  return { session, ...buildComparison(items) }
})

// ── inventory:close ────────────────────────────────────────────────────────────
ipcMain.handle('inventory:close', (_, { sessionId, applyAdjustments }) => {
  const db = getDB()
  if (!db.prepare('SELECT id FROM inventory_sessions WHERE id=?').get(sessionId)) throw new Error('Sesión no encontrada')

  const items = db.prepare('SELECT * FROM inventory_items WHERE session_id=?').all(sessionId)

  if (applyAdjustments) {
    const upd = db.prepare('UPDATE product_sizes SET stock=? WHERE product_id=? AND size=?')
    db.transaction(() => {
      for (const it of items) {
        if (it.difference !== 0) upd.run(it.real_stock, it.product_id, it.size)
      }
    })()
    db.prepare("INSERT INTO audit_log (action,module,entity_id,description) VALUES ('ADJUST','inventory',?,?)")
      .run(sessionId, `Ajuste de inventario: ${items.filter(i => i.difference !== 0).length} diferencias ajustadas`)
  }

  db.prepare("UPDATE inventory_sessions SET status='closed', closed_at=CURRENT_TIMESTAMP WHERE id=?").run(sessionId)
  return { ok: true }
})

// ── inventory:exportPDF ────────────────────────────────────────────────────────
ipcMain.handle('inventory:exportPDF', async (_, sessionId) => {
  const db = getDB()
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(sessionId)
  if (!session) throw new Error('Sesión no encontrada')
  const items = db.prepare('SELECT * FROM inventory_items WHERE session_id=? ORDER BY product_name, size').all(sessionId)
  const bizRows = db.prepare("SELECT key,value FROM settings WHERE key LIKE 'business_%'").all()
  const biz = Object.fromEntries(bizRows.map(r => [r.key, r.value]))

  const { filePath } = await dialog.showSaveDialog({
    title: 'Guardar informe de inventario',
    defaultPath: `inventario_${session.id}_${new Date(session.created_at).toISOString().slice(0,10)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (!filePath) return { ok: false }

  const html = buildInventoryReportHTML(session, items, biz)
  const tmpFile = path.join(os.tmpdir(), `inv-report-${Date.now()}.html`)
  fs.writeFileSync(tmpFile, html, 'utf8')

  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } })
  try {
    await win.loadFile(tmpFile)
    const pdfBuffer = await win.webContents.printToPDF({ landscape: true, printBackground: true, pageSize: 'A4' })
    fs.writeFileSync(filePath, pdfBuffer)
  } finally {
    win.destroy()
    try { fs.unlinkSync(tmpFile) } catch {}
  }

  return { ok: true, filePath }
})

// ── inventory:emailReport ──────────────────────────────────────────────────────
ipcMain.handle('inventory:emailReport', async (_, sessionId) => {
  const db = getDB()
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id=?').get(sessionId)
  if (!session) throw new Error('Sesión no encontrada')
  const items = db.prepare('SELECT * FROM inventory_items WHERE session_id=? ORDER BY product_name, size').all(sessionId)
  const { sendInventoryReport } = require('./email')
  await sendInventoryReport(session, items, '')
  return { ok: true }
})

// ── inventory:history ──────────────────────────────────────────────────────────
ipcMain.handle('inventory:history', (_, { page = 1, limit = 20 } = {}) => {
  const db = getDB()
  const { count } = db.prepare('SELECT COUNT(*) as count FROM inventory_sessions').get()
  const sessions = db.prepare(
    'SELECT * FROM inventory_sessions ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, (page - 1) * limit)

  // Attach summary stats per session
  const stmt = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN real_stock > 0 AND difference = 0 THEN 1 ELSE 0 END) AS exact_count,
      SUM(CASE WHEN difference <> 0 THEN 1 ELSE 0 END) AS diff_count,
      SUM(CASE WHEN real_stock = 0 AND system_stock > 0 THEN 1 ELSE 0 END) AS unscanned_count,
      SUM(real_stock) AS total_qty
    FROM inventory_items WHERE session_id=?
  `)
  const enriched = sessions.map(s => ({ ...s, ...stmt.get(s.id) }))

  return { sessions: enriched, total: count, pages: Math.ceil(count / limit) }
})

// ── inventory:updateItem (kept for compat) ─────────────────────────────────────
ipcMain.handle('inventory:updateItem', (_, { sessionId, productId, size, realStock }) => {
  const db = getDB()
  const item = db.prepare('SELECT system_stock FROM inventory_items WHERE session_id=? AND product_id=? AND size=?').get(sessionId, productId, size)
  if (!item) throw new Error('Item no encontrado')
  const diff = Number(realStock) - item.system_stock
  db.prepare('UPDATE inventory_items SET real_stock=?, difference=? WHERE session_id=? AND product_id=? AND size=?')
    .run(Number(realStock), diff, sessionId, productId, size)
  return { ok: true }
})

// ── HTML report builder ────────────────────────────────────────────────────────
function buildInventoryReportHTML(session, items, biz) {
  const fmtDate = s => s ? new Date(s).toLocaleString('es-AR') : '—'
  const { scanned, unscanned, exact, withDiff, totalScannedQty } = buildComparison(items)

  const rowColor = item => {
    if (item.real_stock === 0 && item.system_stock > 0) return '#fff0f0'
    if (item.difference === 0) return '#f0fff4'
    if (Math.abs(item.difference) <= 2) return '#fffbeb'
    return '#fff0f0'
  }

  const rows = items.map(item => `
    <tr style="background:${rowColor(item)}">
      <td>${item.product_name}</td>
      <td>${item.size}</td>
      <td>${item.color || ''}</td>
      <td class="r">${item.system_stock}</td>
      <td class="r">${item.real_stock}</td>
      <td class="r" style="font-weight:bold;color:${item.difference > 0 ? '#16a34a' : item.difference < 0 ? '#dc2626' : '#555'}">${item.difference > 0 ? '+' : ''}${item.difference}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Inventario #${session.id}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;padding:20px}
  h1{font-size:18px;font-weight:bold;margin-bottom:4px}
  h2{font-size:10px;font-weight:bold;margin:14px 0 5px;padding-bottom:3px;border-bottom:2px solid #333;text-transform:uppercase;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:8px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.3px;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}
  .stats{display:flex;gap:12px;margin-bottom:14px}
  .stat{border:1px solid #ddd;border-radius:4px;padding:8px 14px;flex:1;text-align:center}
  .stat .n{font-size:20px;font-weight:bold}
  .stat .l{font-size:9px;color:#777;text-transform:uppercase;letter-spacing:.5px;margin-top:2px}
  .footer{margin-top:16px;padding-top:6px;border-top:1px solid #ddd;color:#999;font-size:9px;text-align:center}
  @media print{@page{size:A4 landscape;margin:12mm}}
</style>
</head>
<body>
<h1>${biz.business_name || 'DELPA'} — Informe de Inventario #${session.id}</h1>
<p style="color:#777;font-size:10px;margin-bottom:14px">Fecha: ${fmtDate(session.created_at)}${session.notes ? ' · ' + session.notes : ''}</p>

<div class="stats">
  <div class="stat"><div class="n">${items.length}</div><div class="l">Total ítems</div></div>
  <div class="stat"><div class="n" style="color:#16a34a">${exact.length}</div><div class="l">Coinciden</div></div>
  <div class="stat"><div class="n" style="color:#d97706">${withDiff.filter(i => i.real_stock > 0).length}</div><div class="l">Con diferencia</div></div>
  <div class="stat"><div class="n" style="color:#dc2626">${unscanned.length}</div><div class="l">No escaneados</div></div>
  <div class="stat"><div class="n">${totalScannedQty}</div><div class="l">Unidades escaneadas</div></div>
</div>

<h2>Detalle completo</h2>
<table>
  <thead>
    <tr><th>Producto</th><th>Talle</th><th>Color</th><th class="r">Sistema</th><th class="r">Escaneado</th><th class="r">Diferencia</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body>
</html>`
}
