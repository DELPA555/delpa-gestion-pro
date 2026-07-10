const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')
const { fmtDateTimeAR } = require('../lib/argTime')

// ── Caja Grande (Caja Mayor) ────────────────────────────────────────────────
// Caja central acumulativa donde se deposita el efectivo de las cajas chicas.
// El saldo NUNCA se resetea. La fuente de verdad es la suma de movimientos;
// main_cashbox.balance se mantiene sincronizado como caché para lecturas rápidas.

function ensureRow(db) {
  db.prepare('INSERT OR IGNORE INTO main_cashbox (id, balance) VALUES (1, 0)').run()
}

function computeBalance(db) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE 0 END), 0) AS ingresos,
      COALESCE(SUM(CASE WHEN type='egreso'  THEN amount ELSE 0 END), 0) AS egresos
    FROM main_cashbox_movements
  `).get()
  return (row.ingresos || 0) - (row.egresos || 0)
}

function syncBalance(db) {
  const balance = computeBalance(db)
  db.prepare("UPDATE main_cashbox SET balance=?, last_updated=CURRENT_TIMESTAMP WHERE id=1").run(balance)
  return balance
}

// Dispara el email de movimiento sin bloquear la operación (fire-and-forget)
function fireMovementEmail(payload) {
  setImmediate(() => {
    try {
      const { sendMainCashboxMovementAsync } = require('./email')
      Promise.resolve(sendMainCashboxMovementAsync(payload)).catch(() => {})
    } catch {}
  })
}

// Inserta un movimiento, sincroniza el saldo, audita y (opcional) manda email.
function recordMovement(db, { type, category, amount, description, source, cashboxId, createdBy }, { email = true } = {}) {
  const balanceBefore = computeBalance(db)
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO main_cashbox_movements (type, category, amount, description, source, cashbox_id, created_by)
    VALUES (?,?,?,?,?,?,?)
  `).run(type, category || 'General', amount, description, source || 'manual', cashboxId || null, createdBy || '')
  const balanceAfter = syncBalance(db)
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES (?, 'maincashbox', ?, ?)`)
    .run(type === 'ingreso' ? 'INGRESO' : 'EGRESO', lastInsertRowid,
         `Caja Grande — ${type} ${category ? `(${category}) ` : ''}$${amount}: ${description}`)
  if (email) fireMovementEmail({ type, description, amount, balanceBefore, balanceAfter })
  return { id: lastInsertRowid, balanceBefore, balanceAfter }
}

// Transferencia AUTOMÁTICA del efectivo al cerrar una caja chica.
// Registra el ingreso en la Caja Grande (creándola si no existía) y manda el
// email específico de transferencia. Se llama desde cashbox:close.
function transferCashboxClose(db, { cashboxId, amount, shift, createdBy }) {
  ensureRow(db)
  const shiftLabel = shift || `#${cashboxId}`
  const desc = `Cierre automático caja ${shiftLabel} — ${fmtDateTimeAR(new Date())}`
  const res = recordMovement(db, {
    type: 'ingreso',
    category: 'caja_chica',
    amount,
    description: desc,
    source: 'caja_chica',
    cashboxId,
    createdBy,
  }, { email: false })   // el email genérico se reemplaza por el de transferencia
  setImmediate(() => {
    try {
      const { sendMainCashboxTransferAsync } = require('./email')
      Promise.resolve(sendMainCashboxTransferAsync({
        shift, amount, balanceBefore: res.balanceBefore, balanceAfter: res.balanceAfter,
      })).catch(() => {})
    } catch {}
  })
  return res
}

