const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// Columnas para multi-producto (idempotente — DBs viejas siguen funcionando)
function ensureExchangeColumns(db) {
  try {
    const info = db.prepare("PRAGMA table_info('product_exchanges')").all()
    if (!info.find(c => c.name === 'returned_items_json'))
      db.exec("ALTER TABLE product_exchanges ADD COLUMN returned_items_json TEXT DEFAULT '[]'")
    if (!info.find(c => c.name === 'new_items_json'))
      db.exec("ALTER TABLE product_exchanges ADD COLUMN new_items_json TEXT DEFAULT '[]'")
  } catch (e) { console.error('[Exchange] ensureColumns:', e.message) }
}

// Normaliza el payload (multi-producto nuevo o single legacy) a arrays de items
function normalizeItems(data) {
  const norm = it => ({
    product_id:   it.productId ?? it.product_id,
    product_name: it.productName ?? it.product_name ?? '',
    size:         it.size ?? 'N/A',
    color:        it.color ?? '',
    qty:          Number(it.qty ?? it.quantity) || 0,
    price:        Number(it.price ?? it.unit_price) || 0,
  })
  let returned = [], nuevos = []
  if (Array.isArray(data.returnedItems) || Array.isArray(data.newItems)) {
    returned = (data.returnedItems || []).map(norm)
    nuevos   = (data.newItems || []).map(norm)
  } else {
    // Compat: payload single-producto antiguo
    returned = [{ product_id: data.returnedProductId, product_name: data.returnedProductName, size: data.returnedSize, color: data.returnedColor || '', qty: Number(data.returnedQty) || 0, price: Number(data.returnedPrice) || 0 }]
    nuevos   = [{ product_id: data.newProductId, product_name: data.newProductName, size: data.newSize, color: data.newColor || '', qty: Number(data.newQty) || 0, price: Number(data.newPrice) || 0 }]
  }
  // Descartar filas vacías
  returned = returned.filter(i => i.product_id && i.qty > 0)
  nuevos   = nuevos.filter(i => i.product_id && i.qty > 0)
  return { returned, nuevos }
}

// ── Product Exchange ─────────────────────────────────────────────────────────

