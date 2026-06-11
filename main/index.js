const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = !app.isPackaged

let mainWindow
let isUpdating = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#070707',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'))
  }

  mainWindow.on('maximize', () =>
    mainWindow.webContents.send('window:maximized', true)
  )
  mainWindow.on('unmaximize', () =>
    mainWindow.webContents.send('window:maximized', false)
  )
}

app.whenReady().then(() => {
  const { initDB } = require('../database/db')
  initDB()

  require('./ipc/dashboard')
  require('./ipc/products')
  require('./ipc/sales')
  require('./ipc/clients')
  require('./ipc/accounts')
  require('./ipc/suppliers')
  require('./ipc/purchases')
  require('./ipc/cashbox')
  require('./ipc/expenses')
  require('./ipc/reports')
  require('./ipc/invoices')
  require('./ipc/audit')
  require('./ipc/settings')
  require('./ipc/orders')
  require('./ipc/sucursales')
  require('./ipc/email')
  require('./ipc/afip')
  require('./ipc/inventory')
  require('./ipc/tiendanube')
  require('./ipc/auth')
  require('./ipc/license')
  require('./ipc/exchanges')
  require('./ipc/senas')
  require('./ipc/sellers')
  require('./ipc/mercadopago')
  require('./ipc/stockentries')
  require('./ipc/waitlist')
  require('./ipc/remitos')
  require('./ipc/fixedcosts')
  require('./ipc/stockegresos')
  require('./ipc/supplierorders')
  require('./ipc/updater-manual')
  require('./ipc/backup')
  require('./ipc/fiscal')
  require('./ipc/changelog')
  require('./ipc/intelligence')
  require('./ipc/vouchers')
  require('./ipc/consignment')
  require('./ipc/ivabook')
  require('./ipc/cashflow')
  require('./ipc/breakeven')
  require('./ipc/supplieranalytics')
  require('./ipc/onboarding')
  const { performBackup } = require('./ipc/googledrive')
  const { scheduleWeeklySummary } = require('./ipc/weeklySummary')

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
  ipcMain.handle('shell:openPath', (_, p) => shell.openPath(p))

  createWindow()
  setupAutoUpdater()
  setupDailyBackup()
  scheduleWeeklySummary()
  setTimeout(pingDistributor, 30 * 1000)
  setInterval(pingDistributor, 24 * 60 * 60 * 1000)
  setInterval(() => { try { performBackup() } catch {} }, 24 * 60 * 60 * 1000)

  // TN auto-sync every 10 minutes + immediate sync on startup
  const TN_INTERVAL = 10 * 60 * 1000
  const runTnSync = () => {
    try { const { autoSync } = require('./ipc/tiendanube'); autoSync() } catch {}
  }
  setTimeout(runTnSync, 20 * 1000) // initial sync 20s after launch (window ready)
  setInterval(runTnSync, TN_INTERVAL)

  app.on('before-quit', async (e) => {
    if (isUpdating) return // electron-updater maneja el reinicio
    e.preventDefault()
    try { await performBackup() } catch {}
    app.exit(0)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const PING_URL = 'https://script.google.com/macros/s/AKfycbxZfzVmml8GljdWS4Pw7MuHiXJF9nJgLw0ipXfXqf6u1_kzQMGCvvaLgYCNB8xp848n/exec'

function getLicenseData(db) {
  const TRIAL_DAYS = 20
  const licRow = db.prepare("SELECT value FROM settings WHERE key='license_code'").get()
  const expiryRow = db.prepare("SELECT value FROM settings WHERE key='license_expiry'").get()
  if (licRow?.value && expiryRow?.value) {
    const expiryDate = expiryRow.value
    const expMs = new Date(
      expiryDate.slice(0, 4) + '-' + expiryDate.slice(4, 6) + '-' + expiryDate.slice(6, 8)
    ).getTime()
    const daysLeft = Math.ceil((expMs - Date.now()) / 86400000)
    return { licenseStatus: daysLeft >= 0 ? 'active' : 'expired', daysLeft: Math.max(0, daysLeft) }
  }
  const instRow = db.prepare("SELECT value FROM settings WHERE key='license_installed_at'").get()
  if (instRow?.value) {
    const daysPassed = Math.floor((Date.now() - new Date(instRow.value).getTime()) / 86400000)
    const daysLeft = Math.max(0, TRIAL_DAYS - daysPassed)
    return { licenseStatus: daysLeft > 0 ? 'trial' : 'expired', daysLeft }
  }
  return { licenseStatus: 'trial', daysLeft: TRIAL_DAYS }
}

function pingDistributor() {
  try {
    const db = require('../database/db').getDB()
    const { getHardwareId } = require('./ipc/license')
    const hardwareId = getHardwareId()
    const bizRow = db.prepare("SELECT value FROM settings WHERE key='business_name'").get()
    const lastSale = db.prepare("SELECT created_at FROM sales ORDER BY id DESC LIMIT 1").get()
    const { licenseStatus, daysLeft } = getLicenseData(db)
    const pkg = require('../package.json')

    const payload = {
      hardwareId,
      businessName: bizRow?.value || 'DELPA',
      licenseStatus,
      daysLeft,
      version: pkg.version || '1.0.0',
      lastSale: lastSale ? lastSale.created_at : null,
    }

    const https = require('https')
    const body = JSON.stringify(payload)
    const parsedUrl = new URL(PING_URL)
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    })
    req.on('error', () => {})
    req.write(body)
    req.end()
  } catch {}
}

function setupAutoUpdater() {
  if (isDev) return // solo en producción

  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null // sin logs en consola

    autoUpdater.on('update-available', (info) => {
      // Si fue disparado desde el botón manual de Settings, descargamos directo
      const updaterState = require('./ipc/updater-manual')
      if (updaterState.manualMode) {
        updaterState.manualMode = false
        mainWindow?.webContents.send('updater:status', { type: 'downloading', version: info.version })
        autoUpdater.downloadUpdate()
        return
      }
      // Verificación automática al inicio: mostrar dialog de confirmación
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: 'Nueva versión disponible',
        message: `DELPA Gestión PRO v${info.version} disponible`,
        detail: 'Hay una actualización lista para descargar. ¿Querés actualizar ahora?',
        buttons: ['Actualizar ahora', 'Después'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice === 0) {
        mainWindow?.webContents.send('updater:status', { type: 'downloading', version: info.version })
        autoUpdater.downloadUpdate()
      }
    })

    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('updater:progress', { percent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('updater:status', { type: 'downloaded' })
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: 'Actualización lista',
        message: 'La actualización fue descargada exitosamente',
        detail: 'La aplicación se reiniciará para aplicar la actualización.',
        buttons: ['Reiniciar ahora', 'Más tarde'],
        defaultId: 0,
        cancelId: 1,
      })
      if (choice === 0) {
        try {
          const buDir = path.join(app.getPath('userData'), 'backups')
          if (!fs.existsSync(buDir)) fs.mkdirSync(buDir, { recursive: true })
          const src = path.join(app.getPath('userData'), 'gestion.db')
          if (fs.existsSync(src)) {
            const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
            fs.copyFileSync(src, path.join(buDir, `gestion_pre-update_${stamp}.db`))
          }
        } catch {}
        isUpdating = true
        autoUpdater.quitAndInstall()
      }
    })

    autoUpdater.on('error', () => {}) // silencioso

    // Verificar 8 segundos después del inicio para no bloquear la carga
    setTimeout(() => {
      try { autoUpdater.checkForUpdates() } catch {}
    }, 8000)
  } catch {}
}

function setupDailyBackup() {
  const backupDir = path.join(app.getPath('userData'), 'backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

  function doBackup() {
    const src = path.join(app.getPath('userData'), 'gestion.db')
    if (!fs.existsSync(src)) return
    const date = new Date().toISOString().split('T')[0]
    const dest = path.join(backupDir, `gestion_${date}.db`)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest)
      const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort()
      if (files.length > 30)
        files.slice(0, files.length - 30).forEach(f =>
          fs.unlinkSync(path.join(backupDir, f))
        )
    }
  }

  doBackup()
  setInterval(doBackup, 24 * 60 * 60 * 1000)
}
