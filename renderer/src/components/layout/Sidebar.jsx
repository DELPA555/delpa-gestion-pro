import { useState, useEffect, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard, ShoppingCart, Package, Users, CreditCard,
  Truck, ShoppingBag, Wallet, Receipt, BarChart3, FileText, Shield, Settings, ClipboardList, Store, ClipboardCheck, LogOut, HandCoins, PackagePlus, FileBox, PackageMinus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAuth } from '@/context/AuthContext'

const NAV_ADMIN = [
  { to: '/dashboard',    label: 'Dashboard',       Icon: LayoutDashboard },
  { to: '/ventas',       label: 'Ventas',           Icon: ShoppingCart },
  { to: '/productos',    label: 'Productos',        Icon: Package },
  { to: '/clientes',     label: 'Clientes',         Icon: Users },
  { to: '/cuentas',      label: 'Cuentas Ctes.',    Icon: CreditCard },
  { to: '/proveedores',  label: 'Proveedores',      Icon: Truck },
  { to: '/compras',      label: 'Compras',          Icon: ShoppingBag },
  { to: '/caja',         label: 'Caja',             Icon: Wallet },
  { to: '/gastos',       label: 'Gastos',           Icon: Receipt },
  { to: '/reportes',     label: 'Reportes',         Icon: BarChart3 },
  { to: '/facturacion',  label: 'Facturación',      Icon: FileText },
  { to: '/auditoria',    label: 'Auditoría',        Icon: Shield },
  { to: '/pedidos',      label: 'Pedidos',          Icon: ClipboardList },
  { to: '/senas',        label: 'Señas',            Icon: HandCoins },
  { to: '/sucursales',   label: 'Sucursales',       Icon: Store },
  { to: '/inventario',   label: 'Inventario',       Icon: ClipboardCheck },
  { to: '/ingreso',      label: 'Ing. Mercadería',  Icon: PackagePlus },
  { to: '/egresos',      label: 'Egr. Mercadería',  Icon: PackageMinus },
  { to: '/remitos',      label: 'Remitos',          Icon: FileBox },
  { to: '/configuracion', label: 'Configuración',   Icon: Settings },
]

const NAV_VENDEDOR = [
  { to: '/ventas',   label: 'Ventas',   Icon: ShoppingCart },
  { to: '/clientes', label: 'Clientes', Icon: Users },
  { to: '/caja',     label: 'Caja',     Icon: Wallet },
  { to: '/pedidos',  label: 'Pedidos',  Icon: ClipboardList },
  { to: '/senas',    label: 'Señas',    Icon: HandCoins },
]

export default function Sidebar() {
  const { user, logout } = useAuth()
  const NAV = user?.role === 'admin' ? NAV_ADMIN : NAV_VENDEDOR
  const [biz, setBiz] = useState({ name: 'DELPA', logo: '' })
  const [tnOrderCount, setTnOrderCount] = useState(0)
  const [senasPending, setSenasPending] = useState(0)
  const [waitlistPending, setWaitlistPending] = useState(0)

  const loadBiz = useCallback(async () => {
    try {
      const all = await api.settings.getAll()
      setBiz({ name: all.business_name || 'DELPA', logo: all.business_logo || '' })
    } catch {}
  }, [])

  const checkTnOrders = useCallback(async () => {
    try {
      const status = await api.tn.status()
      if (!status?.connected) { setTnOrderCount(0); return }
      const res = await api.tn.getOrders({ status: 'open' })
      setTnOrderCount((res?.orders || []).length)
    } catch { setTnOrderCount(0) }
  }, [])

  useEffect(() => {
    loadBiz()
    checkTnOrders()
    api.senas.pending().then(n => setSenasPending(n || 0)).catch(() => {})
    api.waitlist.pending().then(n => setWaitlistPending(n || 0)).catch(() => {})
    const unsubSettings = window.electron.on('settings:changed', loadBiz)
    const unsubTn = window.electron.on('tn:status', () => checkTnOrders())
    const unsubWaitlist = window.electron.on('waitlist:count', n => setWaitlistPending(n || 0))
    return () => { unsubSettings(); unsubTn(); unsubWaitlist() }
  }, [loadBiz, checkTnOrders])

  return (
    <aside className="flex flex-col w-52 h-full shrink-0 bg-gradient-to-b from-[#0d0d0d] to-[#070707] border-r border-border">
      {/* Logo / Business header */}
      <div className="px-4 py-4 border-b border-border">
        {biz.logo ? (
          <img src={biz.logo} alt="logo" className="h-8 w-auto object-contain mb-1" />
        ) : (
          <>
            <div className="text-white font-bold text-base tracking-tight">{biz.name}</div>
            <div className="text-[11px] text-zinc-600 mt-0.5 tracking-widest uppercase">Gestión PRO</div>
          </>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="block">
            {({ isActive }) => (
              <motion.div
                whileHover={{ x: 2 }}
                transition={{ duration: 0.1 }}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors border-l-2',
                  isActive
                    ? 'bg-gradient-to-r from-accent/15 to-transparent border-accent text-accent font-semibold'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] border-transparent'
                )}
              >
                <Icon
                  size={15}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={isActive ? 'text-accent' : ''}
                />
                {label}
                {to === '/ventas' && tnOrderCount > 0 && (
                  <span className="ml-auto text-[10px] bg-accent text-black font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                    {tnOrderCount > 9 ? '9+' : tnOrderCount}
                  </span>
                )}
                {to === '/senas' && senasPending > 0 && (
                  <span className="ml-auto text-[10px] bg-amber-400 text-black font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                    {senasPending > 9 ? '9+' : senasPending}
                  </span>
                )}
                {to === '/pedidos' && waitlistPending > 0 && (
                  <span className="ml-auto text-[10px] bg-purple-500 text-white font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                    {waitlistPending > 9 ? '9+' : waitlistPending}
                  </span>
                )}
              </motion.div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-border space-y-1">
        <div className="text-[10px] text-zinc-600 truncate">{user?.username} · {user?.role === 'admin' ? 'Admin' : 'Vendedor'}</div>
        <button
          onClick={logout}
          className="flex items-center gap-2 text-[11px] text-zinc-600 hover:text-red-400 transition-colors no-drag w-full"
        >
          <LogOut size={11} /> Cerrar sesión
        </button>
        <div className="text-[10px] text-zinc-700">v1.1.5 · DELPA</div>
      </div>
    </aside>
  )
}
