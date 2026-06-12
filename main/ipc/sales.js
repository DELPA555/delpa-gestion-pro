const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('sales:create', (_, {
  clientId, items, total, subtotal, discount, paymentMethod, notes,
  installments, surchargeRate, voucherType, sellerName, sucursalId,
  // AFIP fields
  cae, caeFchVto, tipoCbte, cbteNro, ptoVenta, docTipo, docNro,
  // Multi-payment: array of {paymentMethod, amount, installments, surchargeRate, surchargeAmount, finalAmount}
  payments,
  // Points
  pointsRedeemed,
  // Mercado Pago QR
  mpPaymentId,
}) => {
  const db = getDB()
  const cashbox = db.prepare("SELECT id FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()

  const isMulti = Array.isArray(payments) && payments.length > 1
  const effectiveMethod = isMulti ? 'Múltiple' : paymentMethod

  const run = db.transaction(() => {
    const seqRow = db.prepare("SELECT value FROM settings WHERE key='sale_seq'").get()
    const seq = (parseInt(seqRow?.value || '0', 10)) + 1
    const year = new Date().getFullYear()
    const saleNumber = `${year}-${String(seq).padStart(4, '0')}`
    db.prepare("UPDATE settings SET value=? WHERE key='sale_seq'").run(String(seq))

    const { lastInsertRowid: saleId } = db.prepare(`
      INSERT INTO sales
        (client_id,total,subtotal,discount,payment_method,notes,cashbox_id,installments,
         surcharge_rate,voucher_type,seller_name,sale_number,sucursal_id,
         cae,cae_fch_vto,tipo_cbte,cbte_nro,pto_venta,doc_tipo,doc_nro,mp_payment_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clientId || null, total, subtotal || total, discount || 0,
      effectiveMethod, notes || '', cashbox?.id || null,
      installments || 1, surchargeRate || 0, voucherType || 'ticket',
      sellerName || '', saleNumber, sucursalId || null,
      cae || '', caeFchVto || '', tipoCbte || 0, cbteNro || 0,
      ptoVenta || 0, docTipo || 99, docNro || '0', mpPaymentId || '',
    )

    // Insert payment breakdown rows
    if (isMulti) {
      const insPayment = db.prepare(`
        INSERT INTO sale_payments (sale_id,payment_method,amount,installments,surcharge_rate,surcharge_amount,final_amount)
        VALUES (?,?,?,?,?,?,?)
      `)
      for (const p of payments) {
        insPayment.run(saleId, p.paymentMethod, p.amount, p.installments || 1, p.surchargeRate || 0, p.surchargeAmount || 0, p.finalAmount)
      }
    }

    const insItem = db.prepare(`
      INSERT INTO sale_items (sale_id,product_id,product_name,size,quantity,unit_price,unit_cost,discount)
      VALUES (?,?,?,?,?,?,?,?)
    `)
    const updStock = db.prepare(`UPDATE product_sizes SET stock=MAX(0,stock-?) WHERE product_id=? AND size=?`)
    const updModTime = db.prepare(`UPDATE product_sizes SET stock_modified_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=?`)
    const updStockNull = db.prepare(`UPDATE product_sizes SET stock=MAX(0,stock-?) WHERE product_id=? AND (size IS NULL OR size='')`)
    for (const it of items) {
      insItem.run(saleId, it.productId, it.productName, it.size, it.quantity, it.unitPrice, it.unitCost || 0, it.discount || 0)
      const sz = it.size || 'N/A'
      console.log('[SALE] Descontando stock:', { product_id: it.productId, size: sz, qty: it.quantity })
      const r = updStock.run(it.quantity, it.productId, sz)
      if (r.changes === 0 && sz === 'N/A') {
        const r2 = updStockNull.run(it.quantity, it.productId)
        console.log('[SALE] Fallback N/A:', r2.changes > 0 ? 'match NULL/""' : 'no match (sin stock trackeado)')
      }
      updModTime.run(it.productId, sz)
    }

    // Auto-record consignment sales
    try {
      const checkConsign = db.prepare(
        `SELECT cp.cost_per_unit, cp.supplier_id, s.name as supplier_name
         FROM consignment_products cp
         LEFT JOIN suppliers s ON s.id = cp.supplier_id
         WHERE cp.product_id = ? AND cp.active = 1`
      )
      const insConsignSale = db.prepare(
        `INSERT INTO consignment_sales
           (sale_id, product_id, product_name, size, quantity, cost_per_unit, total_cost, supplier_id, supplier_name, sold_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      for (const it of items) {
        if (!it.productId) continue
        const cp = checkConsign.get(it.productId)
        if (cp) {
          insConsignSale.run(
            saleId, it.productId, it.productName, it.size || 'N/A',
            it.quantity, cp.cost_per_unit, it.quantity * (cp.cost_per_unit || 0),
            cp.supplier_id, cp.supplier_name || ''
          )
        }
      }
    } catch (e) {
      console.error('[CONSIGNMENT] Error al registrar venta consignada:', e.message)
    }

    // Account movements for Cuenta Corriente portions
    if (isMulti) {
      const ccPayments = payments.filter(p => p.paymentMethod === 'Cuenta Corriente')
      if (ccPayments.length > 0 && clientId) {
        const ccTotal = ccPayments.reduce((s, p) => s + p.finalAmount, 0)
        db.prepare('UPDATE clients SET balance=balance+? WHERE id=?').run(ccTotal, clientId)
        db.prepare(`INSERT INTO account_movements (client_id,type,amount,sale_id,notes) VALUES (?,'debt',?,?,'Venta en cuenta corriente')`)
          .run(clientId, ccTotal, saleId)
      }
    } else if (paymentMethod === 'Cuenta Corriente' && clientId) {
      db.prepare('UPDATE clients SET balance=balance+? WHERE id=?').run(total, clientId)
      db.prepare(`INSERT INTO account_movements (client_id,type,amount,sale_id,notes) VALUES (?,'debt',?,?,'Venta en cuenta corriente')`)
        .run(clientId, total, saleId)
    }

    // Points: redeem
    if (pointsRedeemed && pointsRedeemed > 0 && clientId) {
      const client = db.prepare('SELECT points FROM clients WHERE id=?').get(clientId)
      const currentPoints = client?.points || 0
      if (currentPoints >= pointsRedeemed) {
        db.prepare('UPDATE clients SET points=points-? WHERE id=?').run(pointsRedeemed, clientId)
        db.prepare('INSERT INTO client_points_log (client_id,type,amount,sale_id,notes) VALUES (?,?,?,?,?)')
          .run(clientId, 'redeem', -pointsRedeemed, saleId, 'Canje en venta')
      }
    }

    const isFacturada = cae ? 1 : 0
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','sales',?,?,?)`)
      .run(saleId, `Venta ${saleNumber} registrada $${total}${isFacturada ? ' [FACTURADA]' : ''}`,
           JSON.stringify({ total, paymentMethod: effectiveMethod, items: items.length, saleNumber, cae: cae || null }))

    // Points: earn (dentro de la transaction para garantía ACID)
    let earnedPoints = 0
    if (clientId) {
      const enabled = db.prepare("SELECT value FROM settings WHERE key='points_enabled'").get()?.value
      if (enabled === '1') {
        const perPesos = parseInt(db.prepare("SELECT value FROM settings WHERE key='points_per_pesos'").get()?.value || '1000', 10)
        earnedPoints = Math.floor(total / perPesos)
        if (earnedPoints > 0) {
          db.prepare('UPDATE clients SET points=points+? WHERE id=?').run(earnedPoints, clientId)
          db.prepare('INSERT INTO client_points_log (client_id,type,amount,sale_id,notes) VALUES (?,?,?,?,?)')
            .run(clientId, 'earn', earnedPoints, saleId, `Puntos ganados en venta ${saleNumber}`)
        }
      }
    }

    return { saleId, saleNumber, itemsForSync: items, earnedPoints }
  })
  const result = run()

  // Points email (fire-and-forget, sin bloquear la venta)
  if (clientId && result.earnedPoints > 0) {
    try {
      const { sendPointsSummaryAsync } = require('./email')
      sendPointsSummaryAsync({ clientId, saleId: result.saleId, saleNumber: result.saleNumber, saleTotal: total, earned: result.earnedPoints })
    } catch {}
  }

  // Async TN stock sync (fire-and-forget, non-blocking)
  try {
    const { syncStockAfterSale } = require('./tiendanube')
    syncStockAfterSale(result.itemsForSync)
  } catch {}
  return { saleId: result.saleId, saleNumber: result.saleNumber }
})

ipcMain.handle('sales:list', (_, { page = 1, limit = 25, from, to, includeVoided } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = includeVoided ? 'WHERE 1=1' : 'WHERE s.voided=0'
  const params = []
  if (from) { where += " AND date(s.created_at,'localtime')>=?"; params.push(from) }
  if (to)   { where += " AND date(s.created_at,'localtime')<=?"; params.push(to) }

  const { count } = db.prepare(`SELECT COUNT(*) as count FROM sales s ${where}`).get(...params)
  const rows = db.prepare(`
    SELECT s.id, s.sale_number, s.total, s.subtotal, s.discount, s.payment_method, s.notes,
           s.created_at, s.voided, s.void_reason, s.installments, s.surcharge_rate,
           s.voucher_type, s.seller_name, s.cae, s.tipo_cbte, s.cbte_nro, s.pto_venta,
           c.name as client_name
    FROM sales s LEFT JOIN clients c ON c.id=s.client_id
    ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  return { sales: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('sales:get', (_, id) => {
  const db = getDB()
  const sale = db.prepare(`
    SELECT s.*, c.name as client_name FROM sales s
    LEFT JOIN clients c ON c.id=s.client_id WHERE s.id=?
  `).get(id)
  if (!sale) return null
  sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(id)
  sale.payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id=? ORDER BY id ASC').all(id)
  return sale
})

ipcMain.handle('sales:void', (_, payload) => {
  const db = getDB()
  const id     = typeof payload === 'object' ? payload.id : payload
  const reason = typeof payload === 'object' ? (payload.reason || '') : ''

  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(id)
  if (!sale || sale.voided) throw new Error('Venta no encontrada o ya anulada')

  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(id)

  const run = db.transaction(() => {
    for (const it of items)
      if (it.size !== 'N/A')
        db.prepare('UPDATE product_sizes SET stock=stock+? WHERE product_id=? AND size=?').run(it.quantity, it.product_id, it.size)

    if (sale.payment_method === 'Cuenta Corriente' && sale.client_id) {
      db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(sale.total, sale.client_id)
      db.prepare(`INSERT INTO account_movements (client_id,type,amount,sale_id,notes) VALUES (?,'payment',?,?,'Anulación de venta')`)
        .run(sale.client_id, sale.total, id)
    }
    db.prepare('UPDATE sales SET voided=1, void_reason=? WHERE id=?').run(reason, id)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('VOID','sales',?,?,?)`)
      .run(id, `Venta anulada $${sale.total}`, JSON.stringify({ reason, saleNumber: sale.sale_number }))
    return true
  })
  return run()
})
