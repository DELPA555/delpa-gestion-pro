// Red de locales (Fase 1): configuración del nodo + consulta de stock unificado.
// Cada instalación es un nodo independiente con su propia base SQLite. Se sincronizan
// entre sí por CUIT a través del Apps Script (mismo endpoint que la telemetría).
const { ipcMain } = require('electron')
const https = require('https')
const { getDB } = require('../../database/db')
const { pingDistributor, PING_URL } = require('../lib/distributorPing')

function getSetting(key) {
  return getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || ''
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
  const cuit = getSetting('business_cuit').trim()
  if (!cuit) throw new Error('Configurá el CUIT del negocio en Configuración → Negocio para usar la red de locales.')
  const url = `${PING_URL}?action=getNetwork&cuit=${encodeURIComponent(cuit)}`
  let res
  try {
    res = await httpGetJson(url)
  } catch (e) {
    try { require('./techLogs').logTech('error', 'red', 'Error al consultar stock de la red: ' + e.message) } catch {}
    throw e
  }
  if (!res || res.ok === false) throw new Error(res?.error || 'No se pudo obtener el stock de la red.')
  const { getHardwareId } = require('../ipc/license')
  const thisHwid = String(getHardwareId() || '')
  return {
    ok: true,
    cuit,
    thisHwid,
    nodes: Array.isArray(res.nodes) ? res.nodes : [],
  }
})
