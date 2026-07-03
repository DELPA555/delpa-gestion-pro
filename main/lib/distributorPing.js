// Ping al panel del distribuidor (Apps Script). Identifica cada instalación por
// el nombre real del negocio; si no fue personalizado, usa el Hardware ID.

const PING_URL = 'https://script.google.com/macros/s/AKfycbxZfzVmml8GljdWS4Pw7MuHiXJF9nJgLw0ipXfXqf6u1_kzQMGCvvaLgYCNB8xp848n/exec'

// Valores que NO son un nombre real (default de fábrica / sin configurar)
const PLACEHOLDER_NAMES = ['', 'DELPA', 'DELPA GESTION PRO', 'DELPA GESTIÓN PRO']

function getLicenseData(db) {
  const TRIAL_DAYS = 20
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
  const instRow = db.prepare("SELECT value FROM settings WHERE key='license_installed_at'").get()
  if (instRow?.value) {
    const daysPassed = Math.floor((Date.now() - new Date(instRow.value).getTime()) / 86400000)
    const daysLeft = Math.max(0, TRIAL_DAYS - daysPassed)
    return { licenseStatus: daysLeft > 0 ? 'trial' : 'expired', daysLeft }
  }
  return { licenseStatus: 'trial', daysLeft: TRIAL_DAYS }
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

    const payload = {
      hardwareId,
      businessName,
      businessNameRaw: rawName,   // el valor crudo de settings (vacío/DELPA = sin configurar)
      licenseStatus,
      daysLeft,
      version: pkg.version || '1.0.0',
      lastSale: lastSale ? lastSale.created_at : null,
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
    req.on('error', () => {})
    req.write(body)
    req.end()
  } catch {}
}

module.exports = { pingDistributor }
