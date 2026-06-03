const { ipcMain, BrowserWindow, shell, app } = require('electron')
const { google } = require('googleapis')
const Store = require('electron-store')
const path = require('path')
const fs = require('fs')
const http = require('http')
const zlib = require('zlib')
const { pipeline } = require('stream/promises')

let CLIENT_ID = '', CLIENT_SECRET = ''
try {
  const creds = require('./gd-credentials')
  CLIENT_ID     = creds.CLIENT_ID     || ''
  CLIENT_SECRET = creds.CLIENT_SECRET || ''
} catch {
  CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || ''
  CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
}
const REDIRECT_PORT = 42813
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'email',
]

const store = new Store({ name: 'gdrive-tokens' })

// File-based log so we can diagnose from the installed app
function glog(msg) {
  try {
    const logPath = path.join(app.getPath('userData'), 'gdrive-debug.log')
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`, 'utf-8')
  } catch {}
}

function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
}

function sendSync(payload) {
  BrowserWindow.getAllWindows()[0]?.webContents.send('sync:status', payload)
}

function isAuthError(e) {
  const msg = (e?.message || '').toLowerCase()
  const code = e?.response?.data?.error || ''
  const status = e?.response?.status || e?.status || 0
  return msg.includes('invalid_grant') || msg.includes('token has been expired') ||
    msg.includes('token has been revoked') || msg.includes('insufficient') ||
    msg.includes('unauthorized') || msg.includes('authenticationerror') ||
    code === 'invalid_grant' || code === 'insufficientPermissions' ||
    code === 'insufficient_scope' || status === 401
}

function handleAuthError(e, context) {
  glog(`${context}: auth error — clearing tokens. ${e.message}`)
  store.clear()
  store.set('tokenInvalid', true)
  sendSync({ ok: false, email: null, lastBackupAt: null, tokenInvalid: true })
  BrowserWindow.getAllWindows()[0]?.webContents.send('notify:error',
    'Tu sesión de Google Drive no tiene los permisos necesarios. Reconectá en Configuración → Pagos & Drive.'
  )
}

// ── Auth ──────────────────────────────────────────────────────────────────────
ipcMain.handle('googledrive:auth', async () => {
  glog('AUTH: handler called')
  const oauth2Client = getOAuth2Client()
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })
  glog(`AUTH: authUrl generated, starting server on port ${REDIRECT_PORT}`)

  return new Promise((resolve, reject) => {
    let server
    const timeout = setTimeout(() => {
      glog('AUTH: timeout after 120s')
      server?.close()
      reject(new Error('Tiempo de espera agotado para autenticación'))
    }, 120_000)

    server = http.createServer(async (req, res) => {
      glog(`AUTH: HTTP request received: ${req.url}`)
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (error) {
        glog(`AUTH: error param received: ${error}`)
        res.end('<html><body><h2>Autenticación cancelada.</h2><p>Podés cerrar esta ventana.</p></body></html>')
        clearTimeout(timeout)
        server.close()
        reject(new Error('Autenticación cancelada por el usuario'))
        return
      }
      if (!code) {
        glog(`AUTH: no code in request, ignoring`)
        res.end('')
        return
      }

      glog(`AUTH: code received (length=${code.length}), sending ¡Conectado! page`)
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ ¡Conectado!</h2><p>Podés cerrar esta ventana y volver a DELPA.</p></body></html>')
      clearTimeout(timeout)
      server.close()

      try {
        glog('AUTH: calling getToken...')
        const { tokens } = await oauth2Client.getToken(code)
        glog(`AUTH: getToken OK, has refresh_token=${!!tokens.refresh_token}, has id_token=${!!tokens.id_token}`)

        oauth2Client.setCredentials(tokens)

        // Extract email from id_token JWT payload (no extra API call needed)
        let email = null
        if (tokens.id_token) {
          try {
            const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString())
            email = payload.email || null
            glog(`AUTH: email from id_token=${email}`)
          } catch (jwtErr) {
            glog(`AUTH: id_token parse error: ${jwtErr.message}`)
          }
        }

        store.set('tokens', tokens)
        store.set('email', email || '')
        store.delete('lastBackupAt')
        store.delete('tokenInvalid')
        glog(`AUTH: tokens saved to store, email=${email}`)

        sendSync({ ok: true, email, lastBackupAt: null })
        resolve({ email })
        glog('AUTH: resolved successfully')

        setTimeout(() => performBackup().catch((err) => {
          glog(`AUTH: auto-backup failed: ${err.message}`)
        }), 2000)
      } catch (e) {
        const detail = e.response?.data ? JSON.stringify(e.response.data) : ''
        glog(`AUTH: FAILED at token exchange: ${e.message} ${detail}`)
        reject(new Error(`Error al obtener token: ${e.message}`))
      }
    })

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      glog('AUTH: server listening, opening browser')
      shell.openExternal(authUrl)
    })
    server.on('error', (e) => {
      glog(`AUTH: server error: ${e.message}`)
      clearTimeout(timeout)
      reject(e)
    })
  })
})

// ── Status ────────────────────────────────────────────────────────────────────
ipcMain.handle('googledrive:status', () => {
  const tokens = store.get('tokens')
  if (!tokens) return { connected: false, email: null, lastBackupAt: null, tokenInvalid: store.get('tokenInvalid', false) }
  return {
    connected: true,
    email: store.get('email', null),
    lastBackupAt: store.get('lastBackupAt', null),
    tokenInvalid: false,
  }
})

// ── Disconnect ────────────────────────────────────────────────────────────────
ipcMain.handle('googledrive:disconnect', () => {
  store.clear()
  sendSync({ ok: false, email: null, lastBackupAt: null })
  return true
})

// ── Force clear tokens (fixes scope mismatch) ─────────────────────────────────
ipcMain.handle('googledrive:clearTokens', () => {
  store.clear()
  store.set('tokenInvalid', true)
  sendSync({ ok: false, email: null, lastBackupAt: null, tokenInvalid: true })
  return true
})

// ── Backup ────────────────────────────────────────────────────────────────────
async function performBackup() {
  const tokens = store.get('tokens')
  if (!tokens) { glog('BACKUP: no tokens, skipping'); return }

  glog('BACKUP: starting...')
  const oauth2Client = getOAuth2Client()
  oauth2Client.setCredentials(tokens)

  oauth2Client.on('tokens', (newTokens) => {
    const current = store.get('tokens', {})
    store.set('tokens', { ...current, ...newTokens })
  })

  const drive = google.drive({ version: 'v3', auth: oauth2Client })
  const userData = app.getPath('userData')
  const dbPath = path.join(userData, 'gestion.db')
  if (!fs.existsSync(dbPath)) { glog('BACKUP: gestion.db not found'); return }

  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16)
  const gzPath = path.join(userData, `gestion-${stamp}.db.gz`)

  try {
    glog('BACKUP: compressing DB...')

    await pipeline(
      fs.createReadStream(dbPath),
      zlib.createGzip({ level: 6 }),
      fs.createWriteStream(gzPath)
    )
    glog('BACKUP: compression OK')

    const folderSearch = await drive.files.list({
      q: "name='DELPA-Backup' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id)',
      pageSize: 1,
    })
    let folderId
    if (folderSearch.data.files.length > 0) {
      folderId = folderSearch.data.files[0].id
      glog(`BACKUP: found folder id=${folderId}`)
    } else {
      const folder = await drive.files.create({
        requestBody: { name: 'DELPA-Backup', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      })
      folderId = folder.data.id
      glog(`BACKUP: created folder id=${folderId}`)
    }

    glog('BACKUP: uploading file...')
    await drive.files.create({
      requestBody: { name: `gestion_${stamp}.db.gz`, parents: [folderId] },
      media: { mimeType: 'application/gzip', body: fs.createReadStream(gzPath) },
      fields: 'id',
    })
    glog('BACKUP: upload OK')

    const list = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,createdTime)',
      orderBy: 'createdTime asc',
      pageSize: 100,
    })
    const files = list.data.files
    if (files.length > 30) {
      const toDelete = files.slice(0, files.length - 30)
      await Promise.all(toDelete.map(f => drive.files.delete({ fileId: f.id })))
      glog(`BACKUP: deleted ${toDelete.length} old files`)
    }

    const lastBackupAt = now.toISOString()
    store.set('lastBackupAt', lastBackupAt)
    sendSync({ ok: true, email: store.get('email', null), lastBackupAt })
    glog(`BACKUP: done, lastBackupAt=${lastBackupAt}`)
    return { ok: true, lastBackupAt }

  } catch (e) {
    if (isAuthError(e)) { handleAuthError(e, 'BACKUP'); return { ok: false, error: 'session_expired' } }
    throw e
  } finally {
    try { fs.unlinkSync(gzPath) } catch {}
  }
}

ipcMain.handle('googledrive:backup', async () => {
  try {
    return await performBackup()
  } catch (e) {
    if (isAuthError(e)) { handleAuthError(e, 'BACKUP'); return { ok: false, error: 'session_expired' } }
    throw e
  }
})

module.exports = { performBackup }
