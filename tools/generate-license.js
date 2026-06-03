#!/usr/bin/env node
/**
 * DELPA Gestión PRO — Generador de licencias (modelo suscripción mensual)
 * Uso interactivo: node tools/generate-license.js
 * Uso directo:     node tools/generate-license.js <HARDWARE_ID> <MESES> [CLIENTE]
 *
 * Formato del código: XXXXX-XXXXX-XXXXX-XXXXX (20 hex chars)
 *   - Primeros 8 chars: fecha de vencimiento (YYYYMMDD como entero en hex)
 *   - Últimos 12 chars: HMAC-SHA256("{expiry}:{HWID}") primeros 12 chars
 */

const crypto   = require('crypto')
const readline = require('readline')
const fs       = require('fs')
const path     = require('path')

const LICENSE_SECRET = 'DELPA2024-PRO-LICENSE-KEY-v1'
const LOG_FILE       = path.join(__dirname, 'licenses-log.txt')

const MONTH_OPTIONS = [
  { value: 1,  label: '1 mes' },
  { value: 3,  label: '3 meses' },
  { value: 6,  label: '6 meses' },
  { value: 12, label: '12 meses (1 año)' },
]

// --- Codec ---

function expiryToHex(yyyymmdd) {
  return parseInt(yyyymmdd, 10).toString(16).toUpperCase().padStart(8, '0')
}

function hexToExpiry(hex8) {
  return String(parseInt(hex8, 16)).padStart(8, '0')
}

function generateCode(hardwareId, expiryDate) {
  const expiryHex = expiryToHex(expiryDate)
  const payload   = `${expiryDate}:${hardwareId.trim().toUpperCase()}`
  const sig       = crypto.createHmac('sha256', LICENSE_SECRET).update(payload).digest('hex').toUpperCase().slice(0, 12)
  const raw       = expiryHex + sig
  return `${raw.slice(0,5)}-${raw.slice(5,10)}-${raw.slice(10,15)}-${raw.slice(15,20)}`
}

function decodeAndValidate(code, hardwareId) {
  const raw = code.replace(/[-\s]/g, '').toUpperCase()
  if (raw.length !== 20 || !/^[0-9A-F]{20}$/.test(raw)) return null
  const expiryHex  = raw.slice(0, 8)
  const providedSig = raw.slice(8, 20)
  const expiryDate = hexToExpiry(expiryHex)
  if (!/^\d{8}$/.test(expiryDate)) return null
  const payload    = `${expiryDate}:${hardwareId.trim().toUpperCase()}`
  const expectedSig = crypto.createHmac('sha256', LICENSE_SECRET).update(payload).digest('hex').toUpperCase().slice(0, 12)
  if (providedSig !== expectedSig) return null
  return expiryDate
}

// --- Date helpers ---

function calcExpiryDate(months) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  const y   = d.getFullYear()
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function formatDate(yyyymmdd) {
  return `${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(0, 4)}`
}

function todayStr() {
  return new Date().toLocaleString('es-AR')
}

// --- Log ---

function logLicense(entry) {
  const line = `[${todayStr()}] HW: ${entry.hardwareId} | Cliente: ${entry.clientName || '—'} | Meses: ${entry.months} | Vence: ${formatDate(entry.expiryDate)} | Código: ${entry.code}\n`
  try { fs.appendFileSync(LOG_FILE, line, 'utf8') } catch {}
}

// --- Print ---

function printResult(entry) {
  console.log('\n==========================================')
  console.log('  DELPA Gestión PRO — Licencia generada')
  console.log('==========================================')
  if (entry.clientName) console.log(`  Cliente:     ${entry.clientName}`)
  console.log(`  Hardware ID: ${entry.hardwareId}`)
  console.log(`  Período:     ${entry.months} mes${entry.months !== 1 ? 'es' : ''}`)
  console.log(`  Vence:       ${formatDate(entry.expiryDate)} (${entry.expiryDate})`)
  console.log(`  Código:      ${entry.code}`)
  console.log('==========================================\n')
}

