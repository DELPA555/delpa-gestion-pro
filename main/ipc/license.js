const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')
const crypto = require('crypto')
const os = require('os')
const https = require('https')
let CENTRAL_BASE = 'https://portal.delpagestion.com.ar'
try { CENTRAL_BASE = require('../lib/centralPortalPing').CENTRAL_BASE || CENTRAL_BASE } catch {}

// Chequeo de licencia contra el VPS (GET /license/:hwid). Timeout 8s. Rechaza si no
// se puede contactar (→ el llamador cae al modo gracia / licencia local).
function vpsLicenseCheck(hwid) {
  return new Promise((resolve, reject) => {
    const u = new URL(CENTRAL_BASE + '/license/' + encodeURIComponent(hwid))
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'GET', timeout: 8000 }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => { try { resolve(JSON.parse(d || '{}')) } catch { reject(new Error('respuesta inválida')) } })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}
const VPS_GRACE_MS = 7 * 24 * 60 * 60 * 1000 // gracia offline: hasta 7 días con la última licencia activa conocida

const LICENSE_SECRET = 'DELPA2024-PRO-LICENSE-KEY-v1'
const TRIAL_DAYS       = 14  // Instalaciones NUEVAS
const LEGACY_TRIAL_DAYS = 20 // Instalaciones previas (ya en curso) — se respeta su prueba original
const GRACE_DAYS       = 3   // Days after expiry before hard block

function getHardwareId() {
  const cpus = os.cpus()
  const raw  = [os.hostname(), os.platform(), os.arch(), cpus[0]?.model || ''].join('|')
  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase().slice(0, 32)
}

function getTodayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

// --- New subscription license format ---
// 20 hex chars = 4 groups of 5
// First 8 chars: expiry YYYYMMDD as integer encoded in hex (padded to 8)
// Last 12 chars: HMAC-SHA256("{expiryYYYYMMDD}:{HWID}") first 12 chars uppercase

function expiryToHex(yyyymmdd) {
  return parseInt(yyyymmdd, 10).toString(16).toUpperCase().padStart(8, '0')
}

function hexToExpiry(hex8) {
  return String(parseInt(hex8, 16)).padStart(8, '0')
}

function generateCode(hardwareId, expiryDate) {
  // expiryDate: 'YYYYMMDD'
  const expiryHex = expiryToHex(expiryDate)
  const payload   = `${expiryDate}:${hardwareId.trim().toUpperCase()}`
  const sig       = crypto.createHmac('sha256', LICENSE_SECRET).update(payload).digest('hex').toUpperCase().slice(0, 12)
  const raw       = expiryHex + sig // 20 chars
  return `${raw.slice(0,5)}-${raw.slice(5,10)}-${raw.slice(10,15)}-${raw.slice(15,20)}`
}

// Returns expiryDate string 'YYYYMMDD' if valid, null otherwise
function decodeAndValidate(code, hardwareId) {
  const raw = code.replace(/[-\s]/g, '').toUpperCase()
  if (raw.length !== 20) return null
  if (!/^[0-9A-F]{20}$/.test(raw)) return null
  const expiryHex = raw.slice(0, 8)
  const providedSig = raw.slice(8, 20)
  const expiryDate = hexToExpiry(expiryHex)
  if (!/^\d{8}$/.test(expiryDate)) return null
  const payload = `${expiryDate}:${hardwareId.trim().toUpperCase()}`
  const expectedSig = crypto.createHmac('sha256', LICENSE_SECRET).update(payload).digest('hex').toUpperCase().slice(0, 12)
  if (providedSig !== expectedSig) return null
  return expiryDate
}

// Days between today and expiryDate (positive = future, negative = past)
function daysUntilExpiry(expiryDate) {
  const expMs  = new Date(
    expiryDate.slice(0, 4) + '-' + expiryDate.slice(4, 6) + '-' + expiryDate.slice(6, 8)
  ).getTime()
  return Math.ceil((expMs - Date.now()) / 86400000)
}

function formatExpiryDisplay(expiryDate) {
  return `${expiryDate.slice(6, 8)}/${expiryDate.slice(4, 6)}/${expiryDate.slice(0, 4)}`
}

// Send warning/expiry email at most once per day
function maybeNotifyExpiry(db, daysDiff, expiryDate) {
  try {
    if (daysDiff > 7) return
    const today = getTodayStr()
    const notified = db.prepare("SELECT value FROM settings WHERE key='license_expiry_notified'").get()?.value
    if (notified === today) return
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_expiry_notified',?)").run(today)
    // Fire-and-forget
    const { sendExpiryNotification } = require('./email')
    sendExpiryNotification(daysDiff, expiryDate).catch(() => {})
  } catch {}
}

