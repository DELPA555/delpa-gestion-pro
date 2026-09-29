// Ping al panel del distribuidor (Apps Script). Identifica cada instalación por
// el nombre real del negocio; si no fue personalizado, usa el Hardware ID.

const PING_URL = 'https://script.google.com/macros/s/AKfycbxZfzVmml8GljdWS4Pw7MuHiXJF9nJgLw0ipXfXqf6u1_kzQMGCvvaLgYCNB8xp848n/exec'

// Valores que NO son un nombre real (default de fábrica / sin configurar)
const PLACEHOLDER_NAMES = ['', 'DELPA', 'DELPA GESTION PRO', 'DELPA GESTIÓN PRO']

function getLicenseData(db) {
  const licRow = db.prepare("SELECT value FROM settings WHERE key='license_code'").get()
  const expiryRow = db.prepare("SELECT value FROM settings WHERE key='license_expiry'").get()
  if (licRow?.value && expiryRow?.value) {
    const expiryDate = expiryRow.value
    const expMs = new Date(
      expiryDate.slice(0, 4) + '-' + expiryDate.slice(4, 6) + '-' + expiryDate.slice(6, 8)
    ).getTime()
    const daysLeft = Math.ceil((expMs - Date.now()) / 86400000)
    return { licenseStatus: daysLeft >= 0 ? 'active' : 'expired', daysLeft: Math.max(0, daysLeft) }
  }
  const savedTrial = db.prepare("SELECT value FROM settings WHERE key='license_trial_days'").get()
  const trialDays = savedTrial?.value ? (Number(savedTrial.value) || 20) : 20 // grandfather de instalaciones previas
  const instRow = db.prepare("SELECT value FROM settings WHERE key='license_installed_at'").get()
  if (instRow?.value) {
    const daysPassed = Math.floor((Date.now() - new Date(instRow.value).getTime()) / 86400000)
    const daysLeft = Math.max(0, trialDays - daysPassed)
    return { licenseStatus: daysLeft > 0 ? 'trial' : 'expired', daysLeft }
  }
  return { licenseStatus: 'trial', daysLeft: 14 }
}

function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || ''
}

// Snapshot compacto del stock para compartir con la red del mismo CUIT.
// Formato compacto (payload chico): [{ b:barcode, n:name, c:color, cat:category, s:[[talle,stock],...] }]
// Solo incluye productos activos con stock total > 0 (los ausentes en un nodo se leen como 0 en la grilla).
function buildStockSnapshot(db) {
  try {
    const rows = db.prepare(`
      SELECT p.id AS pid, p.barcode AS b, p.name AS n, p.color AS c, p.category AS cat,
             ps.size AS size, ps.stock AS stock
      FROM products p
      JOIN product_sizes ps ON ps.product_id = p.id
      WHERE p.active = 1
      ORDER BY p.id
    `).all()
    const byProduct = new Map()
    for (const r of rows) {
      let it = byProduct.get(r.pid)
      if (!it) { it = { b: r.b || '', n: r.n || '', c: r.c || '', cat: r.cat || '', s: [], _total: 0 }; byProduct.set(r.pid, it) }
      const qty = Number(r.stock) || 0
      it.s.push([r.size, qty])
      it._total += qty
    }
    const out = []
    for (const it of byProduct.values()) {
      if (it._total <= 0) continue
      out.push({ b: it.b, n: it.n, c: it.c, cat: it.cat, s: it.s })
    }
    return out
  } catch { return [] }
}

function pingDistributor() {
  try {
    const db = require('../../database/db').getDB()
    const { getHardwareId } = require('../ipc/license')
    const hardwareId = String(getHardwareId() || '')
    const bizRow = db.prepare("SELECT value FROM settings WHERE key='business_name'").get()
    const rawName = (bizRow?.value || '').trim()

    // Nombre real si fue personalizado; si no, identificar por Hardware ID
    const isPlaceholder = PLACEHOLDER_NAMES.includes(rawName.toUpperCase())
    const businessName = isPlaceholder
      ? `Sin nombre [${hardwareId.slice(0, 8) || 'desconocido'}]`
      : rawName

    const lastSale = db.prepare("SELECT created_at FROM sales ORDER BY id DESC LIMIT 1").get()
    const { licenseStatus, daysLeft } = getLicenseData(db)
    const pkg = require('../../package.json')

    // ── Red de locales (multi-nodo por CUIT) ──
    const cuit = getSetting(db, 'business_cuit').trim()
    const branchType = getSetting(db, 'branch_type').trim()          // sucursal | deposito | ambos
    const branchName = getSetting(db, 'branch_name').trim() || businessName
    const shareStock = getSetting(db, 'branch_share_stock') !== '0'

    const payload = {
      hardwareId,
      businessName,
      businessNameRaw: rawName,   // el valor crudo de settings (vacío/DELPA = sin configurar)
      licenseStatus,
      daysLeft,
      version: pkg.version || '1.0.0',
      lastSale: lastSale ? lastSale.created_at : null,
      // Campos de red — el Apps Script los ignora si no están definidos
      cuit,
      branchName,
      branchType,
    }

    // Solo subimos stock si hay CUIT y el nodo tiene compartir habilitado
    if (cuit && shareStock) {
      payload.stockSnapshot = buildStockSnapshot(db)
      try {
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('network_last_sync',?)")
          .run(new Date().toISOString())
      } catch {}
    }

    const https = require('https')
    const body = JSON.stringify(payload)
    const parsedUrl = new URL(PING_URL)
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    })
    req.on('error', (e) => {
      try { require('../ipc/techLogs').logTech('error', 'red', 'Error al enviar ping/stock a la red: ' + (e?.message || e)) } catch {}
    })
    req.write(body)
    req.end()
  } catch {}
}

module.exports = { pingDistributor, buildStockSnapshot, PING_URL }