// Saldo actual + desglose
ipcMain.handle('maincashbox:balance', () => {
  const db = getDB()
  ensureRow(db)
  const balance = syncBalance(db)
  const d = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='ingreso' AND source='caja_chica' THEN amount ELSE 0 END), 0) AS ingresosCajaChica,
      COALESCE(SUM(CASE WHEN type='ingreso' AND source!='caja_chica' THEN amount ELSE 0 END), 0) AS ingresosManual,
      COALESCE(SUM(CASE WHEN type='egreso' THEN amount ELSE 0 END), 0) AS egresosManual,
      COUNT(*) AS totalMovimientos
    FROM main_cashbox_movements
  `).get()
  const meta = db.prepare('SELECT last_updated FROM main_cashbox WHERE id=1').get()
  const opening = db.prepare("SELECT * FROM main_cashbox_openings WHERE status='open' ORDER BY id DESC LIMIT 1").get() || null
  return {
    balance,
    ingresosCajaChica: d.ingresosCajaChica || 0,
    ingresosManual:    d.ingresosManual || 0,
    egresosManual:     d.egresosManual || 0,
    totalMovimientos:  d.totalMovimientos || 0,
    lastUpdated:       meta?.last_updated || null,
    opening,   // sesión de apertura activa (o null)
  }
})

// Historial de movimientos con filtros opcionales por fecha (YYYY-MM-DD)
ipcMain.handle('maincashbox:movements', (_, { from, to, limit } = {}) => {
  const db = getDB()
  const where = []
  const params = []
  if (from) { where.push('date(created_at) >= date(?)'); params.push(from) }
  if (to)   { where.push('date(created_at) <= date(?)'); params.push(to) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const lim = limit ? ' LIMIT ?' : ''
  if (limit) params.push(Number(limit))
  return db.prepare(`
    SELECT m.*, c.shift AS cashbox_shift
    FROM main_cashbox_movements m
    LEFT JOIN cashbox c ON c.id = m.cashbox_id
    ${whereSql}
    ORDER BY m.created_at DESC, m.id DESC${lim}
  `).all(...params)
})

// Alta de movimiento manual (ingreso o egreso)
ipcMain.handle('maincashbox:addMovement', (_, { type, category, amount, description, createdBy } = {}) => {
  if (type !== 'ingreso' && type !== 'egreso') throw new Error('Tipo inválido')
  const amt = Number(amount)
  if (!amt || amt <= 0) throw new Error('El monto debe ser mayor a cero')
  if (!description || !String(description).trim()) throw new Error('El concepto es obligatorio')
  const db = getDB()
  ensureRow(db)
  const tx = db.transaction(() =>
    recordMovement(db, { type, category: category || 'General', amount: amt, description: String(description).trim(), source: 'manual', createdBy })
  )
  const res = tx()
  return { id: res.id, balance: res.balanceAfter }
})

// Transferencia de efectivo desde una caja chica al cerrar
ipcMain.handle('maincashbox:transfer', (_, { cashboxId, amount, description, createdBy } = {}) => {
  const amt = Number(amount)
  if (!amt || amt <= 0) throw new Error('El monto a transferir debe ser mayor a cero')
  const db = getDB()
  ensureRow(db)
  const cb = cashboxId ? db.prepare('SELECT * FROM cashbox WHERE id=?').get(cashboxId) : null
  const desc = description && String(description).trim()
    ? String(description).trim()
    : cb
      ? `Cierre caja ${cb.shift || `#${cb.id}`} — ${new Date(cb.closed_at || Date.now()).toLocaleDateString('es-AR')}`
      : 'Transferencia desde caja chica'
  const tx = db.transaction(() =>
    recordMovement(db, { type: 'ingreso', category: 'Cierre de caja', amount: amt, description: desc, source: 'caja_chica', cashboxId: cashboxId || null, createdBy })
  )
  const res = tx()
  return { id: res.id, balance: res.balanceAfter }
})

// Arqueo de Caja Grande — compara efectivo físico contado vs saldo esperado
ipcMain.handle('maincashbox:audit', (_, { countedAmount, notes, createdBy } = {}) => {
  const counted = Number(countedAmount)
  if (isNaN(counted)) throw new Error('Ingresá el efectivo contado')
  const db = getDB()
  ensureRow(db)
  const expected = syncBalance(db)
  const difference = counted - expected
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO main_cashbox_audits (expected_balance, counted_amount, difference, notes, created_by)
    VALUES (?,?,?,?,?)
  `).run(expected, counted, difference, notes || '', createdBy || '')
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('AUDIT','maincashbox',?,?)`)
    .run(lastInsertRowid, `Arqueo Caja Grande. Esperado: $${expected.toFixed(2)}, Contado: $${counted.toFixed(2)}, Diferencia: $${difference.toFixed(2)}`)
  return { id: lastInsertRowid, expected, counted, difference }
})

// Historial de arqueos
ipcMain.handle('maincashbox:audits', (_, { limit = 50 } = {}) =>
  getDB().prepare('SELECT * FROM main_cashbox_audits ORDER BY created_at DESC LIMIT ?').all(Number(limit))
)

// Apertura de Caja Grande con recuento físico inicial
ipcMain.handle('maincashbox:open', (_, { countedAmount, notes, createdBy } = {}) => {
  const counted = Number(countedAmount)
  if (isNaN(counted)) throw new Error('Ingresá el saldo físico contado')
  const db = getDB()
  ensureRow(db)
  const existing = db.prepare("SELECT id FROM main_cashbox_openings WHERE status='open' ORDER BY id DESC LIMIT 1").get()
  if (existing) throw new Error('Ya hay una apertura de Caja Grande activa. Cerrala antes de abrir otra.')
  const expected = syncBalance(db)
  const difference = counted - expected
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO main_cashbox_openings (opening_balance_expected, opening_balance_real, opening_difference, notes, status, opened_by)
    VALUES (?,?,?,?, 'open', ?)
  `).run(expected, counted, difference, notes || '', createdBy || '')
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('OPEN','maincashbox',?,?)`)
    .run(lastInsertRowid, `Apertura Caja Grande. Esperado: $${expected.toFixed(2)}, Contado: $${counted.toFixed(2)}, Diferencia: $${difference.toFixed(2)}`)
  return { id: lastInsertRowid, expected, counted, difference }
})

// Cierre de Caja Grande
ipcMain.handle('maincashbox:close', (_, { countedAmount, notes, createdBy } = {}) => {
  const counted = Number(countedAmount)
  if (isNaN(counted)) throw new Error('Ingresá el saldo físico contado')
  const db = getDB()
  ensureRow(db)
  const opening = db.prepare("SELECT * FROM main_cashbox_openings WHERE status='open' ORDER BY id DESC LIMIT 1").get()
  if (!opening) throw new Error('No hay una apertura de Caja Grande activa para cerrar')

  const tx = db.transaction(() => {
    const expected = syncBalance(db)
    const difference = counted - expected
    // Si hay diferencia, registrar movimiento de ajuste para que el saldo refleje el conteo físico
    if (difference !== 0) {
      recordMovement(db, {
        type: difference > 0 ? 'ingreso' : 'egreso',
        category: 'Ajuste de cierre',
        amount: Math.abs(difference),
        description: `Ajuste por diferencia en cierre de Caja Grande (${difference > 0 ? 'sobrante' : 'faltante'})`,
        source: 'manual',
        createdBy,
      }, { email: false })
    }
    db.prepare(`
      UPDATE main_cashbox_openings
      SET closed_at=CURRENT_TIMESTAMP, closing_balance_expected=?, closing_balance_real=?,
          closing_difference=?, notes=?, status='closed', closed_by=?
      WHERE id=?
    `).run(expected, counted, difference, notes || opening.notes || '', createdBy || '', opening.id)
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('CLOSE','maincashbox',?,?)`)
      .run(opening.id, `Cierre Caja Grande. Esperado: $${expected.toFixed(2)}, Contado: $${counted.toFixed(2)}, Diferencia: $${difference.toFixed(2)}`)
    return { expected, difference }
  })
  const { expected, difference } = tx()

  // Email de cierre con resumen del período (fire-and-forget)
  setImmediate(() => {
    try {
      const closed = db.prepare('SELECT * FROM main_cashbox_openings WHERE id=?').get(opening.id)
      const movs = db.prepare(`
        SELECT * FROM main_cashbox_movements
        WHERE created_at >= ? AND created_at <= COALESCE(?, CURRENT_TIMESTAMP)
        ORDER BY created_at ASC, id ASC
      `).all(opening.opened_at, closed.closed_at)
      const { sendMainCashboxClosingAsync } = require('./email')
      Promise.resolve(sendMainCashboxClosingAsync(closed, movs)).catch(() => {})
    } catch {}
  })

  return { id: opening.id, expected, counted, difference, balance: syncBalance(db) }
})

