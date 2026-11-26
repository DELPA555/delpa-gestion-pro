/* Backup en la nube (VPS) — v1.50.0.
 *
 * Sube un snapshot comprimido (gzip) de la base al servidor central (POST /backup/:slug)
 * y permite restaurar el último (GET /backup/:slug/latest). El :slug es el que asignó el
 * servidor en el ping (setting portal_central_slug).
 *
 * Automático: cada día, pasadas las 3am, si todavía no se hizo el backup del día, lo sube.
 * La restauración es DESTRUCTIVA (reemplaza la base local): antes copia la base actual a un
 * archivo .pre-restore y relanza la app. La confirmación la pide la UI.
 */
const { ipcMain, app } = require('electron')
const { getDB } = require('../../database/db')
const https = require('https')
const crypto = require('crypto')
const zlib = require('zlib')
const path = require('path')
const fs = require('fs')
const { PING_SECRET, CENTRAL_BASE } = require('../lib/centralPortalPing')

const DB_FILENAME = 'gestion.db'
function dbPath() { return path.join(app.getPath('userData'), DB_FILENAME) }
function getSetting(key) { try { return getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '' } catch { return '' } }
function setSetting(key, value) { try { getDB().prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(value)) } catch {} }
function slug() { return getSetting('portal_central_slug').trim() }

// ── HTTP ─────────────────────────────────────────────────────────────────────
function uploadBackup(sl, gzBuffer) {
  return new Promise((resolve, reject) => {
    const boundary = '----delpa' + crypto.randomBytes(8).toString('hex')
    const head = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="backup"; filename="db.sqlite.gz"\r\nContent-Type: application/gzip\r\n\r\n')
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n')
    const body = Buffer.concat([head, gzBuffer, tail])
    const u = new URL(CENTRAL_BASE + '/backup/' + encodeURIComponent(sl))
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, 'X-Delpa-Secret': PING_SECRET },
    }, (res) => {
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => { (res.statusCode >= 200 && res.statusCode < 300) ? resolve((() => { try { return JSON.parse(d || '{}') } catch { return { ok: true } } })()) : reject(new Error('HTTP ' + res.statusCode)) })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.write(body); req.end()
  })
}
function downloadLatest(sl) {
  return new Promise((resolve, reject) => {
    const u = new URL(CENTRAL_BASE + '/backup/' + encodeURIComponent(sl) + '/latest')
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'GET', timeout: 120000, headers: { 'X-Delpa-Secret': PING_SECRET } }, (res) => {
      if (res.statusCode === 404) return reject(new Error('Todavía no hay un backup en la nube.'))
      if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode))
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

// ── Lógica ───────────────────────────────────────────────────────────────────
async function doUpload() {
  const sl = slug()
  if (!sl) return { ok: false, error: 'Este equipo todavía no está registrado en el servidor (configurá un PIN de portal y esperá unos minutos).' }
  // Snapshot consistente (incluye WAL) con el backup nativo de better-sqlite3.
  const tmp = path.join(app.getPath('temp'), 'delpa-cloud-' + Date.now() + '.sqlite')
  try {
    await getDB().backup(tmp)
    const gz = zlib.gzipSync(fs.readFileSync(tmp))
    const r = await uploadBackup(sl, gz)
    setSetting('backup_cloud_last', new Date().toISOString())
    return { ok: true, savedAt: (r && r.savedAt) || new Date().toISOString() }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

ipcMain.handle('backup:upload', () => doUpload())

ipcMain.handle('backup:status', () => ({
  lastAt: getSetting('backup_cloud_last') || null,
  slug: slug() || null,
  configured: !!slug(),
}))

// DESTRUCTIVO: reemplaza la base local por el último backup de la nube y relanza.
ipcMain.handle('backup:download', async () => {
  const sl = slug()
  if (!sl) return { ok: false, error: 'Este equipo no está registrado en el servidor.' }
  try {
    const gz = await downloadLatest(sl)
    const dbBuffer = zlib.gunzipSync(gz)
    if (!dbBuffer || dbBuffer.length < 1000) return { ok: false, error: 'El backup descargado es inválido.' }
    const dbSrc = dbPath()
    // Resguardo de la base actual antes de pisarla.
    try { if (fs.existsSync(dbSrc)) fs.copyFileSync(dbSrc, dbSrc + '.pre-restore-' + Date.now()) } catch {}
    try { getDB().close() } catch {}
    fs.writeFileSync(dbSrc, dbBuffer)
    // Eliminar sidecars WAL/SHM viejos para que SQLite abra limpio la base restaurada.
    try { fs.unlinkSync(dbSrc + '-wal') } catch {}
    try { fs.unlinkSync(dbSrc + '-shm') } catch {}
    setTimeout(() => { app.relaunch(); app.exit(0) }, 800)
    return { ok: true, size: dbBuffer.length }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

// ── Backup automático diario (pasadas las 3am) ───────────────────────────────
function isBackedUpToday() {
  const last = getSetting('backup_cloud_last')
  if (!last) return false
  return String(last).slice(0, 10) === new Date().toISOString().slice(0, 10)
}
function maybeAutoBackup() {
  try {
    if (!slug()) return
    if (isBackedUpToday()) return
    if (new Date().getHours() < 3) return // esperar a pasadas las 3am
    doUpload().catch(() => {})
  } catch {}
}
function startAutoBackup() {
  // Chequea al arrancar (por si quedó pendiente de ayer) y cada 30 min.
  setTimeout(maybeAutoBackup, 60 * 1000)
  setInterval(maybeAutoBackup, 30 * 60 * 1000)
}

module.exports = { startAutoBackup, doUpload }
