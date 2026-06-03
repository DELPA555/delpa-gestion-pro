const { ipcMain, dialog } = require('electron')
const fs   = require('fs')
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
    console.error('[generateSizeBarcodes] products:', e.message)
  }
}

const SIZE_ORDER = `CASE size
  WHEN '34' THEN 1 WHEN '36' THEN 2 WHEN '38' THEN 3 WHEN '40' THEN 4 WHEN '42' THEN 5
  WHEN '44' THEN 6 WHEN '46' THEN 7 WHEN '48' THEN 8 WHEN '50' THEN 9
  WHEN 'XS' THEN 10 WHEN 'S' THEN 11 WHEN 'M' THEN 12 WHEN 'L' THEN 13 WHEN 'XL' THEN 14 WHEN 'XXL' THEN 15 WHEN 'XXXL' THEN 16
  ELSE 99 END`

// ─── List (main products only, with variants nested) ──────────────────────────

ipcMain.handle('products:list', (_, { page = 1, search = '', category = '', brand = '', limit = 25 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE p.active=1 AND (p.parent_product_id IS NULL OR p.is_variant=0)'
  const params = []
  if (search) {
    where += ' AND (p.name LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (category) { where += ' AND p.category=?'; params.push(category) }
  if (brand)    { where += ' AND p.brand=?';    params.push(brand) }

  const { count } = db.prepare(`SELECT COUNT(*) as count FROM products p ${where}`).get(...params)
  const rows = db.prepare(`
    SELECT p.id, p.barcode, p.name, p.brand, p.category, p.color,
           p.cost, p.price, p.min_stock, p.image_data, p.active,
           COALESCE(p.tn_sync,1) as tn_sync,
           p.parent_product_id, COALESCE(p.is_variant,0) as is_variant,
           p.created_at, p.updated_at,
           COALESCE(SUM(ps.stock),0) as total_stock
    FROM products p LEFT JOIN product_sizes ps ON ps.product_id=p.id
    ${where} GROUP BY p.id ORDER BY p.name ASC LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  const sizesStmt    = db.prepare(`SELECT size, stock, min_stock, size_barcode FROM product_sizes WHERE product_id=? ORDER BY ${SIZE_ORDER}`)
  const variantsStmt = db.prepare(`
    SELECT v.id, v.name, v.color, COALESCE(v.tn_sync,1) as tn_sync, v.image_data, v.price, v.cost,
           COALESCE(SUM(ps.stock),0) as total_stock
    FROM products v LEFT JOIN product_sizes ps ON ps.product_id=v.id
    WHERE v.parent_product_id=? AND v.active=1 GROUP BY v.id ORDER BY v.color ASC
  `)
  const varSizesStmt = db.prepare(`SELECT size, stock, min_stock, size_barcode FROM product_sizes WHERE product_id=? ORDER BY ${SIZE_ORDER}`)

  return {
    products: rows.map(p => {
      const variants = variantsStmt.all(p.id).map(v => ({ ...v, sizes: varSizesStmt.all(v.id) }))
      return { ...p, sizes: sizesStmt.all(p.id), variants }
    }),
    total: count,
    pages: Math.ceil(count / limit),
  }
})

// ─── Get single ───────────────────────────────────────────────────────────────

ipcMain.handle('products:get', (_, id) => {
  const db = getDB()
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(id)
  if (!p) return null
  p.tn_sync = p.tn_sync ?? 1
  p.sizes = db.prepare(`SELECT size, stock, min_stock, size_barcode FROM product_sizes WHERE product_id=? ORDER BY ${SIZE_ORDER}`).all(id)
  return p
})

// ─── Search (includes variants) ───────────────────────────────────────────────

ipcMain.handle('products:search', (_, { q }) => {
  const db = getDB()
  const rows = db.prepare(`
    SELECT p.id, p.barcode, p.name, p.brand, p.color, p.price, p.cost,
           p.image_data, p.parent_product_id, COALESCE(p.is_variant,0) as is_variant
    FROM products p WHERE p.active=1 AND (p.name LIKE ? OR p.barcode LIKE ?)
    LIMIT 20
  `).all(`%${q}%`, `%${q}%`)
  const sizesStmt = db.prepare(`SELECT size, stock FROM product_sizes WHERE product_id=? AND stock>0 ORDER BY ${SIZE_ORDER}`)
  return rows.map(p => ({ ...p, sizes: sizesStmt.all(p.id) }))
})

// ─── Search by barcode (product or size barcode) — for scanner ────────────────

ipcMain.handle('products:searchByBarcode', (_, code) => {
  if (!code) return null
  const db = getDB()
  const sizesQ = `SELECT size, stock, size_barcode FROM product_sizes WHERE product_id=? ORDER BY ${SIZE_ORDER}`

  // 1. Exact product barcode
  const byProduct = db.prepare(
    'SELECT id, barcode, name, brand, color, price, cost, image_data FROM products WHERE active=1 AND barcode=?'
  ).get(code)
  if (byProduct) {
    byProduct.sizes = db.prepare(sizesQ).all(byProduct.id)
    byProduct.matchedSize = null
    return byProduct
  }

  // 2. Size-level barcode (may not exist on very old DBs — wrap defensively)
  try {
    const bySize = db.prepare(`
      SELECT p.id, p.barcode, p.name, p.brand, p.color, p.price, p.cost, p.image_data,
             ps.size AS matched_size, ps.stock AS matched_stock
      FROM product_sizes ps JOIN products p ON p.id=ps.product_id
      WHERE p.active=1 AND ps.size_barcode=? LIMIT 1
    `).get(code)
    if (bySize) {
      bySize.sizes = db.prepare(sizesQ).all(bySize.id)
      bySize.matchedSize = bySize.matched_size  // e.g. 'M'
      bySize.matchedStock = bySize.matched_stock
      return bySize
    }
  } catch {}

  return null
})

// ─── Get variants for a product ───────────────────────────────────────────────

ipcMain.handle('products:getVariants', (_, parentId) => {
  const db = getDB()
  const rows = db.prepare(`
    SELECT v.id, v.name, v.color, v.price, v.cost, v.image_data, COALESCE(v.tn_sync,1) as tn_sync,
           COALESCE(SUM(ps.stock),0) as total_stock
    FROM products v LEFT JOIN product_sizes ps ON ps.product_id=v.id
    WHERE v.parent_product_id=? AND v.active=1 GROUP BY v.id ORDER BY v.color ASC
  `).all(parentId)
  const sizesStmt = db.prepare(`SELECT size, stock, min_stock, size_barcode FROM product_sizes WHERE product_id=? ORDER BY ${SIZE_ORDER}`)
  return rows.map(v => ({ ...v, sizes: sizesStmt.all(v.id) }))
})

// ─── Create ───────────────────────────────────────────────────────────────────

ipcMain.handle('products:create', (_, data) => {
  const db = getDB()
  const { barcode, name, brand, category, color, cost, price, min_stock, image_data, sizes = [], tn_sync = 1 } = data
  const run = db.transaction(() => {
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO products (barcode,name,brand,category,color,cost,price,min_stock,image_data,tn_sync)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(barcode || null, name, brand || '', category || '', color || '',
           cost || 0, price, min_stock || 5, image_data || '', tn_sync ? 1 : 0)
    const ins = db.prepare(`INSERT INTO product_sizes (product_id,size,stock,min_stock) VALUES (?,?,?,?) ON CONFLICT(product_id,size) DO UPDATE SET stock=excluded.stock,min_stock=excluded.min_stock`)
    for (const s of sizes) if (s.size) ins.run(id, s.size, s.stock || 0, s.min_stock || 2)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','products',?,?,?)`)
      .run(id, `Producto creado: ${name}`, JSON.stringify({ name, price, cost }))
    return id
  })
  const id = run()
  if (!barcode) {
    try { db.prepare('UPDATE products SET barcode=? WHERE id=? AND barcode IS NULL').run(genEAN13(id), id) } catch {}
  }
  generateSizeBarcodes(db, id)
  return id
})