// --- Direct mode (args) ---

if (process.argv[2] && process.argv[2] !== '--menu') {
  const hardwareId = process.argv[2].trim()
  const months     = parseInt(process.argv[3] || '1', 10)
  const clientName = process.argv.slice(4).join(' ')

  if (isNaN(months) || months < 1) {
    console.error('  Error: cantidad de meses inválida. Usar 1, 3, 6 o 12.')
    process.exit(1)
  }

  const expiryDate = calcExpiryDate(months)
  const code       = generateCode(hardwareId, expiryDate)
  const entry      = { hardwareId, months, expiryDate, code, clientName }
  printResult(entry)
  logLicense(entry)
  process.exit(0)
}

// --- Interactive menu ---

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise(resolve => rl.question(q, resolve))

async function menuGenerate() {
  const hardwareId = (await ask('  Hardware ID del cliente: ')).trim()
  if (!hardwareId) { console.log('  Hardware ID requerido.\n'); return }

  console.log('\n  Cantidad de meses:')
  MONTH_OPTIONS.forEach((o, i) => console.log(`    [${i + 1}] ${o.label}`))
  const optStr = (await ask('\n  Opción (1-4): ')).trim()
  const optIdx = parseInt(optStr, 10) - 1
  if (isNaN(optIdx) || optIdx < 0 || optIdx >= MONTH_OPTIONS.length) {
    console.log('  Opción inválida.\n')
    return
  }
  const months = MONTH_OPTIONS[optIdx].value

  const clientName = (await ask('  Nombre del cliente (opcional): ')).trim()

  const expiryDate = calcExpiryDate(months)
  const code       = generateCode(hardwareId, expiryDate)
  const entry      = { hardwareId, months, expiryDate, code, clientName }
  printResult(entry)
  logLicense(entry)
}

async function menuViewLog() {
  if (!fs.existsSync(LOG_FILE)) { console.log('\n  Sin licencias registradas aún.\n'); return }
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n')
  console.log(`\n  Últimas ${Math.min(lines.length, 20)} licencias generadas:`)
  console.log('  ' + '─'.repeat(80))
  lines.slice(-20).forEach(l => console.log('  ' + l))
  console.log('')
}

async function menuVerify() {
  const hardwareId = (await ask('  Hardware ID: ')).trim()
  if (!hardwareId) { console.log('  Hardware ID requerido.\n'); return }
  const code = (await ask('  Código de licencia: ')).trim()
  const expiryDate = decodeAndValidate(code, hardwareId)
  if (!expiryDate) {
    console.log('\n  ✗ INVÁLIDA — El código no corresponde a este Hardware ID.\n')
    return
  }
  const today = new Date()
  const expDate = new Date(expiryDate.slice(0,4) + '-' + expiryDate.slice(4,6) + '-' + expiryDate.slice(6,8))
  const daysDiff = Math.ceil((expDate - today) / 86400000)
  const isExpired = daysDiff < 0
  console.log(`\n  ✓ VÁLIDA`)
  console.log(`  Vence:   ${formatDate(expiryDate)}`)
  console.log(`  Estado:  ${isExpired ? `Vencida hace ${Math.abs(daysDiff)} días` : `${daysDiff} días restantes`}`)
  console.log('')
}

async function main() {
  console.log('\n==========================================')
  console.log('  DELPA Gestión PRO — Gestor de Licencias')
  console.log('  Modelo: suscripción mensual')
  console.log('==========================================\n')

  let running = true
  while (running) {
    console.log('  [1] Generar licencia')
    console.log('  [2] Ver historial')
    console.log('  [3] Verificar código')
    console.log('  [4] Salir\n')

    const opt = (await ask('  Opción: ')).trim()
    console.log('')
    switch (opt) {
      case '1': await menuGenerate(); break
      case '2': await menuViewLog(); break
      case '3': await menuVerify(); break
      case '4': running = false; break
      default:  console.log('  Opción inválida.\n')
    }
  }
  rl.close()
}

main().catch(e => { console.error(e.message); process.exit(1) })
