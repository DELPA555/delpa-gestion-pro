#!/usr/bin/env node
/**
 * DELPA Gestión PRO — Verificador de licencias (suscripción mensual)
 * Uso: node tools/check-license.js <HARDWARE_ID> <LICENSE_CODE>
 */

const crypto = require('crypto')

const LICENSE_SECRET = 'DELPA2024-PRO-LICENSE-KEY-v1'

function hexToExpiry(hex8) {
  return String(parseInt(hex8, 16)).padStart(8, '0')
}

function decodeAndValidate(code, hardwareId) {
  const raw = code.replace(/[-\s]/g, '').toUpperCase()
  if (raw.length !== 20 || !/^[0-9A-F]{20}$/.test(raw)) return null
  const expiryHex   = raw.slice(0, 8)
  const providedSig = raw.slice(8, 20)
  const expiryDate  = hexToExpiry(expiryHex)
  if (!/^\d{8}$/.test(expiryDate)) return null
  const payload     = `${expiryDate}:${hardwareId.trim().toUpperCase()}`
  const expectedSig = crypto.createHmac('sha256', LICENSE_SECRET).update(payload).digest('hex').toUpperCase().slice(0, 12)
  if (providedSig !== expectedSig) return null
  return expiryDate
}

function formatDate(yyyymmdd) {
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`
}

const [, , hardwareId, licenseCode] = process.argv

if (!hardwareId || !licenseCode) {
  console.log('\nUso: node tools/check-license.js <HARDWARE_ID> <LICENSE_CODE>\n')
  process.exit(1)
}

const expiryDate = decodeAndValidate(licenseCode, hardwareId)

console.log('\n==========================================')
console.log('  DELPA Gestión PRO — Verificador')
console.log('==========================================')
console.log(`  Hardware ID: ${hardwareId.trim()}`)
console.log(`  Código:      ${licenseCode.trim()}`)

if (!expiryDate) {
  console.log(`  Resultado:   ✗ INVÁLIDA`)
  console.log('==========================================\n')
  process.exit(1)
}

const expDate  = new Date(expiryDate.slice(0,4) + '-' + expiryDate.slice(4,6) + '-' + expiryDate.slice(6,8))
const daysDiff = Math.ceil((expDate - Date.now()) / 86400000)
const isExpired = daysDiff < 0

console.log(`  Resultado:   ✓ VÁLIDA`)
console.log(`  Vence:       ${formatDate(expiryDate)}`)
console.log(`  Estado:      ${isExpired ? `Vencida hace ${Math.abs(daysDiff)} días` : `${daysDiff} días restantes`}`)
console.log('==========================================\n')

process.exit(isExpired ? 2 : 0)
