import { useState, useEffect, useCallback } from 'react'
import { Minus, Square, X, Maximize2, Cloud, CloudOff, Sun, Moon, ShieldAlert, ArrowUpCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'

function formatClock() {
  const now = new Date()
  const time = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  return `${time} · ${date}`
}

export default function TitleBar() {
  const [maximized,    setMaximized]    = useState(false)
  const [clock,        setClock]        = useState(formatClock())
  const [businessName, setBusinessName] = useState('DELPA Gestión PRO')
  const [syncStatus,   setSyncStatus]   = useState({ connected: null, lastBackupAt: null })
  const [licenseInfo,  setLicenseInfo]  = useState(null)
  const [updateInfo,   setUpdateInfo]   = useState(null) // { updateAvailable, latestVersion }
  const navigate = useNavigate()

  useEffect(() => {
    api.license.status().then(s => setLicenseInfo(s)).catch(() => {})
    const handler = (e) => setLicenseInfo(e.detail || null)
    window.addEventListener('license:updated', handler)
    return () => window.removeEventListener('license:updated', handler)
  }, [])

  const [theme, setTheme] = useState(() => {
    const t = localStorage.getItem('theme') || 'dark'
    document.documentElement.setAttribute('data-theme', t)
    return t
  })

  const loadName = useCallback(async () => {
    try {
      const name = await api.settings.get('business_name')
      if (name) setBusinessName(`${name} · Gestión PRO`)
    } catch {}
  }, [])

  const loadSync = useCallback(async () => {
    try {
      const s = await api.googledrive.status()
      setSyncStatus({ connected: s.connected, lastBackupAt: s.lastBackupAt })
    } catch {}
  }, [])

  useEffect(() => {
    const unsub = window.electron.on('window:maximized', (val) => setMaximized(val))
    return unsub
  }, [])

  useEffect(() => {
    const tick = () => setClock(formatClock())
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Verificar actualizaciones en background (una vez al arrancar)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await api.updater.checkManual()
        if (res?.ok && res.updateAvailable) setUpdateInfo(res)
      } catch {}
    }, 12000) // 12s después de arrancar
    return () => clearTimeout(t)
  }, [])

  // También escuchar el evento del auto-updater
  useEffect(() => {
    const unsub = window.electron.on('updater:status', ({ type, version }) => {
      if (type === 'available' || type === 'downloading') {
        setUpdateInfo(prev => prev || { updateAvailable: true, latestVersion: version })
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    loadName()
    loadSync()
    const unsubSettings = window.electron.on('settings:changed', loadName)
    const unsubSync = window.electron.on('sync:status', () => { loadSync() })
    const pollId = setInterval(loadSync, 30_000)
    return () => { unsubSettings(); unsubSync(); clearInterval(pollId) }
  }, [loadName, loadSync])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  const cloudState = (() => {
    if (syncStatus.connected === null || syncStatus.connected === undefined) return 'gray'
    if (!syncStatus.connected) return 'red'
    if (!syncStatus.lastBackupAt) return 'yellow'
    const diff = Date.now() - new Date(syncStatus.lastBackupAt).getTime()
    return diff < 24 * 60 * 60 * 1000 ? 'green' : 'yellow'
  })()

  const syncTitle = cloudState === 'gray'
    ? 'Google Drive: no conectado'
    : cloudState === 'green'
      ? `Backup reciente · ${new Date(syncStatus.lastBackupAt).toLocaleString('es-AR')}`
      : cloudState === 'yellow'
        ? syncStatus.lastBackupAt
          ? `Último backup: ${new Date(syncStatus.lastBackupAt).toLocaleString('es-AR')}`
          : 'Conectado — sin backup aún'
        : 'Google Drive desconectado'

  return (
    <div className="drag-region flex items-center justify-between h-9 bg-surface border-b border-border shrink-0 select-none">
      {/* Left: logo dot + name + clock */}
      <div className="flex items-center gap-2 px-4" style={{ pointerEvents: 'none' }}>
        <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
        <span className="text-xs font-medium text-zinc-300">{businessName}</span>
        <span className="text-xs text-zinc-600 ml-1">{clock}</span>
      </div>

      {/* Right: sync icon + window controls */}
      <div className="no-drag flex items-center h-full gap-1 pr-1">
        {/* License badge */}
        {licenseInfo?.status === 'active' && licenseInfo.daysRemaining !== null && licenseInfo.daysRemaining <= 30 && (
          <div
            title={`Licencia activa hasta ${licenseInfo.expiryDisplay || ''}`}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium mr-1 ${
              licenseInfo.daysRemaining <= 3
                ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                : licenseInfo.daysRemaining <= 7
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                : 'bg-accent/10 text-accent border border-accent/20'
            }`}
          >
            <ShieldAlert size={10} />
            Licencia: {licenseInfo.daysRemaining}d
          </div>
        )}
        {licenseInfo?.status === 'grace' && (
          <div
            title="Licencia vencida — período de gracia"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium mr-1 bg-red-500/15 text-red-400 border border-red-500/20"
          >
            <ShieldAlert size={10} />
            Gracia: {Math.max(0, 3 - (licenseInfo.daysOverdue || 0))}d
          </div>
        )}
        {licenseInfo?.status === 'trial' && licenseInfo.daysRemaining !== null && (
          <div
            title="Período de prueba activo"
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium mr-1 ${
              licenseInfo.daysRemaining <= 5
                ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
            }`}
          >
            <ShieldAlert size={10} />
            Trial: {licenseInfo.daysRemaining}d
          </div>
        )}
        {/* Cloud sync indicator */}
        <div title={syncTitle} className="px-2 flex items-center">
          {cloudState === 'green'
            ? <Cloud size={13} className="text-accent" />
            : cloudState === 'yellow'
              ? <Cloud size={13} className="text-amber-400" />
              : cloudState === 'red'
                ? <CloudOff size={13} className="text-red-500" />
                : <Cloud size={13} className="text-zinc-600" />
          }
        </div>

        {/* Botón actualización disponible */}
        {updateInfo?.updateAvailable && (
          <button
            onClick={() => navigate('/configuracion')}
            title={`Nueva versión v${updateInfo.latestVersion} disponible — click para actualizar`}
            className="relative w-10 h-9 flex items-center justify-center text-accent hover:bg-accent/10 transition-colors"
          >
            <ArrowUpCircle size={14} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent animate-ping" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent" />
          </button>
        )}

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          className="w-10 h-9 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <button
          onClick={() => window.electron.window.minimize()}
          className="w-10 h-9 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={() => window.electron.window.maximize()}
          className="w-10 h-9 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
        >
          {maximized ? <Square size={11} /> : <Maximize2 size={12} />}
        </button>
        <button
          onClick={() => window.electron.window.close()}
          className="w-10 h-9 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-red-600 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
