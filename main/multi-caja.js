/* Multi-caja / red local (v1.43.0) — configuración y helpers.
 *
 * Modelo: una PC es "servidor" (tiene la base SQLite y expone la API por LAN, ver
 * server-mode.js); las demás son "cliente" y reenvían sus llamadas IPC a esa PC
 * (ver client-mode.js). "standalone" = comportamiento clásico sin red.
 *
 * La config vive en electron-store ("multi-caja"), NO en la DB: es propia de cada
 * PC (qué rol cumple, a qué servidor apunta, qué número de caja es). El token es
 * un UUID que genera el servidor y el cliente ingresa a mano junto con la IP.
 */
const { ipcMain } = require('electron')
const os = require('os')
const http = require('http')
const crypto = require('crypto')
const Store = require('electron-store')

const store = new Store({ name: 'multi-caja' })

const DEFAULTS = { mode: 'standalone', serverIp: '', serverPort: 4242, token: '', numeroCaja: 1 }
const MODES = ['standalone', 'server', 'client']

function getConfig() {
  const c = store.get('config') || {}
  return { ...DEFAULTS, ...c }
}

function setConfig(partial) {
  const next = { ...getConfig(), ...(partial || {}) }
  if (!MODES.includes(next.mode)) next.mode = 'standalone'
  next.serverIp = String(next.serverIp || '').trim()
  next.serverPort = Number(next.serverPort) || 4242
  next.token = String(next.token || '').trim()
  next.numeroCaja = Math.max(1, Number(next.numeroCaja) || 1)
  store.set('config', next)
  return next
}

function getMode() { return getConfig().mode }
function getNumeroCaja() { return getConfig().numeroCaja }

// Si esta PC es servidor y todavía no tiene token, genera uno. Idempotente.
function ensureToken() {
  const c = getConfig()
  if (c.mode === 'server' && !c.token) return setConfig({ token: crypto.randomUUID() }).token
  return c.token
}

// IPs IPv4 no internas de esta PC (para mostrarle al usuario a qué IP conectar).
function getLocalIps() {
  const nets = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address)
    }
  }
  return ips
}

let _serverRunning = false
function setServerRunning(v) { _serverRunning = !!v }
function isServerRunning() { return _serverRunning }

// GET http://ip:port/ping → { ok, version } (sin token; sirve para descubrir).
function ping(ip, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: '/ping', timeout: timeoutMs }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => {
        try { const j = JSON.parse(body); resolve({ ok: !!j.ok, version: j.version, status: res.statusCode }) }
        catch { resolve({ ok: false, status: res.statusCode }) }
      })
    })
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
  })
}

// GET http://ip:port/auth-check con Bearer token → verifica que el token sea válido.
function authCheck(ip, port, token, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: ip, port, path: '/auth-check', timeout: timeoutMs, headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        res.on('data', () => {})
        res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode }))
      }
    )
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
  })
}

async function testConnection({ ip, port, token }) {
  ip = String(ip || '').trim()
  port = Number(port) || 4242
  if (!ip) return { ok: false, error: 'Falta la IP del servidor' }
  const p = await ping(ip, port)
  if (!p.ok) return { ok: false, error: p.error === 'timeout' ? 'No responde (timeout)' : `No se pudo conectar a ${ip}:${port}` }
  const a = await authCheck(ip, port, token)
  if (!a.ok) return { ok: false, error: a.status === 401 ? 'Token inválido' : 'Servidor alcanzable pero sin autorización', version: p.version }
  return { ok: true, version: p.version }
}

// Registra los canales IPC locales (electron-store, no se reenvían en modo cliente).
function registerIpc(getWin) {
  const snapshot = () => ({ ...getConfig(), localIps: getLocalIps(), serverRunning: isServerRunning() })

  ipcMain.handle('multicaja:get', () => snapshot())

  ipcMain.handle('multicaja:set', (_, partial) => {
    const next = setConfig(partial || {})
    // Si quedó en modo servidor sin token, generar uno.
    if (next.mode === 'server' && !next.token) setConfig({ token: crypto.randomUUID() })
    try { getWin?.()?.webContents.send('multicaja:changed') } catch {}
    return snapshot()
  })

  ipcMain.handle('multicaja:testConnection', (_, { ip, port, token } = {}) => testConnection({ ip, port, token }))

  ipcMain.handle('multicaja:regenToken', () => {
    const token = crypto.randomUUID()
    setConfig({ token })
    return token
  })
}

module.exports = {
  getConfig, setConfig, getMode, getNumeroCaja, ensureToken,
  getLocalIps, isServerRunning, setServerRunning,
  ping, authCheck, testConnection, registerIpc,
}
