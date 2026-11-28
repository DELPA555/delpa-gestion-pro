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

// Ventas del día agrupadas por medio de pago (v3.2.0), split-aware (contempla
// sale_payments igual que el resto de la app). Devuelve { efectivo, tarjeta, otros }.
// Si no hay ventas con medio de pago, cae a { efectivo: cajaHoy, tarjeta: 0, otros: 0 }.
function computeMediosPago(db, cajaHoy) {
  const fallback = { efectivo: Number(cajaHoy) || 0, tarjeta: 0, otros: 0 }
  try {
    const hoy = "date(created_at,'localtime')=date('now','localtime')"
    // Pagos split (sale_payments) + ventas sin split (payment_method de la venta).
    const rows = db.prepare(
      "SELECT pm, SUM(monto) t FROM (" +
      "  SELECT sp.payment_method pm, sp.final_amount monto FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id WHERE s.voided=0 AND " + hoy.replace(/created_at/g, 's.created_at') +
      "  UNION ALL " +
      "  SELECT s.payment_method pm, s.total monto FROM sales s LEFT JOIN sale_payments sp ON sp.sale_id=s.id WHERE s.voided=0 AND sp.id IS NULL AND " + hoy.replace(/created_at/g, 's.created_at') +
      ") GROUP BY pm"
    ).all()
    if (!rows.length) return fallback
    let efectivo = 0, tarjeta = 0, otros = 0
    for (const r of rows) {
      const pm = String(r.pm || '').toLowerCase()
      const amt = Number(r.t) || 0
      if (/efectivo/.test(pm)) efectivo += amt
      else if (/tarjeta|d[eé]bito|cr[eé]dito|visa|master|posnet/.test(pm)) tarjeta += amt
      else otros += amt
    }
    if (efectivo === 0 && tarjeta === 0 && otros === 0) return fallback
    return { efectivo, tarjeta, otros }
  } catch { return fallback }
}

// Licencia local del cliente (si activó un código): para importarla al VPS la 1ª vez.
// Key real en settings: 'license_expiry' = YYYYMMDD (la fija license:activate).
function localLicenseForPing(db) {
  try {
    const exp = getSetting(db, 'license_expiry').trim()
    if (/^\d{8}$/.test(exp)) {
      const iso = exp.slice(0, 4) + '-' + exp.slice(4, 6) + '-' + exp.slice(6, 8) + 'T23:59:59.000Z'
      return { licenseExpires: iso, licensePlan: getSetting(db, 'license_plan').trim() }
    }
  } catch {}
  return { licenseExpires: '', licensePlan: '' }
}

// Ping MÍNIMO de registro/licencia: va SIEMPRE (haya o no PIN de portal), para que el
// cliente registre su hwid y el VPS pueda importar su licencia local la 1ª vez. NO envía
// stock/ventas/caja (el server conserva lo que ya había). Devuelve Promise<{ok}> (nunca rechaza).
function pingForLicense(db) {
  return new Promise((resolve) => {
    try {
      let hwid = ''
      try { hwid = String(require('../ipc/license').getHardwareId() || '') } catch {}
      if (!hwid) return resolve({ ok: false, error: 'sin hwid' })
      let version = '1.0.0'
      try { version = require('../../package.json').version || version } catch {}
      const lic = localLicenseForPing(db)
      const payload = {
        hwid,
        businessName: getSetting(db, 'business_name').trim(),
        version,
        licenseExpires: lic.licenseExpires,
        licensePlan: lic.licensePlan,
      }
      const body = JSON.stringify(payload)
      const u = new URL(CENTRAL_URL)
      console.log('[licencia] ping registro → POST ' + CENTRAL_URL + ' | hwid=' + hwid.slice(0, 10) +
        ' | negocio="' + payload.businessName + '" | licExpira=' + (payload.licenseExpires || '—'))
      const req = https.request({
        hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 5000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Delpa-Secret': PING_SECRET },
      }, (res) => { res.on('data', () => {}); res.on('end', () => { const ok = res.statusCode >= 200 && res.statusCode < 300; console.log('[licencia] ping registro ' + (ok ? 'OK' : 'FALLÓ') + ' (HTTP ' + res.statusCode + ')'); resolve({ ok }) }) })
      req.on('timeout', () => { console.error('[licencia] ping registro TIMEOUT (5s) — ' + CENTRAL_URL); req.destroy(); resolve({ ok: false, error: 'timeout' }) })
      req.on('error', (e) => { console.error('[licencia] ping registro ERROR de red: ' + (e && e.message) + ' → ' + CENTRAL_URL); resolve({ ok: false, error: e && e.message }) })
      req.write(body); req.end()
    } catch (e) { console.error('[licencia] pingForLicense EXCEPCIÓN: ' + (e && e.message)); resolve({ ok: false, error: e && e.message }) }
  })
}