// ─── Create variant ───────────────────────────────────────────────────────────

ipcMain.handle('products:createVariant', (_, data) => {
  const db = getDB()
  // Accept both parentProductId (from frontend) and parentId (legacy)
  const resolvedParentId = data.parentProductId || data.parentId
  const { color, barcode, price, cost, image_data, sizes = [], tn_sync = 1 } = data
  const parent = db.prepare('SELECT * FROM products WHERE id=?').get(resolvedParentId)
  if (!parent) return { ok: false, error: 'Producto padre no encontrado' }
  const run = db.transaction(() => {
    const { lastInsertRowid: id } = db.prepare(`
      INSERT INTO products (name,barcode,brand,category,color,cost,price,min_stock,image_data,tn_sync,parent_product_id,is_variant)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1)
    `).run(parent.name, barcode || null, parent.brand || '', parent.category || '', color || '',
           cost !== undefined ? cost : parent.cost,
           price !== undefined ? price : parent.price,
           parent.min_stock, image_data || '', tn_sync ? 1 : 0, resolvedParentId)
    const ins = db.prepare(`INSERT INTO product_sizes (product_id,size,stock,min_stock) VALUES (?,?,?,?) ON CONFLICT(product_id,size) DO UPDATE SET stock=excluded.stock,min_stock=excluded.min_stock`)
    for (const s of sizes) if (s.size) ins.run(id, s.size, s.stock || 0, s.min_stock || 2)
    return id
  })
  const varId = run()
  if (!barcode) {
    try { db.prepare('UPDATE products SET barcode=? WHERE id=? AND barcode IS NULL').run(genEAN13(varId), varId) } catch {}
  }
  generateSizeBarcodes(db, varId)
  return { ok: true, id: varId }
})

