/* Multi-caja / red local (v1.43.0) — modo SERVIDOR.
 *
 * Expone por LAN los MISMOS handlers IPC que usa el renderer local, mediante un
 * registro (channel → fn) capturado al registrar los módulos en index.js. Como los
 * handlers corren acá, con la DB local de esta PC, las transacciones de better-sqlite3
 * siguen siendo 100% atómicas (crear venta, cerrar caja, etc.): el cliente NO manda
 * SQL crudo, manda la OPERACIÓN. Ese es el diseño elegido sobre tunelizar SQL.
 *
 * Endpoints (Express, 0.0.0.0:puerto, solo LAN):
 *   GET  /ping        → { ok:true, version }                (sin auth; para descubrir)
 *   GET  /auth-check  → { ok:true, version }  | 401          (verifica el token)
 *   POST /invoke      → { channel, args } → { result } | { error }   (con auth)
 *
 * Auth: header Authorization: Bearer <token>. Token UUID generado en el servidor.
 */
const express = require('express')

// Evento IPC falso para los handlers. Ninguno usa event.sender (usan BrowserWindow),
// pero damos un sender no-op por las dudas para que nada reviente si lo llamaran.
const FAKE_EVENT = { sender: { send() {}, isDestroyed() { return true } } }

function startServer({ port = 4242, getToken, handlerRegistry, version = '', onLog } = {}) {
  const log = (m) => { try { onLog?.(m) } catch {} }
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  // Discovery (sin token): solo revela que hay un servidor y su versión.
  app.get('/ping', (_req, res) => res.json({ ok: true, version }))

  // Auth para todo lo demás.
  app.use((req, res, next) => {
    const token = (typeof getToken === 'function' ? getToken() : '') || ''
    const header = req.headers['authorization'] || ''
    const m = header.match(/^Bearer\s+(.+)$/i)
    if (!token || !m || m[1].trim() !== token) {
      return res.status(401).json({ error: 'No autorizado' })
    }
    next()
  })

  app.get('/auth-check', (_req, res) => res.json({ ok: true, version }))

  app.post('/invoke', async (req, res) => {
    const { channel, args } = req.body || {}
    if (!channel || typeof channel !== 'string') return res.status(400).json({ error: 'Falta channel' })
    const fn = handlerRegistry.get(channel)
    if (typeof fn !== 'function') return res.status(404).json({ error: `Canal desconocido: ${channel}` })
    const callArgs = Array.isArray(args) ? args : []
    try {
      const result = await fn(FAKE_EVENT, ...callArgs)
      res.json({ result: result === undefined ? null : result })
    } catch (e) {
      // El error del handler viaja como { error } con status 200: el cliente lo
      // re-lanza como Error en su proceso, replicando el comportamiento de ipcRenderer.invoke.
      log(`invoke ${channel} ERROR: ${(e && e.message) || e}`)
      res.json({ error: (e && e.message) || String(e) })
    }
  })

  const server = app.listen(port, '0.0.0.0', () => log(`Servidor multi-caja escuchando en 0.0.0.0:${port}`))
  server.on('error', (e) => log(`Error del servidor multi-caja (puerto ${port}): ${e.message}`))
  return server
}

module.exports = { startServer }
