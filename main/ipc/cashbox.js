const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// Returns sales totals grouped by payment method, handling both single-payment (old)
// and multi-payment (sale_payments table) sales transparently.
function getSalesByMethod(db, cashboxId) {
  const fromPayments = db.prepare(`
    SELECT sp.payment_method, SUM(sp.final_amount) as total, COUNT(*) as count
    FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id
    WHERE s.cashbox_id=? AND s.voided=0
    GROUP BY sp.payment_method
  `).all(cashboxId)
  const fromSales = db.prepare(`
    SELECT s.payment_method, SUM(s.total) as total, COUNT(*) as count
    FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id=s.id
    WHERE s.cashbox_id=? AND s.voided=0 AND sp.id IS NULL
    GROUP BY s.payment_method
  `).all(cashboxId)
  const merged = {}
  for (const row of [...fromPayments, ...fromSales]) {
    if (!merged[row.payment_method]) merged[row.payment_method] = { payment_method: row.payment_method, total: 0, count: 0 }
    merged[row.payment_method].total += row.total
    merged[row.payment_method].count += row.count
  }
  return Object.values(merged).sort((a, b) => b.total - a.total)
}

function getCashSales(db, cashboxId) {
  const fromPayments = db.prepare(`
    SELECT COALESCE(SUM(sp.final_amount),0) as total
    FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id
    WHERE s.cashbox_id=? AND s.voided=0 AND sp.payment_method='Efectivo'
  `).get(cashboxId)
  const fromSales = db.prepare(`
    SELECT COALESCE(SUM(s.total),0) as total
    FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id=s.id
    WHERE s.cashbox_id=? AND s.voided=0 AND s.payment_method='Efectivo' AND sp.id IS NULL
  `).get(cashboxId)
  return fromPayments.total + fromSales.total
}

ipcMain.handle('cashbox:movements', (_, cashboxId) => {
  const db = getDB()
  const sales = db.prepare(`
    SELECT s.id as sale_id, s.total as amount, s.payment_method, s.created_at,
           s.seller_name, c.name as client_name, 'venta' as concept, 'ingreso' as type
    FROM sales s LEFT JOIN clients c ON c.id=s.client_id
    WHERE s.cashbox_id=? AND s.voided=0
  `).all(cashboxId)
  const manual = db.prepare(`
    SELECT id, null as sale_id, amount, payment_method, created_at, null as seller_name,
           null as client_name, concept, type
    FROM cashbox_movements WHERE cashbox_id=?
  `).all(cashboxId)
  const expenses = db.prepare(`
    SELECT id, null as sale_id, amount, payment_method, created_at, null as seller_name,
           null as client_name, concept, 'egreso' as type
    FROM expenses WHERE cashbox_id=?
  `).all(cashboxId)
  const all = [...sales, ...manual, ...expenses]
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return all
})

ipcMain.handle('cashbox:addMovement', (_, { cashboxId, type, concept, amount, paymentMethod }) => {
  const db = getDB()
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO cashbox_movements (cashbox_id,type,concept,amount,payment_method) VALUES (?,?,?,?,?)'
  ).run(cashboxId, type, concept, Math.abs(amount), paymentMethod || 'Efectivo')
  return lastInsertRowid
})

