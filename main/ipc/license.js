const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')
const crypto = require('crypto')
const os = require('os')

const LICENSE_SECRET = 'DELPA2024-PRO-LICENSE-KEY-v1'
const TRIAL_DAYS     = 20
const GRACE_DAYS     = 3  // Days after expiry before hard block

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

ipcMain.handle('license:status', () => {
  const db = getDB()
  const hardwareId = getHardwareId()

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
    const now = new Date().toISOString()
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('license_installed_at',?)").run(now)
    return { status: 'trial', daysRemaining: TRIAL_DAYS, hardwareId }
  }
  const daysPassed  = Math.floor((Date.now() - new Date(instRow.value).getTime()) / 86400000)
  const daysRemaining = Math.max(0, TRIAL_DAYS - daysPassed)
  return {
    status: daysRemaining > 0 ? 'trial' : 'expired',
    daysRemaining,
    hardwareId,
    reason: 'trial',
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