ipcMain.handle('exchanges:create', (_, data) => {
  const db = getDB()
  ensureExchangeColumns(db)
  const { clientId, clientName, resolution, paymentMethod, notes, sellerName } = data
  const { returned, nuevos } = normalizeItems(data)

  if (returned.length === 0) return { ok: false, error: 'No hay productos devueltos' }
  if (nuevos.length === 0)   return { ok: false, error: 'No hay productos nuevos' }

  const returnedTotal = returned.reduce((s, i) => s + i.qty * i.price, 0)
  const newTotal      = nuevos.reduce((s, i) => s + i.qty * i.price, 0)
  const difference    = newTotal - returnedTotal

  const run = db.transaction(() => {
    // ── Productos devueltos: SUMAR stock (UPSERT — el talle puede no existir) ──
    for (const it of returned) {
      if (!it.size || it.size === 'N/A') continue
      const before = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(it.product_id, it.size)
      if (before) {
        db.prepare('UPDATE product_sizes SET stock=stock+? WHERE product_id=? AND size=?').run(it.qty, it.product_id, it.size)
      } else {
        db.prepare('INSERT INTO product_sizes (product_id, size, stock, min_stock) VALUES (?,?,?,0)').run(it.product_id, it.size, it.qty)
      }
      const after = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(it.product_id, it.size)
      console.log(`[Exchange] DEVUELTO: "${it.product_name}" T.${it.size} x${it.qty} | ${before?.stock ?? 'nuevo'} → ${after?.stock}`)
    }

    // ── Productos nuevos: RESTAR stock (MAX 0, no negativo) ───────────────────
    for (const it of nuevos) {
      if (!it.size || it.size === 'N/A') continue
      const row = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(it.product_id, it.size)
      if (!row) {
        console.warn(`[Exchange] ADVERTENCIA: talle ${it.size} de "${it.product_name}" no existe en stock, no se descuenta`)
        continue
      }
      if (row.stock < it.qty) {
        console.warn(`[Exchange] ADVERTENCIA: stock insuficiente "${it.product_name}" T.${it.size} (stock=${row.stock}, solicitado=${it.qty})`)
      }
      db.prepare('UPDATE product_sizes SET stock=MAX(0,stock-?) WHERE product_id=? AND size=?').run(it.qty, it.product_id, it.size)
      const after = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(it.product_id, it.size)
      console.log(`[Exchange] NUEVO: "${it.product_name}" T.${it.size} x${it.qty} | ${row.stock} → ${after?.stock}`)
    }

    // ── Diferencia ────────────────────────────────────────────────────────────
    const cashbox = db.prepare("SELECT id FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()
    if (difference > 0) {
      // La clienta abona la diferencia → ingreso en caja
      if (cashbox) {
        db.prepare(`INSERT INTO cashbox_movements (cashbox_id,type,concept,amount,payment_method) VALUES (?,'ingreso',?,?,?)`)
          .run(cashbox.id, `Diferencia cambio — ${clientName || 'cliente'}`, difference, paymentMethod || 'Efectivo')
      }
    } else if (difference < 0) {
      const owed = Math.abs(difference)
      if (resolution === 'credit' && clientId) {
        // Acreditar a cuenta corriente de la clienta
        db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(owed, clientId)
        db.prepare(`INSERT INTO account_movements (client_id,type,amount,notes) VALUES (?,'payment',?,'Crédito por cambio de mercadería')`)
          .run(clientId, owed)
      } else if (cashbox) {
        // Se devuelve en efectivo → egreso en caja
        db.prepare(`INSERT INTO cashbox_movements (cashbox_id,type,concept,amount,payment_method) VALUES (?,'egreso',?,?,?)`)
          .run(cashbox.id, `Devolución dif. cambio — ${clientName || 'cliente'}`, owed, paymentMethod || 'Efectivo')
      }
    }

    // Resolución final calculada
    const finalResolution = difference > 0 ? 'paid' : difference < 0 ? (resolution === 'credit' ? 'credit' : 'cash') : 'even'

    // Primer item de cada lado en columnas legacy (compat con listados existentes)
    const r0 = returned[0], n0 = nuevos[0]
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO product_exchanges
        (client_id,client_name,returned_product_id,returned_product_name,returned_size,returned_qty,returned_price,
         new_product_id,new_product_name,new_size,new_qty,new_price,difference,resolution,notes,seller_name,
         returned_items_json,new_items_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clientId || null, clientName || '',
      r0.product_id, r0.product_name, r0.size, returned.reduce((s, i) => s + i.qty, 0), r0.price,
      n0.product_id, n0.product_name, n0.size, nuevos.reduce((s, i) => s + i.qty, 0), n0.price,
      difference, finalResolution, notes || '', sellerName || '',
      JSON.stringify(returned), JSON.stringify(nuevos)
    )

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','exchanges',?,'Cambio de mercadería',?)`)
      .run(lastInsertRowid, JSON.stringify({ returned: returned.length, nuevos: nuevos.length, difference, resolution: finalResolution }))

    return lastInsertRowid
  })

  return { ok: true, id: run(), difference, returnedTotal, newTotal }
})

ipcMain.handle('exchanges:list', (_, { page = 1, limit = 25 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const { count } = db.prepare('SELECT COUNT(*) as count FROM product_exchanges').get()
  const rows = db.prepare('SELECT * FROM product_exchanges ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  const exchanges = rows.map(r => {
    let returnedItems = [], newItems = []
    try { returnedItems = JSON.parse(r.returned_items_json || '[]') } catch {}
    try { newItems = JSON.parse(r.new_items_json || '[]') } catch {}
    return { ...r, returnedItems, newItems }
  })
  return { exchanges, total: count, pages: Math.ceil(count / limit) }
})

// ── Product Return ───────────────────────────────────────────────────────────

ipcMain.handle('returns:create', (_, data) => {
  const db = getDB()
  const { originalSaleId, clientId, clientName, reason, items, resolution, notes, sellerName } = data

  const total = (items || []).reduce((s, it) => s + (it.qty || 1) * (it.unit_price || 0), 0)

  const run = db.transaction(() => {
    for (const it of items || []) {
      if (it.size && it.size !== 'N/A') {
        db.prepare('UPDATE product_sizes SET stock=stock+? WHERE product_id=? AND size=?')
          .run(it.qty || 1, it.product_id, it.size)
      }
    }

    if (resolution === 'credit' && clientId) {
      db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(total, clientId)
      db.prepare(`INSERT INTO account_movements (client_id,type,amount,sale_id,notes) VALUES (?,'payment',?,?,'Devolución acreditada a cuenta corriente')`)
        .run(clientId, total, originalSaleId || null)
    }
    // Register cashbox egreso when refund is paid in cash
    if (resolution === 'cash' && total > 0) {
      const cashbox = db.prepare("SELECT id FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()
      if (cashbox) {
        db.prepare(`INSERT INTO cashbox_movements (cashbox_id,type,concept,amount,payment_method) VALUES (?,'egreso',?,?,'Efectivo')`)
          .run(cashbox.id, `Devolución — ${clientName || 'cliente'}`, total)
      }
    }

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO product_returns (original_sale_id,client_id,client_name,reason,total,resolution,items_json,notes,seller_name)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      originalSaleId || null, clientId || null, clientName || '',
      reason, total, resolution || 'cash',
      JSON.stringify(items || []), notes || '', sellerName || ''
    )

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','returns',?,'Devolución registrada',?)`)
      .run(lastInsertRowid, JSON.stringify({ originalSaleId, clientName, total, resolution, reason }))

    return { id: lastInsertRowid, total }
  })

  const result = run()
  return { ok: true, ...result }
})

ipcMain.handle('returns:list', (_, { page = 1, limit = 25 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const { count } = db.prepare('SELECT COUNT(*) as count FROM product_returns').get()
  const rows = db.prepare('SELECT * FROM product_returns ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  return {
    returns: rows.map(r => ({ ...r, items: JSON.parse(r.items_json || '[]') })),
    total: count,
    pages: Math.ceil(count / limit),
  }
})
