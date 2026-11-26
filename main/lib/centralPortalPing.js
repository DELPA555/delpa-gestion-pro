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

const CENTRAL_URL = 'https://portal.delpagestion.com.ar/ping'
// Mismo valor que PING_SECRET en tools/portal-server/deploy.sh.
const PING_SECRET = '0822e42fa23b4f9dd3b79afb29d3a4a4b8489b7709c46276'

function getSetting(db, key) {
  try { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '' } catch { return '' }
}

// Ventas del día (total facturado, sin anuladas) y efectivo en la caja abierta.
function computeVentasCaja(db) {
  let ventasHoy = 0, cajaHoy = 0
  try {
    ventasHoy = db.prepare(
      "SELECT COALESCE(SUM(total),0) t FROM sales WHERE voided=0 AND date(created_at,'localtime')=date('now','localtime')"
    ).get().t || 0
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
  return { ventasHoy, cajaHoy }
}

// Envía el ping al servidor central. base = { hwid, businessName, cuit, networkCode, branchName, version, stockSnapshot }.
function pingCentralPortal(db, base) {
  try {
    const pin = getSetting(db, 'portal_pin').trim()
    if (!pin) return // sin portal configurado → no registrar ni enviar datos

    const { ventasHoy, cajaHoy } = computeVentasCaja(db)
    const payload = {
      hwid: base.hwid,
      businessName: base.businessName || '',
      cuit: base.cuit || '',
      networkCode: base.networkCode || '',
      branchName: base.branchName || '',
      stockSnapshot: base.stockSnapshot || [],
      ventasHoy, cajaHoy,
      version: base.version || '',
      pin,
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
          }
        } catch {}
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => {})
    req.write(body)
    req.end()
  } catch {}
}

module.exports = { pingCentralPortal }