// Estado de licencia LOCAL (código/prueba) — el comportamiento clásico, usado como
// fallback cuando el VPS no está disponible o cuando el equipo no está registrado.
function localStatus(db, hardwareId) {
  const licRow = db.prepare("SELECT value FROM settings WHERE key='license_code'").get()
  if (licRow?.value) {
    const expiryDate = decodeAndValidate(licRow.value, hardwareId)
    if (expiryDate) {
      const daysDiff = daysUntilExpiry(expiryDate)
      const expiryDisplay = formatExpiryDisplay(expiryDate)

      maybeNotifyExpiry(db, daysDiff, expiryDate)

      if (daysDiff >= 0) {
        return { status: 'active', hardwareId, daysRemaining: daysDiff, expiryDate, expiryDisplay }
      }
      const daysOverdue = Math.abs(daysDiff)
      if (daysOverdue <= GRACE_DAYS) {
        return { status: 'grace', hardwareId, daysRemaining: daysDiff, daysOverdue, expiryDate, expiryDisplay }
      }
      return { status: 'expired', hardwareId, daysOverdue, expiryDate, expiryDisplay, reason: 'subscription' }
    }
  }

  // No valid subscription license → fall back to trial
  let instRow = db.prepare("SELECT value FROM settings WHERE key='license_installed_at'").get()
  if (!instRow?.value) {
    // Instalación NUEVA: se fija la fecha y la duración de prueba (14 días).
    const now = new Date().toISOString()
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_installed_at',?)").run(now)
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_trial_days',?)").run(String(TRIAL_DAYS))
    return { status: 'trial', daysRemaining: TRIAL_DAYS, trialDays: TRIAL_DAYS, hardwareId }
  }
  // Instalación existente: se respeta la duración guardada; si no hay (instalación
  // previa a esta versión), se mantiene la prueba original de 20 días — no se acorta.
  const savedTrial = db.prepare("SELECT value FROM settings WHERE key='license_trial_days'").get()
  const trialDays = savedTrial?.value ? (Number(savedTrial.value) || LEGACY_TRIAL_DAYS) : LEGACY_TRIAL_DAYS
  const daysPassed  = Math.floor((Date.now() - new Date(instRow.value).getTime()) / 86400000)
  const daysRemaining = Math.max(0, trialDays - daysPassed)
  return {
    status: daysRemaining > 0 ? 'trial' : 'expired',
    daysRemaining,
    trialDays,
    hardwareId,
    reason: 'trial',
  }
}

// license:status — primero consulta el VPS; si no responde, cae al estado local
// (código/prueba) o a la última licencia activa conocida (gracia offline 7 días).
// Nunca bloquea por falta de conexión. Un equipo NO registrado conserva su prueba.
function offlineFallback(db, hardwareId) {
  // VPS inalcanzable → modo gracia: si la última licencia conocida estaba activa y es
  // reciente (<7 días), seguimos activos; si no, caemos al estado local.
  try {
    const active = db.prepare("SELECT value FROM settings WHERE key='license_vps_active'").get()?.value
    const checked = db.prepare("SELECT value FROM settings WHERE key='license_vps_checked'").get()?.value
    if (active === '1' && checked && (Date.now() - new Date(checked).getTime()) < VPS_GRACE_MS) {
      return { status: 'active', hardwareId, source: 'vps-cache', offline: true, daysRemaining: 0 }
    }
  } catch {}
  return localStatus(db, hardwareId)
}

ipcMain.handle('license:status', async () => {
  const db = getDB()
  const hardwareId = getHardwareId()

  // FIX 1 (v1.54.1): PRIMERO registramos el hwid en el VPS (y éste importa la licencia
  // local si corresponde), esperando máx. 5s. Recién después verificamos. Si el ping falla,
  // el VPS está caído → fallback directo sin esperar otro timeout del chequeo.
  let vpsReachable = true
  try {
    const pr = await require('../lib/centralPortalPing').pingForLicense(db)
    vpsReachable = !!(pr && pr.ok)
  } catch { vpsReachable = false }
  if (!vpsReachable) return offlineFallback(db, hardwareId)

  try {
    const r = await vpsLicenseCheck(hardwareId)
    if (r && r.registered && r.active) {
      // Licencia activa en el VPS.
      try {
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_vps_active','1')").run()
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_vps_expires',?)").run(String(r.expiresAt || ''))
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_vps_checked',?)").run(new Date().toISOString())
      } catch {}
      const exp = r.expiresAt ? new Date(r.expiresAt) : null
      return {
        status: 'active', hardwareId, source: 'vps',
        daysRemaining: Number(r.daysLeft) || 0,
        expiryDisplay: exp ? exp.toLocaleDateString('es-AR') : '',
        plan: r.plan || '', businessName: r.businessName || '',
      }
    }
    if (r && r.registered && !r.active) {
      // Registrado pero vencido/desactivado → bloqueo (es un cliente que debe renovar).
      try { db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_vps_active','0')").run() } catch {}
      const exp = r.expiresAt ? new Date(r.expiresAt) : null
      return { status: 'expired', hardwareId, reason: 'subscription', source: 'vps', expiryDisplay: exp ? exp.toLocaleDateString('es-AR') : '' }
    }
    // No registrado en el VPS → se respeta la licencia/prueba local (no se bloquea).
    return localStatus(db, hardwareId)
  } catch (e) {
    return offlineFallback(db, hardwareId)
  }
})

ipcMain.handle('license:activate', (_, code) => {
  if (!code || typeof code !== 'string') return { ok: false, error: 'Código inválido' }
  const hardwareId = getHardwareId()
  const expiryDate = decodeAndValidate(code.trim(), hardwareId)
  if (!expiryDate) {
    return { ok: false, error: 'Código incorrecto para esta PC. Verificá el Hardware ID.' }
  }
  const db = getDB()
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_code',?)").run(code.trim().toUpperCase())
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_expiry',?)").run(expiryDate)
  // Reset notification so it can re-notify if needed near next expiry
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_expiry_notified','')").run()
  const expiryDisplay = formatExpiryDisplay(expiryDate)
  return { ok: true, expiryDate, expiryDisplay }
})

module.exports = { getHardwareId, generateCode, decodeAndValidate }
