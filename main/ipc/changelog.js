const { ipcMain, app } = require('electron')
const { getDB } = require('../../database/db')
const https = require('https')

const CHANGELOG_URL = 'https://raw.githubusercontent.com/DELPA555/delpa-gestion-pro/main/CHANGELOG.json'

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

    const changelog = await fetchJSON(CHANGELOG_URL)
    const entry = changelog[`v${version}`] || changelog[version]
    if (!entry) return { show: false }

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
    getDB().prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(vKey, '1')
    return { ok: true }
  } catch { return { ok: false } }
})
