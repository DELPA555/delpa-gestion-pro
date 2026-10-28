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

let appMode = 'standalone' // 'standalone' | 'server' | 'client' — define el arranque
let multiCajaServer = null

app.whenReady().then(() => {
  const mc = require('./multi-caja')
  mc.ensureToken()
  appMode = mc.getMode()

  // IPC común a TODOS los modos (ventana, shell local, config multi-caja).
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
  ipcMain.handle('shell:openPath', (_, p) => shell.openPath(p))
  mc.registerIpc(() => mainWindow)

  if (appMode === 'client') {
    bootClient(mc)
  } else {
    bootServerOrStandalone(mc, appMode)
  }

  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ── Modo CLIENTE: sin DB local; reenvía el IPC al servidor por LAN ───────────────
function bootClient(mc) {
  const { logTech } = tryLogTech()
  try { logTech?.('info', 'multicaja', `App iniciada en modo CLIENTE → servidor ${mc.getConfig().serverIp}:${mc.getConfig().serverPort}`) } catch {}

  // Handlers locales que NO se reenvían (el resto los registra startClient como proxy).
  require('./ipc/updater-manual') // updater:* — cada PC se actualiza sola
  ipcMain.handle('reset:relaunch', () => { setTimeout(() => { app.relaunch(); app.exit(0) }, 250); return true })

  const { startClient, checkConnectivity } = require('./client-mode')
  startClient({ ipcMain })

  // Verificar que el servidor esté accesible; avisar si no.
  checkConnectivity().then((r) => {
    if (!r.ok) {
      const cfg = mc.getConfig()
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Sin conexión con el servidor',
        message: `No se puede conectar al servidor ${cfg.serverIp}:${cfg.serverPort}.`,
        detail: `${r.error || ''}\n\nVerificá que la PC servidora esté encendida y en la misma red. Podés revisar la configuración en Configuración → Multi-caja.`,
        buttons: ['Entendido'],
      }).catch(() => {})
    }
  }).catch(() => {})
}

function tryLogTech() {
  try { return { logTech: require('./ipc/techLogs').logTech } } catch { return {} }
}

// ── Modo SERVIDOR / STANDALONE: DB local + todos los handlers + tareas de fondo ──
function bootServerOrStandalone(mc, mode) {
  const { initDB } = require('../database/db')
  initDB()

  // Logs técnicos: capturar errores no atrapados de todo el proceso principal
  try {
    const { logTech } = require('./ipc/techLogs')
    process.on('uncaughtException', (e) => { try { logTech('error', 'app', 'uncaughtException: ' + (e?.message || e), e?.stack) } catch {} })
    process.on('unhandledRejection', (e) => { try { logTech('error', 'app', 'unhandledRejection: ' + (e?.message || e), e?.stack) } catch {} })
    const pkg = require('../package.json')
    logTech('info', 'app', `App iniciada v${pkg.version} (${isDev ? 'dev' : 'prod'}) — modo ${mode}`)
  } catch {}

  // En modo servidor capturamos cada handler IPC (channel → fn) para poder exponerlo
  // por HTTP. Envolvemos ipcMain.handle ANTES de registrar los módulos y lo restauramos
  // después. En standalone el registro queda sin usar (sin costo).
  const handlerRegistry = new Map()
  const origHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, fn) => { handlerRegistry.set(channel, fn); return origHandle(channel, fn) }

  require('./ipc/dashboard')
  require('./ipc/products')
  require('./ipc/sales')
  require('./ipc/clients')
  require('./ipc/accounts')
  require('./ipc/suppliers')
  require('./ipc/purchases')
  require('./ipc/cashbox')
  require('./ipc/maincashbox')
  require('./ipc/expenses')
  require('./ipc/reports')
  require('./ipc/invoices')
  require('./ipc/audit')
  require('./ipc/settings')
  require('./ipc/orders')
  require('./ipc/sucursales')
  require('./ipc/network')
  require('./ipc/techLogs')
  require('./ipc/email')
  require('./ipc/afip')
  require('./ipc/inventory')
  require('./ipc/tiendanube')
  require('./ipc/auth')
  require('./ipc/license')
  require('./ipc/exchanges')
  require('./ipc/senas')
  require('./ipc/credits')
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
  require('./ipc/supplierStock')
  require('./ipc/stockReport')
  require('./ipc/valuation')
  require('./ipc/informes')
  require('./ipc/onboarding')
  require('./ipc/changeTickets')
  require('./ipc/pausedsales')
  require('./ipc/training')
  require('./ipc/reset')
  ipcMain.handle = origHandle // fin de la captura del registro de handlers

  const { runPointsExpiry } = require('./ipc/pointsMaintenance')
  try { runPointsExpiry() } catch (e) { console.error('[POINTS] expiry on startup:', e.message) }
  try { require('./ipc/credits').recalcAllOverdueCredits() } catch (e) { console.error('[CREDITS] recalc on startup:', e.message) }
  const { performBackup } = require('./ipc/googledrive')
  require('./ipc/weeklySummary')            // mantiene los canales legacy weeklySummary:send/monthlySummary:send
  const { scheduleInformes } = require('./ipc/informes')
  const { pingDistributor } = require('./lib/distributorPing')

  setupDailyBackup()
  scheduleInformes()
  setTimeout(pingDistributor, 30 * 1000)
  // Ping (telemetría + snapshot de stock para la red de locales) cada 15 min
  setInterval(pingDistributor, 15 * 60 * 1000)
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

  // Modo SERVIDOR: exponer los handlers por LAN (ver server-mode.js).
  if (mode === 'server') {
    try {
      const { startServer } = require('./server-mode')
      const pkg = require('../package.json')
      const cfg = mc.getConfig()
      multiCajaServer = startServer({
        port: cfg.serverPort,
        getToken: () => mc.getConfig().token,
        handlerRegistry,
        version: pkg.version,
        onLog: (m) => { try { require('./ipc/techLogs').logTech('info', 'multicaja', m) } catch {} },
      })
      mc.setServerRunning(true)
    } catch (e) {
      try { require('./ipc/techLogs').logTech('error', 'multicaja', 'No se pudo iniciar el servidor: ' + e.message) } catch {}
    }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

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
