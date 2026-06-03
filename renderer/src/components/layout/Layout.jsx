import { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'

function LicenseBanner({ licenseInfo }) {
  const [dismissed, setDismissed] = useState(false)
  const [info, setInfo] = useState(licenseInfo)

  useEffect(() => {
    setInfo(licenseInfo)
    setDismissed(false)
  }, [licenseInfo?.status, licenseInfo?.daysRemaining])

  useEffect(() => {
    const handler = (e) => { setInfo(e.detail); setDismissed(false) }
    window.addEventListener('license:updated', handler)
    return () => window.removeEventListener('license:updated', handler)
  }, [])

  if (dismissed) return null

  const status = info?.status
  const daysRemaining = info?.daysRemaining ?? 0

  // Grace period: subscription expired 1-3 days ago
  if (status === 'grace') {
    const overdue = info?.daysOverdue || 0
    const daysLeft = Math.max(0, 3 - overdue)
    return (
      <div className="bg-red-950/80 border-b border-red-500/30 px-4 py-2 flex items-center gap-3 shrink-0">
        <AlertTriangle size={14} className="text-red-400 shrink-0" />
        <p className="text-xs text-red-300 flex-1">
          <span className="font-semibold">Licencia vencida el {info.expiryDisplay}.</span>
          {' '}Período de gracia: {daysLeft} día{daysLeft !== 1 ? 's' : ''} restante{daysLeft !== 1 ? 's' : ''}.
          {' '}Contactá a tu proveedor para renovar.
        </p>
        <button onClick={() => setDismissed(true)} className="text-red-500 hover:text-red-300 shrink-0">
          <X size={13} />
        </button>
      </div>
    )
  }

  // Trial mode: only show warning when ≤ 7 days left
  if (status === 'trial' && daysRemaining <= 7) {
    const isUrgent = daysRemaining <= 3
    const cls = isUrgent
      ? 'bg-red-950/80 border-red-500/30 text-red-300'
      : 'bg-amber-950/80 border-amber-500/30 text-amber-300'
    return (
      <div className={`${cls} border-b px-4 py-2 flex items-center gap-3 shrink-0`}>
        <AlertTriangle size={14} className="shrink-0" />
        <p className="text-xs flex-1">
          <span className="font-semibold">Período de prueba: {daysRemaining} día{daysRemaining !== 1 ? 's' : ''} restante{daysRemaining !== 1 ? 's' : ''}.</span>
          {' '}Contactá a tu proveedor para activar una licencia.
        </p>
        <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
          <X size={13} />
        </button>
      </div>
    )
  }

  // Active subscription: warning at ≤ 7 days before expiry
  if (status === 'active' && daysRemaining <= 7) {
    const isUrgent = daysRemaining <= 3
    const cls = isUrgent
      ? 'bg-red-950/80 border-red-500/30 text-red-300'
      : 'bg-amber-950/80 border-amber-500/30 text-amber-300'
    return (
      <div className={`${cls} border-b px-4 py-2 flex items-center gap-3 shrink-0`}>
        <AlertTriangle size={14} className="shrink-0" />
        <p className="text-xs flex-1">
          <span className="font-semibold">Tu licencia vence en {daysRemaining} día{daysRemaining !== 1 ? 's' : ''}</span>
          {info?.expiryDisplay ? ` (${info.expiryDisplay})` : ''}.
          {' '}Contactá a tu proveedor para renovar.
        </p>
        <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
          <X size={13} />
        </button>
      </div>
    )
  }

  return null
}

export default function Layout({ children, licenseInfo }) {
  return (
    <div className="flex flex-col h-screen bg-surface overflow-hidden">
      <TitleBar />
      <LicenseBanner licenseInfo={licenseInfo} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
