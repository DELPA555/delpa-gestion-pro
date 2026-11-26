/* Ping al servidor central del Portal web (v1.49.0).
 *
 * Además del ping al Apps Script (ver distributorPing.js), cada instalación avisa al
 * servidor central (VPS) para tener una URL FIJA por negocio:
 *   https://portal.delpagestion.com.ar/portal/<slug>
 *
 * Solo se envía si el negocio configuró un PIN de portal (setting portal_pin): sin PIN
 * no hay portal, así que no mandamos datos. El ping va cada 15 min (lo dispara
 * distributorPing). Si falla, se ignora en silencio (nunca rompe nada).
 *
 * Seguridad: se autentica con un secreto compartido embebido (header X-Delpa-Secret),
 * igual criterio que el token de multi-caja. El PIN viaja por HTTPS y el servidor lo
 * guarda hasheado.
 */
const https = require('https')

const CENTRAL_BASE = 'https://portal.delpagestion.com.ar'
const CENTRAL_URL = CENTRAL_BASE + '/ping'
// Mismo valor que PING_SECRET en tools/portal-server/deploy.sh.
const PING_SECRET = '0822e42fa23b4f9dd3b79afb29d3a4a4b8489b7709c46276'

function getSetting(db, key) {
  try { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '' } catch { return '' }
}

// Ventas del día (total facturado, sin anuladas) y efectivo en la caja abierta.
function computeVentasCaja(db) {
  let ventasHoy = 0, cajaHoy = 0, ventaMaxHoy = 0
  try {
    const r = db.prepare(
      "SELECT COALESCE(SUM(total),0) t, COALESCE(MAX(total),0) m FROM sales WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime')"
    ).get()
    ventasHoy = r.t || 0
    ventaMaxHoy = r.m || 0
  } catch {}
  try {
    const cb = db.prepare("SELECT id, opening_cash FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()
    if (cb) {
      const mov = db.prepare(
        "SELECT COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END),0) n FROM cashbox_movements WHERE cashbox_id=?"
      ).get(cb.id)
      cajaHoy = (Number(cb.opening_cash) || 0) + (Number(mov.n) || 0)
    }
  } catch {}
  return { ventasHoy, cajaHoy, ventaMaxHoy }
}

// Envía el ping al servidor central. base = { hwid, businessName, cuit, networkCode, branchName, version, stockSnapshot }.
function pingCentralPortal(db, base) {
  try {
    const pin = getSetting(db, 'portal_pin').trim()
    if (!pin) return // sin portal configurado → no registrar ni enviar datos

    const { ventasHoy, cajaHoy, ventaMaxHoy } = computeVentasCaja(db)
    let alerts = {}
    try { alerts = JSON.parse(getSetting(db, 'portal_alerts') || '{}') } catch {}
    const payload = {
      hwid: base.hwid,
      businessName: base.businessName || '',
      cuit: base.cuit || '',
      networkCode: base.networkCode || '',
      branchName: base.branchName || '',
      stockSnapshot: base.stockSnapshot || [],
      ventasHoy, cajaHoy, ventaMaxHoy,
      version: base.version || '',
      pin,
      // Config de alertas por email (se configura en Ajustes → Portal web).
      alertEmail: getSetting(db, 'portal_alert_email').trim(),
      ventaThreshold: Number(getSetting(db, 'portal_venta_threshold')) || 50000,
      alerts,
    }
    const body = JSON.stringify(payload)
    const u = new URL(CENTRAL_URL)
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Delpa-Secret': PING_SECRET,
      },
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const j = JSON.parse(data || '{}')
          if (j && j.slug) {
            // Guardar el slug y la URL fija para mostrarlos en Ajustes → Portal web.
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('portal_central_slug',?)").run(String(j.slug))
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('portal_central_url',?)").run(String(j.url || ('https://portal.delpagestion.com.ar/portal/' + j.slug)))
            console.log('[portal] ping OK — slug=' + j.slug)
          } else {
            console.error('[portal] ping sin slug (HTTP ' + res.statusCode + '): ' + String(data).slice(0, 200))
          }
        } catch (e) {
          console.error('[portal] ping respuesta inválida (HTTP ' + res.statusCode + '): ' + e.message)
        }
      })
    })
    req.on('timeout', () => { console.error('[portal] ping timeout (VPS no respondió en 15s)'); req.destroy() })
    req.on('error', (e) => { console.error('[portal] ping error de red: ' + (e && e.message || e) + ' (¿servidor desplegado? ¿DNS/SSL ok?)') })
    req.write(body)
    req.end()
  } catch (e) { try { console.error('[portal] pingCentralPortal:', e.message) } catch {} }
}