// Envía el ping al servidor central. base = { hwid, businessName, cuit, networkCode, branchName, version, stockSnapshot }.
// Devuelve Promise<{ok, slug?, url?, error?, status?, skipped?}> con el resultado REAL del
// ping (para poder mostrarlo en Ajustes). Nunca rechaza. Loguea URL/body/hwid/error completo.
function pingCentralPortal(db, base) {
 return new Promise((resolve) => {
  try {
    const pin = getSetting(db, 'portal_pin').trim()
    if (!pin) {
      console.warn('[portal] ping OMITIDO: no hay PIN de portal configurado (portal_pin vacío). Sin PIN no se envía nada al servidor central.')
      return resolve({ ok: false, skipped: true, error: 'Sin PIN de portal configurado' })
    }

    const { ventasHoy, cajaHoy, ventaMaxHoy } = computeVentasCaja(db)
    const mediosPago = computeMediosPago(db, cajaHoy)
    let alerts = {}
    try { alerts = JSON.parse(getSetting(db, 'portal_alerts') || '{}') } catch {}
    const lic = localLicenseForPing(db)
    const payload = {
      hwid: base.hwid,
      businessName: base.businessName || '',
      cuit: base.cuit || '',
      networkCode: base.networkCode || '',
      branchName: base.branchName || '',
      stockSnapshot: base.stockSnapshot || [],
      ventasHoy, cajaHoy, ventaMaxHoy,
      mediosPago,
      version: base.version || '',
      pin,
      // Config de alertas por email (se configura en Ajustes → Portal web).
      alertEmail: getSetting(db, 'portal_alert_email').trim(),
      ventaThreshold: Number(getSetting(db, 'portal_venta_threshold')) || 50000,
      alerts,
      // Licencia local (para importarla al VPS la primera vez) — v1.54.1.
      licenseExpires: lic.licenseExpires,
      licensePlan: lic.licensePlan,
    }
    const body = JSON.stringify(payload)
    const u = new URL(CENTRAL_URL)
    console.log('[portal] ping → POST ' + CENTRAL_URL + ' | hwid=' + String(base.hwid || '').slice(0, 10) +
      ' | negocio="' + (base.businessName || '') + '" | bytes=' + Buffer.byteLength(body) +
      ' | secreto=' + (PING_SECRET ? PING_SECRET.slice(0, 6) + '…(' + PING_SECRET.length + ')' : 'VACÍO'))
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
            console.log('[portal] ping OK (HTTP ' + res.statusCode + ') — slug=' + j.slug)
            resolve({ ok: true, status: res.statusCode, slug: j.slug, url: j.url })
          } else {
            console.error('[portal] ping SIN slug (HTTP ' + res.statusCode + '): ' + String(data).slice(0, 300))
            resolve({ ok: false, status: res.statusCode, error: 'Respuesta sin slug: ' + String(data).slice(0, 200) })
          }
        } catch (e) {
          console.error('[portal] ping respuesta inválida (HTTP ' + res.statusCode + '): ' + e.message + ' | body=' + String(data).slice(0, 200))
          resolve({ ok: false, status: res.statusCode, error: 'Respuesta inválida (HTTP ' + res.statusCode + '): ' + e.message })
        }
      })
    })
    req.on('timeout', () => { console.error('[portal] ping TIMEOUT (VPS no respondió en 15s) — ' + CENTRAL_URL); req.destroy(); resolve({ ok: false, error: 'timeout (15s sin respuesta de ' + CENTRAL_URL + ')' }) })
    req.on('error', (e) => { console.error('[portal] ping ERROR de red: ' + (e && e.message || e) + ' → ' + CENTRAL_URL + ' (¿DNS/SSL/firewall?)'); resolve({ ok: false, error: 'Error de red: ' + (e && e.message || String(e)) }) })
    req.write(body)
    req.end()
  } catch (e) { try { console.error('[portal] pingCentralPortal EXCEPCIÓN:', e.message) } catch {}; resolve({ ok: false, error: 'Excepción: ' + (e && e.message) }) }
 })
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
    return pingCentralPortal(db, {
      hwid, businessName,
      cuit: getSetting(db, 'business_cuit').trim(),
      networkCode: getSetting(db, 'network_code').trim(),
      branchName: getSetting(db, 'branch_name').trim() || businessName,
      version, stockSnapshot,
    })
  } catch (e) { try { console.error('[portal] pingNow:', e.message) } catch {}; return Promise.resolve({ ok: false, error: 'pingNow: ' + (e && e.message) }) }
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

// Envía un EVENTO puntual al servidor central para alerta en TIEMPO REAL (v3.0.0).
// tipo: 'anulacion' | 'cierre_caja' | 'stock_bajo' | 'ingreso_stock'. datos: objeto libre.
// Fire-and-forget: nunca bloquea ni rompe el handler que lo llama. Si el negocio no tiene
// portal configurado (sin slug o sin PIN) no se manda nada (en silencio).
function sendEvento(db, tipo, datos) {
  try {
    const slug = getSetting(db, 'portal_central_slug').trim()
    const pin = getSetting(db, 'portal_pin').trim()
    if (!slug || !pin) return // sin portal configurado → no hay a quién/cómo avisar
    postJson('/evento', { slug, tipo, datos: datos || {} }, 8000)
      .then(() => { try { console.log('[evento] ' + tipo + ' enviado (slug=' + slug + ')') } catch {} })
      .catch((e) => { try { console.error('[evento] ' + tipo + ' falló: ' + (e && e.message)) } catch {} })
  } catch (e) { try { console.error('[evento] sendEvento excepción: ' + (e && e.message)) } catch {} }
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

module.exports = { pingCentralPortal, pingNow, pingForLicense, sendEvento, PING_SECRET, CENTRAL_BASE, syncRedStock, syncRedPrecios }
