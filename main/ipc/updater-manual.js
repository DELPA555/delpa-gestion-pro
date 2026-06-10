const { ipcMain, app, shell } = require('electron')
const https = require('https')

// Flag compartido con setupAutoUpdater en main/index.js
// Cuando es true, update-available descarga directo sin dialog
const state = { manualMode: false }
module.exports = state

const REPO_API = 'https://api.github.com/repos/DELPA555/delpa-gestion-pro/releases/latest'

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path:     '/repos/DELPA555/delpa-gestion-pro/releases/latest',
      method:   'GET',
      headers:  { 'User-Agent': 'DELPA-Gestion-PRO-Updater', 'Accept': 'application/vnd.github.v3+json' },
      timeout:  10000,
    }
    const req = https.get(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error('Respuesta inválida de GitHub')) }
      })
    })
    req.on('error',   reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Tiempo de espera agotado')) })
  })
}

// ── updater:checkManual ───────────────────────────────────────────────────────

ipcMain.handle('updater:checkManual', async () => {
  const currentVersion = app.getVersion()
  try {
    const release    = await fetchLatestRelease()
    const latestTag  = release.tag_name || ''
    const latestVer  = latestTag.replace(/^v/, '')
    const updateAvailable = compareVersions(latestVer, currentVersion) > 0

    // Extraer changelog de body (markdown)
    const body = release.body || ''

    return {
      ok:              true,
      currentVersion,
      latestVersion:   latestVer,
      latestTag,
      updateAvailable,
      releaseUrl:      release.html_url || '',
      releaseName:     release.name     || `v${latestVer}`,
      releaseBody:     body,
      publishedAt:     release.published_at || '',
      isDraft:         release.draft     || false,
    }
  } catch (e) {
    return {
      ok:             false,
      currentVersion,
      error:          e.message || 'Error al verificar actualizaciones',
      updateAvailable: false,
    }
  }
})

// ── updater:openReleasePage ───────────────────────────────────────────────────

ipcMain.handle('updater:openReleasePage', (_, url) => {
  if (url && url.startsWith('https://github.com/')) {
    shell.openExternal(url)
  }
  return true
})

// ── updater:downloadAndInstall ────────────────────────────────────────────────
// downloadUpdate() requiere que checkForUpdates() haya corrido primero dentro
// del ciclo de electron-updater. La verificación manual usa HTTPS directo y
// bypasea ese estado interno, por eso hay que llamar checkForUpdates() acá.
// La flag manualMode hace que setupAutoUpdater omita el dialog de confirmación
// y descargue directo (el usuario ya confirmó desde la UI de Settings).

ipcMain.handle('updater:downloadAndInstall', async () => {
  try {
    const { autoUpdater } = require('electron-updater')
    state.manualMode = true
    await autoUpdater.checkForUpdates()
    // update-available se dispara durante checkForUpdates y si manualMode=true
    // setupAutoUpdater llama downloadUpdate() directamente (sin dialog)
    return { ok: true }
  } catch (e) {
    state.manualMode = false
    return { ok: false, error: e.message }
  }
})

// ── updater:getCurrentVersion ─────────────────────────────────────────────────

ipcMain.handle('updater:getCurrentVersion', () => app.getVersion())
