// Red de locales (Fase 1): configuración del nodo + consulta de stock unificado.
// Cada instalación es un nodo independiente con su propia base SQLite. Se sincronizan
// entre sí por CUIT a través del Apps Script (mismo endpoint que la telemetría).
const { ipcMain } = require('electron')
const https = require('https')
const { getDB } = require('../../database/db')
const { pingDistributor, PING_URL } = require('../lib/distributorPing')
const { PING_SECRET, CENTRAL_BASE } = require('../lib/centralPortalPing')

function getSetting(key) {
  return getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || ''
}

function hwid() { try { return String(require('./license').getHardwareId() || '') } catch { return '' } }

// Request JSON al VPS (GET/POST) con el secreto compartido y timeout. Rechaza si falla.
function vpsRequest(method, pathUrl, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const u = new URL(CENTRAL_BASE + pathUrl)
    const data = body != null ? Buffer.from(JSON.stringify(body), 'utf8') : null
    const headers = { 'X-Delpa-Secret': PING_SECRET }
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length }
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, timeout: timeoutMs, headers }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode))
        try { resolve(d ? JSON.parse(d) : {}) } catch { reject(new Error('respuesta inválida')) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// Convierte la respuesta del VPS ({locales:[{...stock plano...}]}) al formato de nodos
// que espera la pantalla "Stock de red" (stock compacto {b,n,c,cat,s:[[talle,qty]]}).
function vpsLocalesToNodes(locales, thisHwid) {
  return (locales || []).map(loc => {
    const byProd = new Map()
    for (const it of (loc.stock || [])) {
      const key = (it.codigo && String(it.codigo).trim()) ? 'b:' + it.codigo : 'n:' + (it.nombre || '') + '|' + (it.color || '')
      let e = byProd.get(key)
      if (!e) { e = { b: it.codigo || '', n: it.nombre || '', c: it.color || '', cat: '', s: [] }; byProd.set(key, e) }
      e.s.push([it.talle, Number(it.cantidad) || 0])
    }
    return {
      hwid: loc.hwid, branchName: loc.branchName || '', branchType: '', version: '',
      updatedAt: loc.lastUpdate || '', stock: Array.from(byProd.values()),
    }
  })
}

// GET al Apps Script y parseo de JSON. Apps Script (/exec) responde con un
// redirect 302 a script.googleusercontent.com, así que hay que seguirlo.
function httpGetJson(url, timeoutMs = 20000, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn, arg) => { if (!done) { done = true; fn(arg) } }
    const req = https.get(url, (res) => {
      // Seguir redirects (301/302/303/307/308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume() // drenar el socket
        if (redirectsLeft <= 0) return finish(reject, new Error('Demasiados redirects'))
        const next = new URL(res.headers.location, url).toString()
        return httpGetJson(next, timeoutMs, redirectsLeft - 1).then(
          (v) => finish(resolve, v),
          (e) => finish(reject, e)
        )
      }
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { finish(resolve, JSON.parse(data)) }
        catch { finish(reject, new Error('Respuesta inválida del servidor de red')) }
      })
    })
    req.on('error', (e) => finish(reject, e))
    req.setTimeout(timeoutMs, () => { req.destroy(); finish(reject, new Error('Tiempo de espera agotado')) })
  })
}

// Estado del nodo local (para la pantalla de configuración).
ipcMain.handle('network:status', () => {
  const { getHardwareId } = require('../ipc/license')
  return {
    hardwareId: String(getHardwareId() || ''),
    cuit: getSetting('business_cuit').trim(),
    networkCode: getSetting('network_code').trim(),
    branchName: getSetting('branch_name').trim() || getSetting('business_name').trim(),
    branchType: getSetting('branch_type').trim(),
    shareStock: getSetting('branch_share_stock') !== '0',
    lastSyncAt: getSetting('network_last_sync') || null,
  }
})

// Fuerza una subida inmediata del stock/telemetría a la red.
ipcMain.handle('network:syncNow', () => {
  pingDistributor()
  return { ok: true, at: new Date().toISOString() }
})

