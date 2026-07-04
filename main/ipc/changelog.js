const { ipcMain, app } = require('electron')
const { getDB } = require('../../database/db')
const https = require('https')

const CHANGELOG_URL = 'https://raw.githubusercontent.com/DELPA555/delpa-releases/main/CHANGELOG.json'

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { reject(new Error('JSON inválido')) }
      })
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')))
  })
}

// Devuelve el changelog de la versión actual si no fue visto
ipcMain.handle('app:changelog', async () => {
  const version = app.getVersion()
  const vKey    = `changelog_seen_${version}`

  try {
    const db  = getDB()
    const seen = db.prepare("SELECT value FROM settings WHERE key=?").get(vKey)
    if (seen?.value === '1') return { show: false }

    let entry = null
    try {
      const changelog = await fetchJSON(CHANGELOG_URL)
      entry = changelog[`v${version}`] || changelog[version]
    } catch {
      // sin internet / JSON inválido → seguimos con fallback genérico
    }

    // Si no hay entrada (offline o versión no listada) mostramos igual un
    // aviso genérico: el objetivo es que el cartel llegue en cada actualización.
    if (!entry) {
      entry = {
        titulo: 'Nueva versión instalada',
        mejoras: [`Actualizaste DELPA Gestión PRO a la versión v${version}.`],
        correcciones: [],
      }
    }

    return { show: true, version, entry }
  } catch {
    return { show: false }
  }
})

// Marcar changelog como visto
ipcMain.handle('app:markChangelogSeen', () => {
  const version = app.getVersion()
  const vKey    = `changelog_seen_${version}`
  try {
    const db = getDB()
    const ins = db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)")
    ins.run(vKey, '1')
    ins.run('last_seen_version', version)
    return { ok: true }
  } catch { return { ok: false } }
})
