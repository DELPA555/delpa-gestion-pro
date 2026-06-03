import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Toaster } from 'sonner'
import { useEffect, useRef, useState, useCallback, Component } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import ActivationScreen from './pages/ActivationScreen'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import Sales from './pages/Sales'
import Clients from './pages/Clients'
import Accounts from './pages/Accounts'
import Suppliers from './pages/Suppliers'
import Purchases from './pages/Purchases'
import CashBox from './pages/CashBox'
import Expenses from './pages/Expenses'
import Reports from './pages/Reports'
import Invoices from './pages/Invoices'
import Audit from './pages/Audit'
import Settings from './pages/Settings'
import Orders from './pages/Orders'
import Sucursales from './pages/Sucursales'
import Inventory from './pages/Inventory'
import Senas from './pages/Senas'
import StockEntry from './pages/StockEntry'
import Remitos from './pages/Remitos'
import SetupWizard from './pages/SetupWizard'
import { api } from './lib/api'
import { toast } from 'sonner'

class PageErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e) { console.error('[PageErrorBoundary]', e) }
  render() {
    if (this.state.error) {
      return (
        <div className="p-10 text-center space-y-3">
          <p className="text-red-400 font-bold text-sm">Error al cargar la página</p>
          <p className="text-zinc-500 text-xs font-mono">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ error: null })}
            className="text-xs text-accent hover:underline">Reintentar</button>
        </div>
      )
    }
    return this.props.children
  }
}

const VENDEDOR_ROUTES = ['/ventas', '/clientes', '/caja', '/pedidos', '/senas']
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutos

function AnimatedRoutes() {
  const location = useLocation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Navigate to="/ventas" replace />} />
        <Route path="/ventas"       element={<PageErrorBoundary><Sales /></PageErrorBoundary>} />
        <Route path="/clientes"     element={<PageErrorBoundary><Clients /></PageErrorBoundary>} />
        <Route path="/caja"         element={<PageErrorBoundary><CashBox /></PageErrorBoundary>} />
        <Route path="/pedidos"      element={<PageErrorBoundary><Orders /></PageErrorBoundary>} />
        <Route path="/senas"        element={<PageErrorBoundary><Senas /></PageErrorBoundary>} />
        {isAdmin && <>
          <Route path="/dashboard"    element={<PageErrorBoundary><Dashboard /></PageErrorBoundary>} />
          <Route path="/productos"    element={<PageErrorBoundary><Products /></PageErrorBoundary>} />
          <Route path="/cuentas"      element={<PageErrorBoundary><Accounts /></PageErrorBoundary>} />
          <Route path="/proveedores"  element={<PageErrorBoundary><Suppliers /></PageErrorBoundary>} />
          <Route path="/compras"      element={<PageErrorBoundary><Purchases /></PageErrorBoundary>} />
          <Route path="/gastos"       element={<PageErrorBoundary><Expenses /></PageErrorBoundary>} />
          <Route path="/reportes"     element={<PageErrorBoundary><Reports /></PageErrorBoundary>} />
          <Route path="/facturacion"  element={<PageErrorBoundary><Invoices /></PageErrorBoundary>} />
          <Route path="/auditoria"    element={<PageErrorBoundary><Audit /></PageErrorBoundary>} />
          <Route path="/sucursales"   element={<PageErrorBoundary><Sucursales /></PageErrorBoundary>} />
          <Route path="/inventario"   element={<PageErrorBoundary><Inventory /></PageErrorBoundary>} />
          <Route path="/ingreso"      element={<PageErrorBoundary><StockEntry /></PageErrorBoundary>} />
          <Route path="/configuracion" element={<PageErrorBoundary><Settings /></PageErrorBoundary>} />
          <Route path="/remitos"      element={<PageErrorBoundary><Remitos /></PageErrorBoundary>} />
        </>}
        <Route path="*" element={<Navigate to="/ventas" replace />} />
      </Routes>
    </AnimatePresence>
  )
}

function SessionTimeoutWatcher() {
  const { user, logout } = useAuth()
  const lastActivity = useRef(Date.now())

  const resetTimer = useCallback(() => { lastActivity.current = Date.now() }, [])

  useEffect(() => {
    if (!user) return
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))

    const check = setInterval(() => {
      if (Date.now() - lastActivity.current > SESSION_TIMEOUT_MS) {
        logout()
      }
    }, 60_000)

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer))
      clearInterval(check)
    }
  }, [user, logout, resetTimer])

  return null
}

function AppContent() {
  const { user, loading, logout } = useAuth()
  const [licenseInfo, setLicenseInfo] = useState(null) // null = checking

  const checkLicense = useCallback(() => {
    api.license.status()
      .then(s => {
        setLicenseInfo(s)
        window.__licenseInfo = s
        window.dispatchEvent(new CustomEvent('license:updated', { detail: s }))
      })
      .catch(() => {
        const fallback = { status: 'trial', daysRemaining: 20 }
        setLicenseInfo(fallback)
        window.__licenseInfo = fallback
      })
  }, [])

  useEffect(() => { checkLicense() }, [checkLicense])

  useEffect(() => {
    const unsubStatus = window.electron.on('updater:status', ({ type, version }) => {
      if (type === 'downloading') {
        toast.loading(`Descargando v${version}...`, { id: 'updater', duration: Infinity })
      } else if (type === 'downloaded') {
        toast.success('Actualización descargada — reiniciando...', { id: 'updater', duration: 4000 })
      }
    })
    const unsubProgress = window.electron.on('updater:progress', ({ percent }) => {
      toast.loading(`Descargando actualización... ${percent}%`, { id: 'updater', duration: Infinity })
    })
    return () => { unsubStatus(); unsubProgress() }
  }, [])

  if (loading || licenseInfo === null) {
    return (
      <div className="h-screen w-screen bg-surface flex items-center justify-center">
        <div className="text-zinc-500 text-sm animate-pulse">Cargando...</div>
      </div>
    )
  }

  // Hard block: expired trial OR subscription expired > GRACE_DAYS
  if (licenseInfo.status === 'expired') {
    return (
      <ActivationScreen
        hardwareId={licenseInfo.hardwareId || ''}
        reason={licenseInfo.reason || 'subscription'}
        onActivated={checkLicense}
      />
    )
  }

  if (!user) return <Login />

  return (
    <SetupWizard>
    <HashRouter>
      <SessionTimeoutWatcher />
      <Layout licenseInfo={licenseInfo}>
        <AnimatedRoutes />
      </Layout>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: { background: '#141414', border: '1px solid #2a2a2a', color: '#f0f0f0' },
        }}
      />
    </HashRouter>
    </SetupWizard>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
