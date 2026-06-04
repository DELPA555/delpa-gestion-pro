const { ipcMain } = require('electron')
const fs = require('fs')
const { getDB } = require('../../database/db')

// Importar helpers compartidos con fiscal.js
const {
  CUIT, CERT_PATH, KEY_PATH,
  taCache, soapClients,
  getEnv, getPtoVta, clearAllCaches,
  getSoapClient, authenticate,
} = require('./afip-helpers')

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
