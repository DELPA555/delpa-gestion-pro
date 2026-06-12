const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('senas:list', (_, { page = 1, limit = 25, status = '' } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE 1=1'
  const params = []
  if (status) { where += ' AND status=?'; params.push(status) }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM senas ${where}`).get(...params)
  const rows = db.prepare(`SELECT * FROM senas ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { senas: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('senas:pending', () => {
  const db = getDB()
  const { count } = db.prepare("SELECT COUNT(*) as count FROM senas WHERE status='pendiente'").get()
  return count
})

ipcMain.handle('senas:create', (_, data) => {
  const db = getDB()
  const {
    clientId, clientName, clientPhone,
    productId, productName, size, color,
    totalPrice, advanceAmount, deadline, notes, sellerName,
  } = data

  if ((advanceAmount || 0) > (totalPrice || 0)) {
    return { ok: false, error: 'La seña no puede superar el precio total' }
  }
  const remaining = (totalPrice || 0) - (advanceAmount || 0)

  const run = db.transaction(() => {
    // Reserve stock
    if (productId && size && size !== 'N/A') {
      const row = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(productId, size)
      if (!row || row.stock < 1) throw new Error(`Sin stock de ${productName} T.${size}`)
      db.prepare('UPDATE product_sizes SET stock=stock-1 WHERE product_id=? AND size=?').run(productId, size)
      db.prepare('UPDATE product_sizes SET stock_modified_at=CURRENT_TIMESTAMP WHERE product_id=? AND size=?').run(productId, size)
    }

    // Generate correlative seña number
    const seqRow = db.prepare("SELECT value FROM settings WHERE key='sena_seq'").get()
    const seq = (parseInt(seqRow?.value || '0', 10)) + 1
    const year = new Date().getFullYear()
    const senaNumber = `SEÑA-${year}-${String(seq).padStart(4, '0')}`
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('sena_seq',?)").run(String(seq))

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO senas
        (client_id,client_name,client_phone,product_id,product_name,size,color,
         total_price,advance_amount,remaining,deadline,notes,seller_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clientId || null, clientName, clientPhone || '',
      productId || null, productName, size || '', color || '',
      totalPrice || 0, advanceAmount || 0, remaining,
      deadline || '', notes || '', sellerName || ''
    )

    // Register cashbox movement for the advance received
    if (advanceAmount > 0) {
      const cashbox = db.prepare("SELECT id FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()
      if (cashbox) {
        db.prepare(`
          INSERT INTO cashbox_movements (cashbox_id, type, concept, amount, payment_method)
          VALUES (?, 'ingreso', ?, ?, 'Efectivo')
        `).run(cashbox.id, `${senaNumber} — ${productName}${size ? ` T.${size}` : ''}`, advanceAmount)
      }
    }

    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('CREATE','senas',?,'Seña registrada',?)`)
      .run(lastInsertRowid, JSON.stringify({ senaNumber, clientName, productName, size, advanceAmount, totalPrice, deadline }))

    return {
      id: lastInsertRowid,
      senaNumber,
      clientName,
      clientPhone: clientPhone || '',
      productName,
      size: size || '',
      color: color || '',
      totalPrice: totalPrice || 0,
      advanceAmount: advanceAmount || 0,
      remaining,
      deadline: deadline || '',
      notes: notes || '',
    }
  })

  return { ok: true, ...run() }
})

ipcMain.handle('senas:update', (_, { id, ...data }) => {
  const db = getDB()
  const { status, notes, deadline, advanceAmount, sellerName } = data
  const seña = db.prepare('SELECT * FROM senas WHERE id=?').get(id)
  if (!seña) return { ok: false, error: 'Seña no encontrada' }

  db.prepare(`UPDATE senas SET status=?,notes=?,deadline=?,advance_amount=?,seller_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(status || seña.status, notes ?? seña.notes, deadline ?? seña.deadline, advanceAmount ?? seña.advance_amount, sellerName ?? seña.seller_name, id)
  return { ok: true }
})

ipcMain.handle('senas:withdraw', (_, { id, paymentMethod, sellerName }) => {
  const db = getDB()
  const seña = db.prepare('SELECT * FROM senas WHERE id=?').get(id)
  if (!seña) return { ok: false, error: 'Seña no encontrada' }
  if (seña.status !== 'pendiente') return { ok: false, error: 'La seña no está pendiente' }

  const cashbox = db.prepare("SELECT id FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()

  const run = db.transaction(() => {
    // Create sale for remaining amount
    const seqRow = db.prepare("SELECT value FROM settings WHERE key='sale_seq'").get()
    const seq = (parseInt(seqRow?.value || '0', 10)) + 1
    const year = new Date().getFullYear()
    const saleNumber = `${year}-${String(seq).padStart(4, '0')}`
    db.prepare("UPDATE settings SET value=? WHERE key='sale_seq'").run(String(seq))

    const { lastInsertRowid: saleId } = db.prepare(`
      INSERT INTO sales (client_id,total,subtotal,discount,payment_method,notes,cashbox_id,voucher_type,seller_name,sale_number)
      VALUES (?,?,?,0,?,?,?,'ticket',?,?)
    `).run(seña.client_id || null, seña.remaining, seña.remaining, paymentMethod || 'Efectivo',
           `Retiro de seña #${id}`, cashbox?.id || null, sellerName || seña.seller_name, saleNumber)

    if (seña.product_id && seña.size && seña.size !== 'N/A') {
      db.prepare(`INSERT INTO sale_items (sale_id,product_id,product_name,size,quantity,unit_price,unit_cost)
                  VALUES (?,?,?,?,1,?,0)`)
        .run(saleId, seña.product_id, seña.product_name, seña.size, seña.remaining)
    }

    db.prepare('UPDATE senas SET status=?,sale_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('retirada', saleId, id)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('UPDATE','senas',?,'Seña retirada',?)`)
      .run(id, JSON.stringify({ saleId, remaining: seña.remaining, paymentMethod }))

    return { saleId, saleNumber }
  })

  return { ok: true, ...run() }
})

ipcMain.handle('senas:cancel', (_, { id, refundAdvance }) => {
  const db = getDB()
  const seña = db.prepare('SELECT * FROM senas WHERE id=?').get(id)
  if (!seña) return { ok: false, error: 'Seña no encontrada' }
  if (seña.status !== 'pendiente') return { ok: false, error: 'La seña no está pendiente' }

  const run = db.transaction(() => {
    // Restore stock
    if (seña.product_id && seña.size && seña.size !== 'N/A') {
      db.prepare('UPDATE product_sizes SET stock=stock+1 WHERE product_id=? AND size=?').run(seña.product_id, seña.size)
    }
    db.prepare('UPDATE senas SET status=?,refunded=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run('cancelada', refundAdvance ? 1 : 0, id)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description,new_data) VALUES ('UPDATE','senas',?,'Seña cancelada',?)`)
      .run(id, JSON.stringify({ refundAdvance, advanceAmount: seña.advance_amount }))
  })

  run()
  return { ok: true }
})

// Mark overdue señas automatically
ipcMain.handle('senas:checkExpired', () => {
  const db = getDB()
  const today = new Date().toISOString().split('T')[0]
  const updated = db.prepare(`
    UPDATE senas SET status='vencida', updated_at=CURRENT_TIMESTAMP
    WHERE status='pendiente' AND deadline != '' AND deadline < ?
  `).run(today)
  return { updated: updated.changes }
})