// ─── Update ───────────────────────────────────────────────────────────────────

ipcMain.handle('products:update', (_, { id, ...data }) => {
  const db = getDB()
  const { barcode, name, brand, category, color, cost, price, min_stock, image_data, sizes = [], tn_sync, changedBy } = data
  const run = db.transaction(() => {
    // Registrar cambio de precio si cambió
    const current = db.prepare('SELECT price, name FROM products WHERE id=?').get(id)
    if (current && price !== undefined && Number(price) !== Number(current.price)) {
      try {
        db.prepare(
          'INSERT INTO price_history (product_id, product_name, old_price, new_price, changed_by) VALUES (?,?,?,?,?)'
        ).run(id, current.name || name, current.price, Number(price), changedBy || 'usuario')
      } catch {}
    }

    const tnVal = tn_sync !== undefined ? (tn_sync ? 1 : 0) : 1
    if (image_data !== undefined) {
      db.prepare(`UPDATE products SET barcode=?,name=?,brand=?,category=?,color=?,cost=?,price=?,min_stock=?,image_data=?,tn_sync=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(barcode || null, name, brand || '', category || '', color || '', cost || 0, price, min_stock || 5, image_data, tnVal, id)
    } else {
      db.prepare(`UPDATE products SET barcode=?,name=?,brand=?,category=?,color=?,cost=?,price=?,min_stock=?,tn_sync=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(barcode || null, name, brand || '', category || '', color || '', cost || 0, price, min_stock || 5, tnVal, id)
    }
    if (sizes.length > 0) {
      const validSizes = sizes.filter(s => s.size && String(s.size).trim() !== '')
      const upsert = db.prepare(`INSERT INTO product_sizes (product_id,size,stock,min_stock) VALUES (?,?,?,?) ON CONFLICT(product_id,size) DO UPDATE SET stock=excluded.stock,min_stock=excluded.min_stock`)
      for (const s of validSizes) upsert.run(id, s.size, s.stock || 0, s.min_stock || 2)
      if (validSizes.length > 0) {
        const names = validSizes.map(s => s.size)
        db.prepare(`DELETE FROM product_sizes WHERE product_id=? AND size NOT IN (${names.map(() => '?').join(',')})`)
          .run(id, ...names)
      }
    }
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('UPDATE','products',?,?)`)
      .run(id, `Producto actualizado: ${name}`)
    return true
  })
  const result = run()
  generateSizeBarcodes(db, id)
  return result
})

// ─── Price history ────────────────────────────────────────────────────────────

ipcMain.handle('products:priceHistory', (_, productId) => {
  return getDB().prepare(
    'SELECT * FROM price_history WHERE product_id=? ORDER BY changed_at DESC LIMIT 100'
  ).all(productId)
})

// ─── Delete ───────────────────────────────────────────────────────────────────

ipcMain.handle('products:delete', (_, id) => {
  const db = getDB()
  const p = db.prepare('SELECT name FROM products WHERE id=?').get(id)
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(id)
  db.prepare('UPDATE products SET active=0 WHERE parent_product_id=?').run(id)
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('DELETE','products',?,?)`).run(id, `Producto eliminado: ${p?.name}`)
  return true
})

// ─── Set TN sync for one product ─────────────────────────────────────────────

ipcMain.handle('products:setTnSync', (_, { id, value }) => {
  getDB().prepare('UPDATE products SET tn_sync=? WHERE id=?').run(value ? 1 : 0, id)
  return true
})

// ─── Bulk actions ─────────────────────────────────────────────────────────────

ipcMain.handle('products:bulkAction', (_, { ids, action, value }) => {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'Sin productos seleccionados' }
  const db = getDB()
  const ph = ids.map(() => '?').join(',')
  try {
    if (action === 'delete') {
      db.prepare(`UPDATE products SET active=0 WHERE id IN (${ph})`).run(...ids)
      db.prepare(`UPDATE products SET active=0 WHERE parent_product_id IN (${ph})`).run(...ids)
    } else if (action === 'setTnSync') {
      db.prepare(`UPDATE products SET tn_sync=? WHERE id IN (${ph})`).run(value ? 1 : 0, ...ids)
    } else if (action === 'setCategory') {
      db.prepare(`UPDATE products SET category=? WHERE id IN (${ph})`).run(value || '', ...ids)
    } else if (action === 'applyDiscount') {
      const pct = Math.max(0, Math.min(99, Number(value) || 0))
      const factor = (100 - pct) / 100
      db.prepare(`UPDATE products SET price=ROUND(price*?,2) WHERE id IN (${ph})`).run(factor, ...ids)
    } else {
      return { ok: false, error: 'Acción desconocida' }
    }
    return { ok: true, affected: ids.length }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─── Export CSV ───────────────────────────────────────────────────────────────

ipcMain.handle('products:exportCSV', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Exportar productos',
    defaultPath: `productos-${new Date().toISOString().slice(0,10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }

  const db = getDB()
  const products = db.prepare(
    `SELECT p.id,p.barcode,p.name,p.brand,p.category,p.color,p.cost,p.price,p.min_stock,COALESCE(p.tn_sync,1) as tn_sync
     FROM products p WHERE p.active=1 ORDER BY p.name ASC`
  ).all()

  const ALL_SIZES = ['34','36','38','40','42','44','46','48','50','XS','S','M','L','XL','XXL','XXXL']
  const sizesStmt = db.prepare('SELECT size,stock FROM product_sizes WHERE product_id=?')
  const esc = v => { const s = String(v??''); return s.includes(';')||s.includes('"')||s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s }

  const headers = ['id','barcode','name','brand','category','color','cost','price','min_stock','tn_sync',
    ...ALL_SIZES.map(s=>`stock_${s}`)]
  const lines = [headers.join(';')]
  for (const p of products) {
    const sm = Object.fromEntries(sizesStmt.all(p.id).map(s=>[s.size,s.stock]))
    lines.push([p.id,p.barcode||'',p.name,p.brand||'',p.category||'',p.color||'',
      p.cost,p.price,p.min_stock,p.tn_sync,...ALL_SIZES.map(s=>sm[s]??0)].map(esc).join(';'))
  }
  fs.writeFileSync(filePath, '﻿' + lines.join('\n'), 'utf8')
  return { ok: true, exported: products.length, filePath }
})

// ─── CSV template ─────────────────────────────────────────────────────────────

ipcMain.handle('products:csvTemplate', async () => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Guardar plantilla CSV',
    defaultPath: 'plantilla-productos.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  const ALL_SIZES = ['34','36','38','40','42','44','46','48','50','XS','S','M','L','XL','XXL','XXXL']
  const h = ['barcode','name','brand','category','color','cost','price','min_stock',...ALL_SIZES.map(s=>`stock_${s}`)]
  const ex = ['7790001234567','Jean clásico','Levis','Jeans','Azul marino','3500','8900','5',
    ...ALL_SIZES.map(s=>['40','42'].includes(s)?'10':'0')]
  fs.writeFileSync(filePath, '﻿' + [h.join(';'), ex.join(';')].join('\n'), 'utf8')
  return { ok: true, filePath }
})

// ─── Import CSV ───────────────────────────────────────────────────────────────

ipcMain.handle('products:importCSV', async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: 'Importar productos desde CSV',
    filters: [{ name: 'CSV', extensions: ['csv','txt'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths?.length) return { ok: false, canceled: true }

  const db = getDB()
  const raw = fs.readFileSync(filePaths[0], 'utf8').replace(/^﻿/, '')
  const lines = raw.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { ok: false, error: 'Archivo vacío' }

  const sep = lines[0].includes(';') ? ';' : ','
  const parseRow = line => {
    const f=[]; let cur='', inQ=false
    for (let i=0;i<line.length;i++) {
      const ch=line[i]
      if(inQ){if(ch==='"'&&line[i+1]==='"'){cur+='"';i++}else if(ch==='"')inQ=false;else cur+=ch}
      else{if(ch==='"')inQ=true;else if(ch===sep){f.push(cur.trim());cur=''}else cur+=ch}
    }
    f.push(cur.trim()); return f
  }

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().trim())
  const ALL_SIZES = ['34','36','38','40','42','44','46','48','50','XS','S','M','L','XL','XXL','XXXL']
  const col = n => headers.indexOf(n)

  let imported=0, updated=0, errors=0, errorList=[]
  const upsertSize = db.prepare(`INSERT INTO product_sizes (product_id,size,stock,min_stock) VALUES (?,?,?,2) ON CONFLICT(product_id,size) DO UPDATE SET stock=excluded.stock`)

  for (let i=1;i<lines.length;i++) {
    try {
      const row = parseRow(lines[i])
      const name = col('name')>=0 ? row[col('name')] : ''
      if (!name) continue
      const barcode  = col('barcode')>=0   ? (row[col('barcode')]||null)  : null
      const brand    = col('brand')>=0     ? row[col('brand')]    : ''
      const category = col('category')>=0  ? row[col('category')] : ''
      const color    = col('color')>=0     ? row[col('color')]    : ''
      const cost     = parseFloat(row[col('cost')]||'0')||0
      const price    = parseFloat(row[col('price')]||'0')||0
      const minStock = parseInt(row[col('min_stock')]||'5',10)||5

      let productId
      const existing = barcode
        ? db.prepare('SELECT id FROM products WHERE barcode=? AND active=1').get(barcode)
        : db.prepare('SELECT id FROM products WHERE lower(trim(name))=lower(trim(?)) AND active=1').get(name)

      if (existing) {
        db.prepare(`UPDATE products SET name=?,brand=?,category=?,color=?,cost=?,price=?,min_stock=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(name,brand,category,color,cost,price,minStock,existing.id)
        productId=existing.id; updated++
      } else {
        const {lastInsertRowid} = db.prepare(
          `INSERT INTO products (barcode,name,brand,category,color,cost,price,min_stock) VALUES (?,?,?,?,?,?,?,?)`
        ).run(barcode,name,brand,category,color,cost,price,minStock)
        productId=lastInsertRowid; imported++
      }
      for (const sz of ALL_SIZES) {
        const c=col(`stock_${sz}`); if(c<0) continue
        const stk=parseInt(row[c]||'0',10)||0
        if(stk>0) upsertSize.run(productId,sz,stk)
      }
      generateSizeBarcodes(db, productId)
    } catch(e) { errors++; errorList.push(`Fila ${i+1}: ${e.message}`) }
  }
  return { ok:true, imported, updated, errors, errorList: errorList.slice(0,10) }
})
