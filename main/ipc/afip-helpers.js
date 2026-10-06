// Helpers compartidos entre afip.js y fiscal.js
// No registra handlers IPC — solo exporta funciones
const fs   = require('fs')
const path = require('path')
const { app } = require('electron')
const { getDB } = require('../../database/db')

// CUIT legacy (certificado DELPA empaquetado) — fallback si el cliente no cargó el suyo.
const LEGACY_CUIT = '27436672948'
// Archivos legacy (dentro del asar) — fuente de migración a userData.
const LEGACY_CERT_PATH = path.join(__dirname, '..', 'delpa.crt.crt')
const LEGACY_KEY_PATH  = path.join(__dirname, '..', 'delpa.key')

// ── Certificados por cliente en userData (fuera del asar) ──────────────────────
function getCertDir() {
  const dir = path.join(app.getPath('userData'), 'afip-cert')
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}
function getCertPath() { return path.join(getCertDir(), 'cert.crt') }
function getKeyPath()  { return path.join(getCertDir(), 'key.key') }

// Migra los archivos legacy (main/delpa.*) a userData/afip-cert la primera vez.
// Desde v1.42.1 el build YA NO empaqueta esos archivos → en instalaciones nuevas no
// existen y esto no migra nada (no-op). Solo ayuda a quien venía de una versión que aún
// los traía. Sin cert → el usuario genera su CSR y carga su .crt desde la UI.
let _migrated = false
function migrateLegacyCerts() {
  if (_migrated) return
  _migrated = true
  try {
    const certDst = getCertPath(), keyDst = getKeyPath()
    if (!fs.existsSync(certDst) && fs.existsSync(LEGACY_CERT_PATH)) {
      fs.writeFileSync(certDst, fs.readFileSync(LEGACY_CERT_PATH))
      console.log('[AFIP] cert legacy migrado a userData')
    }
    if (!fs.existsSync(keyDst) && fs.existsSync(LEGACY_KEY_PATH)) {
      fs.writeFileSync(keyDst, fs.readFileSync(LEGACY_KEY_PATH))
      console.log('[AFIP] key legacy migrada a userData')
    }
  } catch (e) { console.error('[AFIP] migración cert legacy:', e.message) }
}

function hasCert() {
  migrateLegacyCerts()
  return fs.existsSync(getCertPath()) && fs.existsSync(getKeyPath())
}

// CUIT dinámico: cert instalado (afip_cert_cuit) → business_cuit → legacy.
function getCuit() {
  try {
    const db = getDB()
    const certCuit = db.prepare("SELECT value FROM settings WHERE key='afip_cert_cuit'").get()?.value
    if (certCuit && /^\d{11}$/.test(certCuit)) return certCuit
    const bizCuit = (db.prepare("SELECT value FROM settings WHERE key='business_cuit'").get()?.value || '').replace(/\D/g, '')
    if (/^\d{11}$/.test(bizCuit)) return bizCuit
  } catch {}
  return LEGACY_CUIT
}

// Info del certificado (CUIT del serialNumber, vencimiento, alias) vía node-forge.
function parseCertInfo(pem) {
  const forge = require('node-forge')
  const cert = forge.pki.certificateFromPem(pem)
  const field = (name) => { try { return cert.subject.getField(name)?.value || '' } catch { return '' } }
  const cn = field('CN'), org = field('O')
  let serial = ''
  try { serial = (cert.subject.attributes.find(a => a.shortName === 'serialNumber' || a.type === '2.5.4.5') || {}).value || '' } catch {}
  const cuit = (serial.match(/\d{11}/) || cn.match(/\d{11}/) || [''])[0]
  return { cuit, alias: cn || org || 'certificado', org, notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter }
}

