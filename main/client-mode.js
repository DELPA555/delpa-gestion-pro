/* Multi-caja / red local (v1.43.0) — modo CLIENTE.
 *
 * Esta PC NO abre DB local. Por cada canal IPC (salvo los LOCAL_CHANNELS) registra un
 * reenviador que hace POST http://<servidor>/invoke y devuelve el resultado. Como el
 * IPC renderer→main ya es asíncrono, el reenvío es async normal (sin hacks de HTTP
 * síncrono) y las transacciones corren atómicas allá, en el servidor.
 *
 * El renderer no cambia: invoca los mismos canales; solo que viajan por la red.
 */
const http = require('http')
const { CHANNELS, LOCAL_CHANNELS } = require('./lib/channels')
const mc = require('./multi-caja')

// POST JSON con Bearer token. Resuelve con el body parseado; rechaza en error de red
// o si el servidor responde con un status != 2xx (salvo el { error } de /invoke, que
// viene con 200 y se maneja arriba).
function postJson(ip, port, path, payload, token, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8')
    const req = http.request(
      {
        host: ip, port, path, method: 'POST', timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let body = ''
        res.on('data', (d) => { body += d })
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('Token inválido o no autorizado'))
          let json = null
          try { json = body ? JSON.parse(body) : {} } catch { return reject(new Error('Respuesta inválida del servidor')) }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json)
          reject(new Error(json?.error || `Error del servidor (HTTP ${res.statusCode})`))
        })
      }
    )
    req.on('timeout', () => { req.destroy(); reject(new Error('El servidor no respondió a tiempo')) })
    req.on('error', (e) => reject(new Error(`No se pudo contactar al servidor: ${e.message}`)))
    req.write(data)
    req.end()
  })
}

async function forward(channel, args) {
  const cfg = mc.getConfig()
  if (!cfg.serverIp) throw new Error('No hay servidor configurado (Configuración → Multi-caja)')
  const res = await postJson(cfg.serverIp, cfg.serverPort, '/invoke', { channel, args }, cfg.token)
  // Replicar ipcRenderer.invoke: un { error } del handler se re-lanza como Error.
  if (res && typeof res === 'object' && 'error' in res && !('result' in res)) {
    throw new Error(res.error)
  }
  return res ? res.result : null
}

/* Registra los reenviadores. Devuelve la lista de canales locales que index.js debe
 * registrar aparte (shell, updater, reset:relaunch, multicaja). */
function startClient({ ipcMain }) {
  for (const channel of CHANNELS) {
    if (LOCAL_CHANNELS.has(channel)) continue
    ipcMain.handle(channel, (_event, ...args) => {
      let fwdArgs = args
      // La caja de ORIGEN (este cliente) debe quedar registrada en la venta. El número
      // de caja es local (electron-store de esta PC), así que se inyecta en el payload
      // antes de enviarlo: el servidor no sabe desde qué caja se vende.
      if (channel === 'sales:create' && args[0] && typeof args[0] === 'object') {
        fwdArgs = [{ ...args[0], numeroCaja: mc.getNumeroCaja() }]
      }
      return forward(channel, fwdArgs)
    })
  }
}

// Verifica conectividad al arrancar. Devuelve { ok, version?, error? }.
async function checkConnectivity() {
  const cfg = mc.getConfig()
  return mc.testConnection({ ip: cfg.serverIp, port: cfg.serverPort, token: cfg.token })
}

module.exports = { startClient, checkConnectivity }