ipcMain.handle('cashbox:current', () =>
  getDB().prepare("SELECT * FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get() || null
)

ipcMain.handle('cashbox:open', (_, { openingCash, notes, shift }) => {
  const db = getDB()
  if (db.prepare("SELECT id FROM cashbox WHERE status='open'").get())
    throw new Error('Ya hay una caja abierta')
  const { lastInsertRowid: id } = db.prepare('INSERT INTO cashbox (opening_cash,notes,shift) VALUES (?,?,?)').run(openingCash || 0, notes || '', shift || '')
  const shiftInfo = shift ? ` (turno: ${shift})` : ''
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('OPEN','cashbox',?,?)`).run(id, `Caja abierta con $${openingCash || 0}${shiftInfo}`)
  return id
})

ipcMain.handle('cashbox:summary', (_, cashboxId) => {
  const db = getDB()
  const cashbox = db.prepare('SELECT * FROM cashbox WHERE id=?').get(cashboxId)
  const byMethod = getSalesByMethod(db, cashboxId)
  const expenses = db.prepare("SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count FROM expenses WHERE cashbox_id=?").get(cashboxId)
  const totalSales = byMethod.reduce((s, m) => s + m.total, 0)
  const cashSales = getCashSales(db, cashboxId)
  const manualIn  = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM cashbox_movements WHERE cashbox_id=? AND type='ingreso'").get(cashboxId).total
  const manualOut = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM cashbox_movements WHERE cashbox_id=? AND type='egreso'").get(cashboxId).total
  const cashManualIn  = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM cashbox_movements WHERE cashbox_id=? AND type='ingreso' AND payment_method='Efectivo'").get(cashboxId).total
  const cashManualOut = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM cashbox_movements WHERE cashbox_id=? AND type='egreso' AND payment_method='Efectivo'").get(cashboxId).total
  return {
    cashbox,
    byMethod,
    expenses,
    manualIngresos: manualIn,
    manualEgresos:  manualOut,
    totalSales,
    expectedCash: (cashbox?.opening_cash || 0) + cashSales + cashManualIn - cashManualOut - (expenses?.total || 0),
  }
})

ipcMain.handle('cashbox:close', async (_, { cashboxId, realCash, notes, paymentCounts }) => {
  const db = getDB()
  const cashbox = db.prepare('SELECT * FROM cashbox WHERE id=?').get(cashboxId)
  if (!cashbox) throw new Error('Caja no encontrada')
  const cashTotal = getCashSales(db, cashboxId)
  const expenses = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE cashbox_id=?").get(cashboxId)
  const cashManualIn  = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM cashbox_movements WHERE cashbox_id=? AND type='ingreso' AND payment_method='Efectivo'").get(cashboxId).total
  const cashManualOut = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM cashbox_movements WHERE cashbox_id=? AND type='egreso' AND payment_method='Efectivo'").get(cashboxId).total
  const expected = cashbox.opening_cash + cashTotal + cashManualIn - cashManualOut - expenses.total
  const effectiveRealCash = realCash != null ? Number(realCash) : expected
  const diff = effectiveRealCash - expected
  const countsJson = paymentCounts ? JSON.stringify(paymentCounts) : '{}'
  db.prepare("UPDATE cashbox SET real_cash=?,closing_cash=?,difference=?,status='closed',closed_at=CURRENT_TIMESTAMP,notes=?,payment_counts_json=? WHERE id=?")
    .run(effectiveRealCash, expected, diff, notes || '', countsJson, cashboxId)
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('CLOSE','cashbox',?,?)`).run(cashboxId, `Caja cerrada. Efectivo real: $${effectiveRealCash}, Diferencia: $${diff.toFixed(2)}`)
  try { const { sendCashboxReport } = require('./email'); await sendCashboxReport(cashboxId) } catch {}
  return { expectedCash: expected, difference: diff }
})

ipcMain.handle('cashbox:report', (_, cashboxId) => {
  const db = getDB()
  const cashbox = db.prepare('SELECT * FROM cashbox WHERE id=?').get(cashboxId)
  if (!cashbox) return null
  const byMethod = getSalesByMethod(db, cashboxId)
  const voidedSales = db.prepare(`
    SELECT s.id, s.sale_number, s.total, s.created_at, s.void_reason, c.name as client_name
    FROM sales s LEFT JOIN clients c ON c.id=s.client_id
    WHERE s.cashbox_id=? AND s.voided=1
  `).all(cashboxId)
  const allSales = db.prepare(`
    SELECT s.id, s.sale_number, s.total, s.created_at, s.payment_method, s.installments,
           c.name as client_name, s.seller_name
    FROM sales s LEFT JOIN clients c ON c.id=s.client_id
    WHERE s.cashbox_id=? AND s.voided=0 ORDER BY s.created_at ASC
  `).all(cashboxId)
  const getItems = db.prepare('SELECT product_name, size, quantity, unit_price FROM sale_items WHERE sale_id=?')
  const getPayments = db.prepare('SELECT payment_method, final_amount, installments FROM sale_payments WHERE sale_id=? ORDER BY id ASC')
  for (const sale of allSales) {
    sale.items = getItems.all(sale.id)
    sale.payments = getPayments.all(sale.id)
  }
  const expenses = db.prepare('SELECT * FROM expenses WHERE cashbox_id=? ORDER BY created_at ASC').all(cashboxId)
  const manualMovements = db.prepare('SELECT * FROM cashbox_movements WHERE cashbox_id=? ORDER BY created_at ASC').all(cashboxId)
  const totalSales = byMethod.reduce((s, m) => s + m.total, 0)
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const totalManualIngresos = manualMovements.filter(m => m.type === 'ingreso').reduce((s, m) => s + m.amount, 0)
  const totalManualEgresos  = manualMovements.filter(m => m.type === 'egreso').reduce((s, m) => s + m.amount, 0)
  const cashSales = getCashSales(db, cashboxId)
  const cashManualIn  = manualMovements.filter(m => m.type === 'ingreso' && m.payment_method === 'Efectivo').reduce((s, m) => s + m.amount, 0)
  const cashManualOut = manualMovements.filter(m => m.type === 'egreso'  && m.payment_method === 'Efectivo').reduce((s, m) => s + m.amount, 0)
  const expectedCash = cashbox.opening_cash + cashSales + cashManualIn - cashManualOut - totalExpenses
  let paymentCounts = {}
  try { paymentCounts = JSON.parse(cashbox.payment_counts_json || '{}') } catch {}
  return { cashbox, byMethod, allSales, voidedSales, expenses, manualMovements, totalSales, totalExpenses, totalManualIngresos, totalManualEgresos, expectedCash, paymentCounts }
})

ipcMain.handle('cashbox:history', (_, { page = 1, limit = 20 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const { count } = db.prepare('SELECT COUNT(*) as count FROM cashbox').get()
  const rows = db.prepare('SELECT * FROM cashbox ORDER BY opened_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  return { cashboxes: rows, total: count, pages: Math.ceil(count / limit) }
})
