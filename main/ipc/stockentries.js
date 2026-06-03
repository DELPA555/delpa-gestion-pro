const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

function genEAN13(id) {
  const base = '779' + String(id).padStart(9, '0')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3)
  return base + (10 - sum % 10) % 10
}

function sizeToCode(size) {
  const ALPHA = { XS: 80, S: 81, M: 82, L: 83, XL: 84, XXL: 85, XXXL: 86, '4XL': 87, '5XL': 88, Único: 89, UNICO: 89, unico: 89 }
  const s = String(size).trim()
  if (ALPHA[s] !== undefined) return ALPHA[s]
  const num = parseInt(s, 10)
  if (!isNaN(num) && num >= 0 && num <= 79) return num
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return 90 + (h % 10)
}

function genSizeBarcode(productId, size) {
  const sizeCode = sizeToCode(size)
  const pid = Math.abs(Number(productId)) % 10000000
  const base = '779' + String(pid).padStart(7, '0') + String(sizeCode).padStart(2, '0')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3)
  return base + String((10 - sum % 10) % 10)
}

function generateSizeBarcodes(db, productId) {
  try {
    const sizes = db.prepare("SELECT id, size FROM product_sizes WHERE product_id=? AND (size_barcode IS NULL OR size_barcode='')").all(productId)
    const upd = db.prepare('UPDATE product_sizes SET size_barcode=? WHERE id=?')
    for (const sz of sizes) upd.run(genSizeBarcode(productId, sz.size), sz.id)
  } catch (e) {
    console.error('[generateSizeBarcodes] stockentries:', e.message)
  }
}

ipcMain.handle('stockentry:list', (_, { page = 1, limit = 30 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const { count } = db.prepare('SELECT COUNT(*) as count FROM stock_entries').get()
  const rows = db.prepare(`
    SELECT id, supplier_name, date, notes, total,
           json_array_length(items_json) as item_count, created_at
    FROM stock_entries ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset)
  return { entries: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('stockentry:get', (_, id) => {
  const db = getDB()
  const entry = db.prepare('SELECT * FROM stock_entries WHERE id=?').get(id)
  if (!entry) return null
  try { entry.items = JSON.parse(entry.items_json || '[]') } catch { entry.items = [] }
  return entry
})

ipcMain.handle('stockentry:create', (_, data) => {
  const db = getDB()
  const { supplier_id, supplier_name, date, notes, total, items } = data

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Sin productos en el ingreso' }
  }

  const run = db.transaction(() => {
    const processedItems = []

    for (const item of items) {
      let productId = Number(item.product_id) || null
      let productName = item.product_name || ''

      // Create new product if needed
      if (item.new_product) {
        const np = item.new_product
        const { lastInsertRowid: newPid } = db.prepare(
          'INSERT INTO products (name, brand, category, color, price, cost, barcode, active, tn_sync) VALUES (?,?,?,?,?,?,?,1,1)'
        ).run(
          np.name || 'Nuevo producto',
          np.brand || '',
          np.category || 'Otros',
          np.color || '',
          Number(np.price) || 0,
          Number(np.cost) || 0,
          np.barcode || null
        )
        if (np.image_data) {
          db.prepare('UPDATE products SET image_data=? WHERE id=?').run(np.image_data, newPid)
        }
        if (!np.barcode) {
          try { db.prepare('UPDATE products SET barcode=? WHERE id=? AND barcode IS NULL').run(genEAN13(newPid), newPid) } catch {}
        }
        productId = newPid
        productName = np.name
        console.log(`[StockEntry] Producto nuevo creado: "${np.name}" id=${newPid}`)
      }

      if (!productId) continue

      const sizes = Array.isArray(item.sizes) ? item.sizes : []
      for (const sz of sizes) {
        const size = sz.size || 'N/A'
        const qty = Number(sz.qty) || 0
        if (qty <= 0) continue

        console.log(`[StockEntry] Ingresando: "${productName}" T.${size} x${qty}`)
        const existing = db.prepare('SELECT id, stock FROM product_sizes WHERE product_id=? AND size=?').get(productId, size)
        if (existing) {
          db.prepare('UPDATE product_sizes SET stock=stock+? WHERE product_id=? AND size=?').run(qty, productId, size)
          try { db.prepare('UPDATE product_sizes SET stock_modified_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=?').run(productId, size) } catch {}
          const after = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(productId, size)
          console.log(`[StockEntry] Stock: ${existing.stock} → ${after?.stock}`)
        } else {
          db.prepare('INSERT INTO product_sizes (product_id, size, stock, min_stock) VALUES (?,?,?,0)').run(productId, size, qty)
          try { db.prepare('UPDATE product_sizes SET stock_modified_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=?').run(productId, size) } catch {}
          console.log(`[StockEntry] Talle nuevo creado con stock ${qty}`)
        }
      }

      generateSizeBarcodes(db, productId)
      processedItems.push({ product_id: productId, product_name: productName, sizes, cost: item.cost })
    }

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO stock_entries (supplier_id, supplier_name, date, notes, total, items_json)
      VALUES (?,?,?,?,?,?)
    `).run(
      supplier_id || null,
      supplier_name || '',
      date || new Date().toISOString().split('T')[0],
      notes || '',
      Number(total) || 0,
      JSON.stringify(processedItems)
    )

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','stockentries',?,'Ingreso de mercadería',?)`)
      .run(lastInsertRowid, JSON.stringify({ supplier_name, total, items: processedItems.length }))

    return { entryId: lastInsertRowid, processedItems }
  })

  const { entryId, processedItems } = run()

  // Fire-and-forget TN stock sync for affected products
  try {
    const { syncStockAfterSale } = require('./tiendanube')
    const syncItems = []
    for (const item of processedItems) {
      const pid = Number(item.product_id)
      if (!pid) continue
      for (const sz of (item.sizes || [])) {
        if (sz.size && sz.size !== 'N/A' && sz.size !== 'Único') {
          syncItems.push({ productId: pid, size: sz.size })
        }
      }
    }
    if (syncItems.length > 0) syncStockAfterSale(syncItems)
  } catch {}

  // Check waitlist arrivals
  try {
    const { checkWaitlistArrivals } = require('./waitlist')
    const db2 = require('../../database/db').getDB()
    checkWaitlistArrivals(db2, processedItems)
  } catch {}

  return { ok: true, id: entryId }
})