// Historial de aperturas y cierres
ipcMain.handle('maincashbox:sessions', (_, { limit = 50 } = {}) =>
  getDB().prepare('SELECT * FROM main_cashbox_openings ORDER BY opened_at DESC LIMIT ?').all(Number(limit))
)

// Resumen mensual + comparativa mes a mes (últimos N meses)
ipcMain.handle('maincashbox:monthlySummary', (_, { months = 6 } = {}) => {
  const db = getDB()
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
      COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE 0 END), 0) AS ingresos,
      COALESCE(SUM(CASE WHEN type='egreso'  THEN amount ELSE 0 END), 0) AS egresos
    FROM main_cashbox_movements
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `).all(Number(months))
  return rows.map(r => ({ ...r, saldo: (r.ingresos || 0) - (r.egresos || 0) })).reverse()
})

// Datos completos para exportar informe/PDF
ipcMain.handle('maincashbox:report', (_, { from, to } = {}) => {
  const db = getDB()
  ensureRow(db)
  const where = []
  const params = []
  if (from) { where.push('date(created_at) >= date(?)'); params.push(from) }
  if (to)   { where.push('date(created_at) <= date(?)'); params.push(to) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const movements = db.prepare(`
    SELECT m.*, c.shift AS cashbox_shift
    FROM main_cashbox_movements m
    LEFT JOIN cashbox c ON c.id = m.cashbox_id
    ${whereSql}
    ORDER BY m.created_at ASC, m.id ASC
  `).all(...params)
  const totalIngresos = movements.filter(m => m.type === 'ingreso').reduce((s, m) => s + m.amount, 0)
  const totalEgresos  = movements.filter(m => m.type === 'egreso').reduce((s, m) => s + m.amount, 0)
  const balance = syncBalance(db)
  return { movements, totalIngresos, totalEgresos, periodBalance: totalIngresos - totalEgresos, balance }
})

module.exports = { transferCashboxClose }