const ENDPOINTS = {
  testing: {
    wsaa:   { wsdl: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL',  url: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms' },
    wsfev1: { wsdl: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL',    url: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
  },
  production: {
    wsaa:   { wsdl: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL',      url: 'https://wsaa.afip.gov.ar/ws/services/LoginCms' },
    wsfev1: { wsdl: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL', url: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' },
  },
}

const taCache     = {}
const soapClients = {}

function getEnv() {
  try {
    const val = getDB().prepare("SELECT value FROM settings WHERE key='afip_env'").get()?.value
    return val === 'production' ? 'production' : 'testing'
  } catch { return 'testing' }
}

function getPtoVta() {
  try { return parseInt(getDB().prepare("SELECT value FROM settings WHERE key='afip_punto_venta'").get()?.value || '1', 10) }
  catch { return 1 }
}

function clearAllCaches() {
  for (const k of Object.keys(taCache))     delete taCache[k]
  for (const k of Object.keys(soapClients)) delete soapClients[k]
}

function toAfipTs(d) {
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  const p = n => String(n).padStart(2, '0')
  return `${ar.getUTCFullYear()}-${p(ar.getUTCMonth()+1)}-${p(ar.getUTCDate())}T${p(ar.getUTCHours())}:${p(ar.getUTCMinutes())}:${p(ar.getUTCSeconds())}-03:00`
}

function buildTRA() {
  const now = Date.now()
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(now / 1000)}</uniqueId>
    <generationTime>${toAfipTs(new Date(now - 10 * 60 * 1000))}</generationTime>
    <expirationTime>${toAfipTs(new Date(now + 12 * 60 * 60 * 1000))}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`
}

function signTRA(tra) {
  const forge = require('node-forge')
  const cert  = forge.pki.certificateFromPem(fs.readFileSync(getCertPath(), 'utf8'))
  const key   = forge.pki.privateKeyFromPem(fs.readFileSync(getKeyPath(),  'utf8'))
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(tra, 'utf8')
  p7.addCertificate(cert)
  p7.addSigner({
    key, certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType,  value: forge.pki.oids.data },
      { type: forge.pki.oids.signingTime,  value: new Date() },
      { type: forge.pki.oids.messageDigest },
    ],
  })
  p7.sign()
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return forge.util.encode64(der)
}

async function getSoapClient(type, env) {
  const k = `${env}_${type}`
  if (!soapClients[k]) {
    const soap = require('soap')
    const ep = ENDPOINTS[env][type]
    soapClients[k] = await soap.createClientAsync(ep.wsdl, { wsdl_options: { timeout: 30000 }, endpoint: ep.url })
  }
  return soapClients[k]
}

async function authenticate(env) {
  const cached = taCache[env]
  if (cached && new Date(cached.expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) return cached
  migrateLegacyCerts()
  if (!fs.existsSync(getCertPath())) throw new Error('No hay certificado AFIP instalado. Cargá el .crt en Configuración → AFIP.')
  if (!fs.existsSync(getKeyPath()))  throw new Error('No hay clave privada AFIP. Generá el CSR en Configuración → AFIP.')
  const tra = buildTRA()
  const cms = signTRA(tra)
  const client = await getSoapClient('wsaa', env)
  const [res] = await client.loginCmsAsync({ in0: cms })
  const xml = res.loginCmsReturn
  const token     = xml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim()
  const sign      = xml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim()
  const expiresAt = xml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]?.trim()
  if (!token || !sign) throw new Error('Respuesta WSAA inválida')
  taCache[env] = { token, sign, expiresAt: expiresAt || new Date(Date.now() + 11 * 3600000).toISOString() }
  return taCache[env]
}

module.exports = {
  LEGACY_CUIT, LEGACY_CERT_PATH, LEGACY_KEY_PATH,
  getCertDir, getCertPath, getKeyPath, migrateLegacyCerts, hasCert, getCuit, parseCertInfo,
  ENDPOINTS, taCache, soapClients, getEnv, getPtoVta, clearAllCaches, toAfipTs, getSoapClient, authenticate,
}