// Reúne los datos del local y pinguea el servidor central YA (no espera a los 15 min).
// Se llama al guardar el PIN del portal, para que el enlace permanente aparezca enseguida.
function pingNow(db) {
  try {
    let hwid = ''
    try { hwid = String(require('../ipc/license').getHardwareId() || '') } catch {}
    const businessName = getSetting(db, 'business_name').trim()
    let stockSnapshot = []
    try { stockSnapshot = require('./distributorPing').buildStockSnapshot(db) } catch {}
    let version = '1.0.0'
    try { version = require('../../package.json').version || version } catch {}
    pingCentralPortal(db, {
      hwid, businessName,
      cuit: getSetting(db, 'business_cuit').trim(),
      networkCode: getSetting(db, 'network_code').trim(),
      branchName: getSetting(db, 'branch_name').trim() || businessName,
      version, stockSnapshot,
    })
  } catch (e) { try { console.error('[portal] pingNow:', e.message) } catch {} }
}

// POST JSON autenticado al VPS.
function postJson(pathUrl, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const u = new URL(CENTRAL_BASE + pathUrl)
    const data = Buffer.from(JSON.stringify(body), 'utf8')
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'X-Delpa-Secret': PING_SECRET },
    }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => { (res.statusCode >= 200 && res.statusCode < 300) ? resolve(d ? JSON.parse(d) : {}) : reject(new Error('HTTP ' + res.statusCode)) })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.write(data); req.end()
  })
}

// Stock local en formato plano para los endpoints de red del VPS.
function buildFlatStock(db) {
  try {
    return db.prepare(`
      SELECT p.barcode AS codigo, p.name AS nombre, ps.size AS talle, p.color AS color, ps.stock AS cantidad
      FROM products p JOIN product_sizes ps ON ps.product_id = p.id
      WHERE p.active = 1 AND ps.stock > 0
    `).all().map(r => ({ codigo: r.codigo || '', nombre: r.nombre || '', talle: r.talle || '', color: r.color || '', cantidad: Number(r.cantidad) || 0 }))
  } catch { return [] }
}

// Sube el stock de este local al VPS (si hay código de red). Devuelve Promise<{ok}>.
function syncRedStock(db) {
  try {
    const code = getSetting(db, 'network_code').trim()
    if (!code) return Promise.resolve({ ok: false, error: 'sin código de red' })
    const branchName = getSetting(db, 'branch_name').trim() || getSetting(db, 'business_name').trim()
    let hwid = ''
    try { hwid = String(require('../ipc/license').getHardwareId() || '') } catch {}
    return postJson('/red/stock/' + encodeURIComponent(code), { hwid, branchName, stock: buildFlatStock(db) })
      .then(() => ({ ok: true })).catch(e => ({ ok: false, error: e.message }))
  } catch (e) { return Promise.resolve({ ok: false, error: e.message }) }
}

// Sube los precios de este local al VPS (si hay código de red). Devuelve Promise<{ok}>.
function syncRedPrecios(db) {
  try {
    const code = getSetting(db, 'network_code').trim()
    if (!code) return Promise.resolve({ ok: false, error: 'sin código de red' })
    let hwid = '', precios = []
    try { hwid = String(require('../ipc/license').getHardwareId() || '') } catch {}
    try {
      precios = db.prepare(`SELECT barcode AS codigo, price AS precio, COALESCE(price_wholesale,0) AS precioLista
        FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>''`).all()
    } catch {}
    return postJson('/red/precios/' + encodeURIComponent(code), { hwid, precios })
      .then(() => ({ ok: true })).catch(e => ({ ok: false, error: e.message }))
  } catch (e) { return Promise.resolve({ ok: false, error: e.message }) }
}

module.exports = { pingCentralPortal, pingNow, PING_SECRET, CENTRAL_BASE, syncRedStock, syncRedPrecios }