// Consulta el stock unificado de todos los nodos con el mismo CUIT.
// Usa action=getNetwork (el script viejo ya tiene un getStock propio, el de Drive).
// Devuelve { ok, cuit, nodes:[{ hwid, branchName, branchType, version, updatedAt, stock:[...] }] }.
ipcMain.handle('network:getStock', async () => {
  // Se agrupa por "código de red" si está configurado (permite CUITs distintos);
  // si no, por CUIT (comportamiento clásico de la red de locales).
  const networkCode = getSetting('network_code').trim()
  const cuit = getSetting('business_cuit').trim()
  if (!networkCode && !cuit) {
    throw new Error('Configurá un "código de red" (Configuración → Red de locales) o el CUIT del negocio para usar la red de locales.')
  }
  const thisHwid = hwid()

  // 1) Primero el VPS propio (si hay código de red). Si falla o tarda >5s, caemos al
  //    Apps Script (fallback). El VPS devuelve stock plano → lo mapeamos a nodos.
  if (networkCode) {
    try {
      const r = await vpsRequest('GET', '/red/stock/' + encodeURIComponent(networkCode), null, 5000)
      const nodes = vpsLocalesToNodes(r && r.locales, thisHwid)
      // Si el VPS ya tiene datos, los usamos. Si viene vacío (todavía ningún local
      // sincronizó), caemos al Apps Script para no mostrar la red vacía en la migración.
      if (nodes.length) return { ok: true, cuit, networkCode, thisHwid, nodes, source: 'vps' }
    } catch (e) {
      try { require('./techLogs').logTech('warn', 'red', 'VPS no respondió el stock de red, uso Apps Script: ' + e.message) } catch {}
      // sigue al fallback de abajo
    }
  }

  // 2) Fallback: Apps Script (comportamiento clásico).
  // Con código de red (multi-CUIT) → getNetworkByCode&code=...; si no, el clásico por CUIT.
  const url = networkCode
    ? `${PING_URL}?action=getNetworkByCode&code=${encodeURIComponent(networkCode)}`
    : `${PING_URL}?action=getNetwork&cuit=${encodeURIComponent(cuit)}`
  let res
  try {
    res = await httpGetJson(url)
  } catch (e) {
    try { require('./techLogs').logTech('error', 'red', 'Error al consultar stock de la red: ' + e.message) } catch {}
    throw e
  }
  if (!res || res.ok === false) {
    const base = res?.error || 'No se pudo obtener el stock de la red.'
    // Si usa código de red y el Apps Script viejo no conoce getNetworkByCode, el error
    // típico es "No autorizado" o "cuit requerido": avisamos que hay que redeployarlo.
    if (networkCode) throw new Error(base + ' — Si usás código de red, actualizá (redeployá) el Apps Script a la última versión.')
    throw new Error(base)
  }
  return {
    ok: true,
    cuit,
    networkCode,
    thisHwid,
    nodes: Array.isArray(res.nodes) ? res.nodes : [],
    source: 'apps-script',
  }
})

// Sube el stock completo de este local al VPS (POST /red/stock/:networkCode).
// Delega en centralPortalPing.syncRedStock (la misma función del ciclo de 15 min).
ipcMain.handle('network:syncStock', async () => {
  return require('../lib/centralPortalPing').syncRedStock(getDB())
})

// Sube los precios de este local al VPS. Delega en centralPortalPing.syncRedPrecios.
ipcMain.handle('network:syncPrecios', async () => {
  return require('../lib/centralPortalPing').syncRedPrecios(getDB())
})

// Consulta los precios de red consolidados (GET /red/precios/:networkCode).
ipcMain.handle('network:getPrecios', async () => {
  const networkCode = getSetting('network_code').trim()
  if (!networkCode) return { ok: false, error: 'sin código de red', precios: [] }
  try {
    const r = await vpsRequest('GET', '/red/precios/' + encodeURIComponent(networkCode), null, 5000)
    return { ok: true, precios: Array.isArray(r.precios) ? r.precios : [] }
  } catch (e) { return { ok: false, error: e.message, precios: [] } }
})
