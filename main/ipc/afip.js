const { ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const { getDB } = require('../../database/db')

const CUIT = '27436672948'
const CERT_PATH = path.join(__dirname, '..', 'delpa.crt.crt')
const KEY_PATH  = path.join(__dirname, '..', 'delpa.key')

// Each entry has wsdl (for schema/types) and url (the actual endpoint to POST to).
// The url override is critical: node-soap by default uses <soap:address location> from
// inside the WSDL document, which for AFIP homo resolves to wsaaext1.homo.afip.gov.ar —
// not what we want when switching to production.
const ENDPOINTS = {
  testing: {
    wsaa:   { wsdl: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL',  url: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms' },
    wsfev1: { wsdl: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL',    url: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx' },
  },
  production: {
    wsaa:   { wsdl: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL',          url: 'https://wsaa.afip.gov.ar/ws/services/LoginCms' },
    wsfev1: { wsdl: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',     url: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx' },
  },
}

// Memory caches — keyed by env so switching env always hits different buckets
const taCache     = {}  // { testing: { token, sign, expiresAt }, production: {...} }
const soapClients = {}  // { 'testing_wsaa': client, 'production_wsfev1': client, ... }

// ── Helpers ─────────────────────────────────────────────────────────────────

function getEnv() {
  try {
    const val = getDB().prepare("SELECT value FROM settings WHERE key='afip_env'").get()?.value
    return (val === 'production') ? 'production' : 'testing'
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

// Format a JS Date as Argentina local time (UTC-3) with -03:00 offset
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
  const cert  = forge.pki.certificateFromPem(fs.readFileSync(CERT_PATH, 'utf8'))
  const key   = forge.pki.privateKeyFromPem(fs.readFileSync(KEY_PATH,  'utf8'))

  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(tra, 'utf8')
  p7.addCertificate(cert)
  p7.addSigner({
    key,
    certificate: cert,
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
    // Pass `endpoint` explicitly so node-soap ignores whatever <soap:address location>
    // the WSDL document contains and always POSTs to our specified URL.
    soapClients[k] = await soap.createClientAsync(ep.wsdl, {
      wsdl_options: { timeout: 30000 },
      endpoint: ep.url,
    })
  }
  return soapClients[k]
}

async function authenticate(env) {
  const cached = taCache[env]
  if (cached && new Date(cached.expiresAt) > new Date(Date.now() + 5 * 60 * 1000)) return cached

  if (!fs.existsSync(CERT_PATH)) throw new Error(`Certificado no encontrado: ${CERT_PATH}`)
  if (!fs.existsSync(KEY_PATH))  throw new Error(`Clave privada no encontrada: ${KEY_PATH}`)

  const tra = buildTRA()
  const cms = signTRA(tra)
  const client = await getSoapClient('wsaa', env)

  const [res] = await client.loginCmsAsync({ in0: cms })
  const xml = res.loginCmsReturn

  const token     = xml.match(/<token>([\s\S]*?)<\/token>/)?.[1]?.trim()
  const sign      = xml.match(/<sign>([\s\S]*?)<\/sign>/)?.[1]?.trim()
  const expiresAt = xml.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/)?.[1]?.trim()

  if (!token || !sign) throw new Error('Respuesta WSAA inválida: no se obtuvo token')

  taCache[env] = { token, sign, expiresAt: expiresAt || new Date(Date.now() + 11 * 3600000).toISOString() }
  return taCache[env]
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('afip:status', () => {
  try {
    const db  = getDB()
    const env = (db.prepare("SELECT value FROM settings WHERE key='afip_env'").get()?.value === 'production') ? 'production' : 'testing'
    const pv  = db.prepare("SELECT value FROM settings WHERE key='afip_punto_venta'").get()?.value || ''
    const cf  = db.prepare("SELECT value FROM settings WHERE key='afip_cond_fiscal'").get()?.value || 'RI'
    const ta  = taCache[env]
    const connected = !!(ta && new Date(ta.expiresAt) > new Date())
    return { env, puntoVenta: pv, condFiscal: cf, connected, expiresAt: ta?.expiresAt || null }
  } catch (e) {
    return { env: 'testing', puntoVenta: '', condFiscal: 'RI', connected: false, error: e.message }
  }
})

ipcMain.handle('afip:testConexion', async () => {
  const env = getEnv()
  try {
    // Clear ALL caches — guarantees fresh auth with whatever env is currently saved,
    // regardless of what was cached from a previous environment.
    clearAllCaches()

    const ta = await authenticate(env)
    const client = await getSoapClient('wsfev1', env)
    const [dummy] = await client.FEDummyAsync({})
    return {
      ok: true,
      env,
      appServer:  dummy?.FEDummyResult?.AppServer  || 'OK',
      dbServer:   dummy?.FEDummyResult?.DbServer   || 'OK',
      authServer: dummy?.FEDummyResult?.AuthServer || 'OK',
      tokenPreview: ta.token.substring(0, 30) + '...',
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('afip:consultarUltimoComprobante', async (_, { tipoComprobante } = {}) => {
  const env = getEnv()
  try {
    const ta     = await authenticate(env)
    const client = await getSoapClient('wsfev1', env)
    const [res]  = await client.FECompUltimoAutorizadoAsync({
      Auth: { Token: ta.token, Sign: ta.sign, Cuit: parseInt(CUIT, 10) },
      PtoVta: getPtoVta(), CbteTipo: tipoComprobante,
    })
    return { ok: true, ultimo: res?.FECompUltimoAutorizadoResult?.CbteNro ?? 0 }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

ipcMain.handle('afip:generarCAE', async (_, {
  tipoComprobante,            // 1=A, 6=B, 11=C
  docTipo = 99,               // 80=CUIT, 96=DNI, 99=CF
  docNro  = '0',
  importe,
  concepto = 1,               // 1=productos
  condFiscalReceptor = 'CF',  // CF=5, RI=1, MONO=6, EX=4
} = {}) => {
  const env = getEnv()
  try {
    const ta     = await authenticate(env)
    const client = await getSoapClient('wsfev1', env)
    const pv     = getPtoVta()
    const cuitN  = parseInt(CUIT, 10)

    const [lastRes] = await client.FECompUltimoAutorizadoAsync({
      Auth: { Token: ta.token, Sign: ta.sign, Cuit: cuitN },
      PtoVta: pv, CbteTipo: tipoComprobante,
    })
    const ultimo = lastRes?.FECompUltimoAutorizadoResult?.CbteNro ?? 0
    const cbteNro = ultimo + 1
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')

    const total = Math.round(Number(importe) * 100) / 100
    const needsIva = tipoComprobante === 1 || (tipoComprobante === 6 && docTipo === 80)
    let impNeto = total, impIva = 0

    if (needsIva) {
      impNeto = Math.round((total / 1.21) * 100) / 100
      impIva  = Math.round((total - impNeto) * 100) / 100
    }

    // CndIVARec: condición frente al IVA del receptor (obligatorio desde 01/06/2026)
    // 1=RI, 4=Exento, 5=CF/DNI, 6=Monotributista
    let cndIVARec = 5 // default: Consumidor Final / DNI
    if (tipoComprobante === 1) {
      cndIVARec = 1 // Factura A: siempre RI
    } else if (docTipo === 80) {
      if (condFiscalReceptor === 'RI')   cndIVARec = 1
      else if (condFiscalReceptor === 'MONO') cndIVARec = 6
      else if (condFiscalReceptor === 'EX')   cndIVARec = 4
      else cndIVARec = 1
    }

    const det = {
      Concepto: concepto,
      DocTipo:  docTipo,
      DocNro:   parseInt(docNro, 10) || 0,
      CbteDesde: cbteNro, CbteHasta: cbteNro,
      CbteFch:   today,
      ImpTotal:  total, ImpTotConc: 0,
      ImpNeto:   impNeto, ImpOpEx: 0,
      ImpIVA:    impIva,  ImpTrib:  0,
      MonId: 'PES', MonCotiz: 1,
      CndIVARec: cndIVARec,
    }
    if (impIva > 0) det.Iva = { AlicIva: { Id: 5, BaseImp: impNeto, Importe: impIva } }

    console.log('[AFIP] FECAESolicitar request:', JSON.stringify({
      env, pv, cuitN, tipoComprobante, docTipo, docNro,
      total, impNeto, impIva, cbteNro,
    }, null, 2))

    const soapResult = await client.FECAESolicitarAsync({
      Auth: { Token: ta.token, Sign: ta.sign, Cuit: cuitN },
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta: pv, CbteTipo: tipoComprobante },
        FeDetReq: { FECAEDetRequest: det },
      },
    })

    // Log full raw response before any processing — critical for debugging structure
    console.log('[AFIP] FECAESolicitar soapResult completo:', JSON.stringify(soapResult, null, 2))

    // node-soap may return [result, raw, soapHeader, rawRequest] or just the result object.
    // Try both the first array element and the object itself.
    const toArr = (x) => !x ? [] : Array.isArray(x) ? x : [x]
    const res0 = Array.isArray(soapResult) ? soapResult[0] : soapResult

    // FECAESolicitarResult may be directly on res0 or wrapped in another object
    const r = res0?.FECAESolicitarResult ?? res0

    console.log('[AFIP] FECAESolicitarResult:', JSON.stringify(r, null, 2))

    // FeCabResp holds the global Resultado ('A' or 'R')
    const cabResultado = r?.FeCabResp?.Resultado

    // FECAEDetResponse can be an array or a single object
    const detArr = toArr(r?.FeDetResp?.FECAEDetResponse)
    const dr     = detArr[0]

    console.log('[AFIP] FeCabResp.Resultado:', cabResultado)
    console.log('[AFIP] FECAEDetResponse[0]:', JSON.stringify(dr, null, 2))

    const globalErrs = toArr(r?.Errors?.Err)
    const obsErrs    = dr ? toArr(dr?.Observaciones?.Obs) : []
    const events     = toArr(r?.Events?.Evt)

    if (globalErrs.length) console.error('[AFIP] Errors.Err:',        JSON.stringify(globalErrs))
    if (obsErrs.length)    console.error('[AFIP] Observaciones.Obs:', JSON.stringify(obsErrs))
    if (events.length)     console.log('[AFIP] Events.Evt:',          JSON.stringify(events))

    if (!dr) {
      const fmtItem = (x) => `[${x.Code ?? x.code ?? '?'}] ${x.Msg ?? x.msg ?? JSON.stringify(x)}`
      const lines = [...globalErrs.map(fmtItem), ...obsErrs.map(fmtItem)]
      throw new Error(lines.length
        ? lines.join('\n')
        : 'AFIP no devolvió FECAEDetResponse — revisá la consola del main process')
    }

    const detResultado = dr.Resultado ?? cabResultado
    if (detResultado !== 'A') {
      const fmtItem = (x) => `[${x.Code ?? x.code ?? '?'}] ${x.Msg ?? x.msg ?? JSON.stringify(x)}`
      const allLines = [...globalErrs.map(fmtItem), ...obsErrs.map(fmtItem)]
      console.error('[AFIP] Comprobante rechazado — Resultado:', detResultado)
      const msg = allLines.length
        ? allLines.join('\n')
        : `Comprobante rechazado por AFIP (Resultado: ${detResultado}) — revisá la consola del main process`
      throw new Error(msg)
    }

    return {
      ok: true,
      cae: String(dr.CAE),
      caeFchVto: String(dr.CAEFchVto),
      cbteNro, ptoVenta: pv,
      tipoComprobante, docTipo,
      docNro: String(docNro || 0),
    }
  } catch (e) {
    console.error('[AFIP] generarCAE error:', e.message)
    return { ok: false, error: e.message || String(e) }
  }
})
