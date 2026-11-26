/* Promociones (v1.48.0).
 *
 * Define promos que se aplican AUTOMÁTICAMENTE en la venta. El cálculo del descuento
 * es una función pura (computeDiscount) para poder testearla sin base de datos.
 *
 * Tipos:
 *  - '2x1'          lleva 2 paga 1 (gratis el más barato de cada par)
 *  - 'nxm'          lleva N paga M (config {n, pay}); el/los más baratos van gratis
 *  - 'price_bundle' N por precio fijo (config {qty, price}) — ej: 2 por $3000
 *  - 'qty_discount' desde N unidades, % off (config {minQty, percent})
 *  - 'combo'        productos específicos juntos a precio fijo (config {productIds[], price})
 *
 * applies_to: 'all' | 'category' | 'product' (+ applies_value). El combo usa su
 * propia lista de product ids y no depende de applies_to.
 */
const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d }
function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100 }

// ¿El item entra en el alcance de la promo?
function matches(promo, it) {
  if (promo.applies_to === 'category') return String(it.category || '') === String(promo.applies_value || '')
  if (promo.applies_to === 'product') return String(it.productId ?? it.product_id) === String(promo.applies_value)
  return true // 'all'
}

// Unidades elegibles expandidas por cantidad → array de precios unitarios.
function eligibleUnits(promo, items) {
  const units = []
  for (const it of items || []) {
    if (!matches(promo, it)) continue
    const q = Math.max(0, Math.floor(num(it.quantity)))
    const price = num(it.unitPrice ?? it.unit_price)
    for (let i = 0; i < q; i++) units.push(price)
  }
  return units
}

// Descuento (>= 0) que aplica una promo a un carrito. Función PURA.
function computeDiscount(promo, items) {
  let cfg = {}
  try { cfg = typeof promo.config === 'string' ? JSON.parse(promo.config || '{}') : (promo.config || {}) } catch { cfg = {} }

  if (promo.type === '2x1') {
    const u = eligibleUnits(promo, items).sort((a, b) => a - b)
    const free = Math.floor(u.length / 2)
    let d = 0; for (let i = 0; i < free; i++) d += u[i]
    return round2(d)
  }
  if (promo.type === 'nxm') {
    const n = Math.max(2, Math.floor(num(cfg.n, 2)))
    const pay = Math.max(1, Math.floor(num(cfg.pay, 1)))
    if (pay >= n) return 0
    const u = eligibleUnits(promo, items).sort((a, b) => a - b)
    const groups = Math.floor(u.length / n)
    const freeCount = groups * (n - pay)
    let d = 0; for (let i = 0; i < freeCount; i++) d += u[i]
    return round2(d)
  }
  if (promo.type === 'price_bundle') {
    const qty = Math.max(1, Math.floor(num(cfg.qty, 2)))
    const price = num(cfg.price)
    const u = eligibleUnits(promo, items).sort((a, b) => b - a) // más caros primero
    const groups = Math.floor(u.length / qty)
    let d = 0
    for (let g = 0; g < groups; g++) {
      let sum = 0; for (let i = 0; i < qty; i++) sum += u[g * qty + i]
      d += Math.max(0, sum - price)
    }
    return round2(d)
  }
  if (promo.type === 'qty_discount') {
    const minQty = Math.max(1, Math.floor(num(cfg.minQty, 1)))
    const pct = Math.min(100, Math.max(0, num(cfg.percent)))
    const u = eligibleUnits(promo, items)
    if (u.length < minQty) return 0
    const sub = u.reduce((s, x) => s + x, 0)
    return round2(sub * pct / 100)
  }
  if (promo.type === 'combo') {
    const ids = (cfg.productIds || []).map(String)
    const price = num(cfg.price)
    if (!ids.length) return 0
    const byId = {}
    for (const it of items || []) {
      const id = String(it.productId ?? it.product_id)
      if (ids.indexOf(id) === -1) continue
      if (!byId[id]) byId[id] = { qty: 0, price: num(it.unitPrice ?? it.unit_price) }
      byId[id].qty += Math.max(0, Math.floor(num(it.quantity)))
    }
    for (const id of ids) { if (!byId[id] || byId[id].qty < 1) return 0 }
    const combos = Math.min.apply(null, ids.map(id => byId[id].qty))
    const comboFull = ids.reduce((s, id) => s + byId[id].price, 0)
    return round2(Math.max(0, combos * (comboFull - price)))
  }
  return 0
}

// ¿La promo está vigente por fecha? starts_at/ends_at son 'YYYY-MM-DD' (o vacío).
function dateValid(promo, today) {
  if (promo.starts_at && today < promo.starts_at) return false
  if (promo.ends_at && today > promo.ends_at) return false
  return true
}

// ── IPC ────────────────────────────────────────────────────────────────────────
ipcMain.handle('promotions:list', () => {
  return getDB().prepare('SELECT * FROM promotions ORDER BY active DESC, id DESC').all()
})

ipcMain.handle('promotions:create', (_, d) => {
  const cfg = typeof d.config === 'string' ? d.config : JSON.stringify(d.config || {})
  const { lastInsertRowid } = getDB().prepare(
    `INSERT INTO promotions (name, type, config, applies_to, applies_value, active, starts_at, ends_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    String(d.name || '').trim(), String(d.type || ''), cfg,
    d.applies_to || 'all', d.applies_value != null ? String(d.applies_value) : null,
    d.active ? 1 : 0, d.starts_at || null, d.ends_at || null
  )
  return { ok: true, id: lastInsertRowid }
})

ipcMain.handle('promotions:update', (_, d) => {
  const cfg = typeof d.config === 'string' ? d.config : JSON.stringify(d.config || {})
  getDB().prepare(
    `UPDATE promotions SET name=?, type=?, config=?, applies_to=?, applies_value=?, active=?, starts_at=?, ends_at=? WHERE id=?`
  ).run(
    String(d.name || '').trim(), String(d.type || ''), cfg,
    d.applies_to || 'all', d.applies_value != null ? String(d.applies_value) : null,
    d.active ? 1 : 0, d.starts_at || null, d.ends_at || null, d.id
  )
  return { ok: true }
})

ipcMain.handle('promotions:delete', (_, id) => {
  getDB().prepare('DELETE FROM promotions WHERE id=?').run(id)
  return { ok: true }
})

// Dado los items del carrito, devuelve qué promos aplican y el descuento total.
ipcMain.handle('promotions:check', (_, items) => {
  const db = getDB()
  const today = new Date().toISOString().slice(0, 10)
  // Enriquecer cada item con su categoría (el carrito no la trae) para las promos
  // con alcance por categoría.
  const enriched = (items || []).map(it => {
    if (it.category != null) return it
    const pid = it.productId ?? it.product_id
    let cat = ''
    try { cat = db.prepare('SELECT category FROM products WHERE id=?').get(pid)?.category || '' } catch {}
    return { ...it, category: cat }
  })
  const promos = db.prepare('SELECT * FROM promotions WHERE active=1').all()
  const applied = []
  let total = 0
  for (const p of promos) {
    if (!dateValid(p, today)) continue
    let d = 0
    try { d = computeDiscount(p, enriched) } catch { d = 0 }
    if (d > 0) { applied.push({ id: p.id, name: p.name, type: p.type, discount: d }); total += d }
  }
  return { promos: applied, totalDiscount: round2(total) }
})

module.exports = { computeDiscount, dateValid } // exportado para tests
