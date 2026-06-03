const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// ── Product Exchange ─────────────────────────────────────────────────────────

ipcMain.handle('exchanges:create', (_, data) => {
  const db = getDB()
  const {
    clientId, clientName,
    returnedProductId, returnedProductName, returnedSize, returnedQty, returnedPrice,
    newProductId, newProductName, newSize, newQty, newPrice,
    resolution, notes, sellerName,
  } = data

  const qtyReturned = Number(returnedQty) || 0
  const qtyNew      = Number(newQty)      || 0
  const difference  = (Number(newPrice) * qtyNew) - (Number(returnedPrice) * qtyReturned)

  const run = db.transaction(() => {
    // ── Producto devuelto: SUMAR stock (UPSERT — el talle puede no existir) ──
    if (returnedSize && returnedSize !== 'N/A' && qtyReturned > 0) {
      const before = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(returnedProductId, returnedSize)
      if (before) {
        db.prepare('UPDATE product_sizes SET stock=stock+? WHERE product_id=? AND size=?')
          .run(qtyReturned, returnedProductId, returnedSize)
      } else {
        // El talle no existía en DB → crearlo con la cantidad devuelta
        db.prepare('INSERT INTO product_sizes (product_id, size, stock, min_stock) VALUES (?,?,?,0)')
          .run(returnedProductId, returnedSize, qtyReturned)
      }
      const after = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(returnedProductId, returnedSize)
      console.log(`[Exchange] DEVUELTO: "${returnedProductName}" T.${returnedSize} | ${before?.stock ?? 'nuevo'} → ${after?.stock}`)
    }

    // ── Producto nuevo: RESTAR stock (MAX 0, no negativo) ─────────────────────
    if (newSize && newSize !== 'N/A' && qtyNew > 0) {
      const row = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(newProductId, newSize)
      if (!row) {
        console.warn(`[Exchange] ADVERTENCIA: talle ${newSize} de "${newProductName}" no existe en stock, no se descuenta`)
      } else {
        if (row.stock < qtyNew) {
          console.warn(`[Exchange] ADVERTENCIA: stock insuficiente "${newProductName}" T.${newSize} (stock=${row.stock}, solicitado=${qtyNew})`)
        }
        db.prepare('UPDATE product_sizes SET stock=MAX(0,stock-?) WHERE product_id=? AND size=?')
          .run(qtyNew, newProductId, newSize)
        const after = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(newProductId, newSize)
        console.log(`[Exchange] NUEVO: "${newProductName}" T.${newSize} | ${row.stock} → ${after?.stock}`)
      }
    }
    // Credit to client account if resolution === 'credit' and we owe them money
    if (resolution === 'credit' && clientId && difference < 0) {
      const credit = Math.abs(difference)
      db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(credit, clientId)
      db.prepare(`INSERT INTO account_movements (client_id,type,amount,notes) VALUES (?,'payment',?,'Crédito por cambio de mercadería')`)
        .run(clientId, credit)
    }

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO product_exchanges
        (client_id,client_name,returned_product_id,returned_product_name,returned_size,returned_qty,returned_price,
         new_product_id,new_product_name,new_size,new_qty,new_price,difference,resolution,notes,seller_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clientId || null, clientName || '',
      returnedProductId, returnedProductName, returnedSize, qtyReturned, Number(returnedPrice) || 0,
      newProductId, newProductName, newSize, qtyNew, Number(newPrice) || 0,
      difference, resolution || 'paid', notes || '', sellerName || ''
    )

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','exchanges',?,'Cambio de mercadería',?)`)
      .run(lastInsertRowid, JSON.stringify({ returnedProductName, newProductName, difference, resolution }))

    return lastInsertRowid
  })

  return { ok: true, id: run() }
})

ipcMain.handle('exchanges:list', (_, { page = 1, limit = 25 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const { count } = db.prepare('SELECT COUNT(*) as count FROM product_exchanges').get()
  const rows = db.prepare('SELECT * FROM product_exchanges ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  return { exchanges: rows, total: count, pages: Math.ceil(count / limit) }
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
