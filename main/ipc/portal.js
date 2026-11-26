/* Portal web — handlers IPC (v1.47.0). Controlan el servidor de solo lectura y su
 * túnel de Cloudflare, y el PIN de acceso. Todo corre en la PC principal. */
const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')
const portal = require('../portal')

function setSetting(key, value) {
  getDB().prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(value))
}
function getSetting(key) {
  try { return getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '' } catch { return '' }
}

ipcMain.handle('portal:status', () => portal.portalStatus())

ipcMain.handle('portal:start', async () => {
  try { return await portal.startPortal() }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('portal:stop', async () => {
  try { return await portal.stopPortal() }
  catch (e) { return { ok: false, error: e.message } }
})

// PIN de 4 a 6 dígitos. Se guarda en settings (portal_pin).
ipcMain.handle('portal:setPin', (_e, pin) => {
  const p = String(pin || '').trim()
  if (!/^\d{4,6}$/.test(p)) return { ok: false, error: 'El PIN debe tener entre 4 y 6 dígitos.' }
  setSetting('portal_pin', p)
  // Pinguear YA al servidor central para que el enlace permanente aparezca enseguida
  // (y no haya que esperar al ciclo de 15 min). Fire-and-forget.
  try { require('../lib/centralPortalPing').pingNow(getDB()) } catch (e) { console.error('[portal:setPin] pingNow:', e.message) }
  return { ok: true }
})

ipcMain.handle('portal:getPin', () => ({ pin: getSetting('portal_pin'), hasPin: !!getSetting('portal_pin').trim() }))

// Dispara un ping inmediato al servidor central (p. ej. al cambiar la config de alertas).
ipcMain.handle('portal:pingNow', () => {
  try { require('../lib/centralPortalPing').pingNow(getDB()); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

module.exports = { stopPortalOnQuit: () => { try { return portal.stopPortal() } catch { return null } } }
