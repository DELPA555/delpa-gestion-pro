import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LineChart, Line, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, TrendingDown, ShoppingCart, Wallet, Users, RefreshCw,
  AlertTriangle, Brain, Target, Gauge as GaugeIcon, Package, Crown,
  MessageCircle, Globe, Cloud, Receipt, Sparkles, Archive, Clock, DollarSign,
  Ruler, PlusCircle, FileBarChart, PackagePlus, UserSearch, CheckCircle2, Activity,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { SkeletonPulse } from '@/components/shared/SkeletonLoader'
import OnboardingChecklist from '@/components/OnboardingChecklist'
import HelpTip from '@/components/Tooltip'
import { TOOLTIPS } from '@/lib/tourSteps'

const AR_TZ = 'America/Argentina/Buenos_Aires'

const PAYMENT_COLORS = {
  'Efectivo': '#22c55e',
  'Transferencia': '#3b82f6',
  'Mercado Pago': '#6366f1',
  'Mercado Pago QR': '#6366f1',
  'Tarjeta Crédito': '#f59e0b',
  'Tarjeta Débito': '#f97316',
  'Cuenta Corriente': '#a855f7',
  'Otro': '#6b7280',
}
const paymentColor = (m) => PAYMENT_COLORS[m] || '#6b7280'

const PERIODS = [
  { label: '7 días', days: 7 },
  { label: '15 días', days: 15 },
  { label: '30 días', days: 30 },
  { label: '3 meses', days: 90 },
  { label: '6 meses', days: 180 },
]

function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: AR_TZ, hour: '2-digit', hour12: false }))
  if (h < 12) return 'Buenos días'
  if (h < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

function relativeTime(from, now) {
  if (!from) return '—'
  const secs = Math.max(0, Math.round((now - from) / 1000))
  if (secs < 60) return 'hace instantes'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.round(mins / 60)
  return `hace ${hrs} h`
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// ── Bloques base reutilizables ────────────────────────────────────────────────

function Card({ className, children, ...rest }) {
  return (
    <div className={cn('bg-card border border-border rounded-2xl', className)} {...rest}>
      {children}
    </div>
  )
}

function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        {Icon && <Icon size={15} className="text-accent" />} {children}
      </h2>
      {right}
    </div>
  )
}

function Delta({ pct, className }) {
  if (pct === null || pct === undefined || isNaN(pct)) return null
  const up = pct >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold', up ? 'text-green-400' : 'text-red-400', className)}>
      <Icon size={12} /> {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function ProgressBar({ pct, color, className }) {
  return (
    <div className={cn('h-2.5 rounded-full bg-black/40 overflow-hidden', className)}>
      <motion.div
        initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="h-full rounded-full"
        style={{ background: color }}
      />
    </div>
  )
}

function EmptyMini({ children }) {
  return <p className="text-xs text-zinc-600 text-center py-6">{children}</p>
}

// ── Sparkline (mini gráfico de línea) ──────────────────────────────────────────

function Sparkline({ data, color = '#e91e8c', height = 40 }) {
  if (!data || data.length < 2) return <div style={{ height }} />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Gauge semicircular (velocímetro) ───────────────────────────────────────────

function Gauge({ value, max, label }) {
  const cx = 110, cy = 110, r = 88, sw = 18
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  const polar = (f) => {
    const deg = 180 - f * 180
    const a = (deg * Math.PI) / 180
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)]
  }
  const arc = (f0, f1) => {
    const [x0, y0] = polar(f0)
    const [x1, y1] = polar(f1)
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
  }
  const [nx, ny] = polar(frac)
  const zones = [
    { f0: 0, f1: 0.4, color: '#ef4444' },
    { f0: 0.4, f1: 0.72, color: '#f59e0b' },
    { f0: 0.72, f1: 1, color: '#22c55e' },
  ]
  return (
    <svg viewBox="0 0 220 130" className="w-full max-w-[260px] mx-auto">
      {zones.map((z, i) => (
        <path key={i} d={arc(z.f0, z.f1)} fill="none" stroke={z.color} strokeWidth={sw} strokeLinecap="round" opacity={0.85} />
      ))}
      <motion.line
        x1={cx} y1={cy} x2={nx} y2={ny}
        stroke="#fff" strokeWidth={3.5} strokeLinecap="round"
        initial={{ x2: polar(0)[0], y2: polar(0)[1] }}
        animate={{ x2: nx, y2: ny }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
      <circle cx={cx} cy={cy} r={7} fill="#fff" />
      {label && <text x={cx} y={cy - 22} textAnchor="middle" className="fill-zinc-400" style={{ fontSize: 11 }}>{label}</text>}
    </svg>
  )
}

// ── KPI card grande ─────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, title, children, accent }) {
  return (
    <Card className={cn('p-4 flex flex-col gap-1.5 relative overflow-hidden', accent && 'ring-1 ring-accent/30')}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
        {Icon && <Icon size={13} className="text-accent" />} {title}
      </div>
      {children}
    </Card>
  )
}

// ── Tooltip del gráfico principal ─────────────────────────────────────────────

function MainTooltip({ active, payload, metric }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0].payload
  const fmt = (v) => (metric === 'monto' ? formatCurrency(v) : `${v} ventas`)
  return (
    <div className="bg-black/90 border border-border rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-zinc-400 mb-1">{p.label}</p>
      <p className="text-accent font-semibold">{fmt(metric === 'monto' ? p.total : p.count)}</p>
      <p className="text-zinc-500">Período anterior: {fmt(metric === 'monto' ? p.prevTotal : p.prevCount)}</p>
      {p.isRecord && <p className="text-amber-400 mt-0.5">⭐ Récord histórico</p>}
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const name = capitalize(user?.name || user?.username || '')

  // Estado de datos
  const [stats, setStats] = useState(null)
  const [extras, setExtras] = useState(null)
  const [byPayment, setByPayment] = useState([])
  const [topProd, setTopProd] = useState([])
  const [recent, setRecent] = useState([])
  const [rangeData, setRangeData] = useState(null)
  const [period, setPeriod] = useState(30)
  const [metric, setMetric] = useState('monto')
  const [monthlyProfit, setMonthlyProfit] = useState(null)
  const [monthComp, setMonthComp] = useState(null)
  const [breakeven, setBreakeven] = useState(null)
  const [cashflow, setCashflow] = useState(null)
  const [health, setHealth] = useState(null)
  const [stockBreaks, setStockBreaks] = useState([])
  const [recs, setRecs] = useState([])
  const [specular, setSpecular] = useState([])
  const [todayCash, setTodayCash] = useState(null)
  const [mainCash, setMainCash] = useState(null)
  const [cashOpen, setCashOpen] = useState(false)
  const [fiscal, setFiscal] = useState(null)
  const [topClients, setTopClients] = useState([])
  const [overdue, setOverdue] = useState([])
  const [conn, setConn] = useState({ tn: null, drive: null, afip: null })

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [now, setNow] = useState(Date.now())
  const lastLoad = useRef(0)

  // Reloj para el "hace X minutos"
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  // ── Carga de datos que cambian seguido (ventas, caja) ─────────────────────
  const loadLive = useCallback(async () => {
    const res = await Promise.allSettled([
      api.dashboard.stats(),
      api.dashboard.realtimeExtras(),
      api.dashboard.salesByPayment(),
      api.dashboard.topProductsToday(8),
      api.dashboard.recentSales(8),
      api.cashbox.todaySummary(),
      api.mainCashbox.balance(),
      api.cashbox.current(),
    ])
    const v = (i) => (res[i].status === 'fulfilled' ? res[i].value : undefined)
    if (v(0) !== undefined) setStats(v(0))
    if (v(1) !== undefined) setExtras(v(1))
    if (v(2) !== undefined) setByPayment((v(2) || []).map(it => ({ ...it, fill: paymentColor(it.payment_method) })))
    if (v(3) !== undefined) setTopProd(v(3) || [])
    if (v(4) !== undefined) setRecent(v(4) || [])
    if (v(5) !== undefined) setTodayCash(v(5))
    if (v(6) !== undefined) setMainCash(v(6))
    if (v(7) !== undefined) setCashOpen(!!v(7))
    setLastUpdated(Date.now())
  }, [])

  // ── Carga de datos más pesados / estables ─────────────────────────────────
  const loadHeavy = useCallback(async () => {
    const res = await Promise.allSettled([
      api.dashboard.monthlyProfit(),
      api.dashboard.monthComparison(),
      api.breakeven.data(),
      api.cashflow.projection(),
      api.health.score(),
      api.intelligence.stockBreaks(),
      api.intelligence.recommendations(),
      api.intelligence.stockSpecular(),
      api.fiscal.stats(),
      api.dashboard.topClientsMonth(),
      api.dashboard.overdueDebt(),
    ])
    const v = (i) => (res[i].status === 'fulfilled' ? res[i].value : undefined)
    if (v(0) !== undefined) setMonthlyProfit(v(0))
    if (v(1) !== undefined) setMonthComp(v(1))
    if (v(2) !== undefined) setBreakeven(v(2))
    if (v(3) !== undefined) setCashflow(v(3))
    if (v(4) !== undefined) setHealth(v(4))
    if (v(5) !== undefined) setStockBreaks(v(5) || [])
    if (v(6) !== undefined) setRecs(v(6) || [])
    if (v(7) !== undefined) setSpecular(v(7) || [])
    if (v(8) !== undefined) setFiscal(v(8))
    if (v(9) !== undefined) setTopClients(v(9) || [])
    if (v(10) !== undefined) setOverdue(v(10) || [])
  }, [])

  const loadRange = useCallback(async (d) => {
    try { setRangeData(await api.dashboard.salesRange(d)) } catch { /* Sin datos */ }
  }, [])

  const loadConn = useCallback(async () => {
    const res = await Promise.allSettled([api.tn.status(), api.googledrive.status(), api.afip.status()])
    setConn({
      tn: res[0].status === 'fulfilled' ? res[0].value : null,
      drive: res[1].status === 'fulfilled' ? res[1].value : null,
      afip: res[2].status === 'fulfilled' ? res[2].value : null,
    })
  }, [])

  const loadAll = useCallback(async () => {
    lastLoad.current = Date.now()
    setRefreshing(true)
    try {
      await Promise.all([loadLive(), loadHeavy(), loadRange(period), loadConn()])
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [loadLive, loadHeavy, loadRange, loadConn, period])

  // Carga inicial
  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh cada 60s de la parte "en vivo" (cache implícito: no recargamos lo pesado)
  useEffect(() => {
    const t = setInterval(() => { loadLive() }, 60000)
    return () => clearInterval(t)
  }, [loadLive])

  // Cambio de período → recargar solo el gráfico
  useEffect(() => { if (!loading) loadRange(period) }, [period]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derivados ──────────────────────────────────────────────────────────────

  const sparkData = useMemo(() => {
    if (!extras?.hourly?.length) return []
    return extras.hourly.slice(-7).map(h => ({ v: h.total }))
  }, [extras])

  const chartData = useMemo(() => {
    if (!rangeData?.data) return []
    const arr = rangeData.data
    const key = metric === 'monto' ? 'total' : 'count'
    const win = 7
    return arr.map((d, i) => {
      const from = Math.max(0, i - win + 1)
      const slice = arr.slice(from, i + 1)
      const ma = slice.reduce((s, x) => s + x[key], 0) / slice.length
      const isRecord = metric === 'monto' && rangeData.allTimeMax > 0 && d.total >= rangeData.allTimeMax && d.total > 0
      const [, mm, dd] = d.day.split('-')
      return { ...d, label: `${dd}/${mm}`, ma7: Math.round(ma), isRecord }
    })
  }, [rangeData, metric])

  const marginColor = (m) => (m >= 30 ? 'text-green-400' : m >= 15 ? 'text-amber-400' : 'text-red-400')

  // Proyección del día (velocímetro)
  const proj = useMemo(() => {
    if (!stats) return { value: 0, max: 1, vsWeekday: null }
    const h = Number(new Date().toLocaleString('en-US', { timeZone: AR_TZ, hour: '2-digit', hour12: false }))
    const OPEN = 9, CLOSE = 21
    let frac = h < OPEN ? 0.05 : h >= CLOSE ? 1 : (h - OPEN) / (CLOSE - OPEN)
    frac = Math.max(0.05, Math.min(1, frac))
    const value = frac >= 1 ? stats.ventas : stats.ventas / frac
    const weekdayAvg = extras?.weekdayAvg || 0
    const max = Math.max(weekdayAvg * 1.6, value * 1.15, stats.ventas * 1.2, 1)
    const vsWeekday = weekdayAvg > 0 ? (value - weekdayAvg) / weekdayAvg * 100 : null
    return { value, max, vsWeekday, weekdayAvg }
  }, [stats, extras])

  // Recomendaciones IA combinadas
  const recCards = useMemo(() => {
    const cards = []
    if (specular?.[0]) {
      const s = specular[0]
      cards.push({
        icon: Archive, tone: 'text-amber-400',
        text: `Stock especular: ${formatCurrency(s.capital_inmovilizado)} inmovilizados en ${s.product_name} T.${s.size}. Considerá liquidar.`,
        action: 'Ver productos', go: '/productos',
      })
    }
    for (const r of (recs || []).slice(0, 2)) {
      cards.push({ icon: Package, tone: 'text-accent', text: r.message, action: 'Reponer', go: '/reposicion' })
    }
    for (const sc of (health?.scores || [])) {
      if (sc.tip && cards.length < 5) {
        cards.push({ icon: Target, tone: 'text-highlight', text: `${sc.label}: ${sc.tip}`, action: 'Configuración', go: '/configuracion' })
      }
    }
    return cards.slice(0, 5)
  }, [specular, recs, health])

  const waLink = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '')
    if (!digits) return null
    return `https://wa.me/${digits.startsWith('54') ? digits : '54' + digits}`
  }

  const fechaHoy = capitalize(new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: AR_TZ,
  }))

  // ── Skeleton inicial ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 space-y-5">
        <SkeletonPulse className="h-16 w-full rounded-2xl" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonPulse key={i} className="h-32 rounded-2xl" />)}
        </div>
        <SkeletonPulse className="h-72 w-full rounded-2xl" />
        <div className="grid md:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonPulse key={i} className="h-64 rounded-2xl" />)}
        </div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      className="p-6 space-y-6"
    >
      {/* ══ SECCIÓN 1 — HEADER ══ */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {greeting()}{name ? `, ${name}` : ''} <span className="align-middle">👋</span>
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">{fechaHoy}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ConnBadge icon={Globe} label="Tienda Nube" ok={conn.tn?.connected} />
            <ConnBadge icon={Cloud} label="Drive" ok={conn.drive?.connected} />
            <ConnBadge icon={Receipt} label="AFIP" ok={conn.afip?.connected} />
          </div>
          <button
            onClick={loadAll} disabled={refreshing}
            className="flex items-center gap-2 text-xs text-zinc-300 hover:text-white px-3 py-2 rounded-lg border border-border hover:bg-white/5 transition-colors no-drag disabled:opacity-60"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            <span>Actualizar</span>
            <span className="text-zinc-600 hidden sm:inline">· {relativeTime(lastUpdated, now)}</span>
          </button>
        </div>
      </div>

      {/* Checklist de primeros pasos (desaparece al completarse) */}
      <OnboardingChecklist />

      {/* ══ SECCIÓN 2 — KPIs PRINCIPALES ══ */}
      <div data-tour="dash-ventas" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Card 1 — Ventas del día */}
        <KpiCard icon={ShoppingCart} title="Ventas del día" accent>
          <p className="text-2xl font-bold text-white tabular-nums leading-tight">{formatCurrency(stats?.ventas || 0)}</p>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{stats?.cantidadVentas || 0} ventas</span>
            <Delta pct={stats?.pctVsAyer} />
          </div>
          <div className="mt-1"><Sparkline data={sparkData} /></div>
          <p className="text-[10px] text-zinc-600">últimas horas</p>
        </KpiCard>

        {/* Card 2 — Ganancia neta */}
        <KpiCard icon={DollarSign} title="Ganancia neta hoy">
          <p className={cn('text-2xl font-bold tabular-nums leading-tight', (stats?.gananciaNeta || 0) >= 0 ? 'text-white' : 'text-red-400')}>
            {formatCurrency(stats?.gananciaNeta || 0)}
          </p>
          <p className={cn('text-xs font-semibold', marginColor(stats?.margenHoy || 0))}>
            Margen {(stats?.margenHoy || 0).toFixed(1)}%
          </p>
          {extras && (
            <p className="text-[11px] text-zinc-500 mt-1">
              Prom. 7 días: <span className="text-zinc-300">{formatCurrency(Math.round(extras.avgNet7d))}</span>
              {extras.avgNet7d > 0 && (
                <Delta className="ml-1" pct={((stats?.gananciaNeta || 0) - extras.avgNet7d) / extras.avgNet7d * 100} />
              )}
            </p>
          )}
        </KpiCard>

        {/* Card 3 — Ticket promedio */}
        <KpiCard icon={Receipt} title="Ticket promedio">
          <p className="text-2xl font-bold text-white tabular-nums leading-tight">{formatCurrency(stats?.ticketPromedio || 0)}</p>
          {monthlyProfit && monthlyProfit.monthlyCount > 0 && (
            <p className="text-[11px] text-zinc-500">
              Mes: <span className="text-zinc-300">{formatCurrency(monthlyProfit.monthlySales / monthlyProfit.monthlyCount)}</span>
            </p>
          )}
          <p className="text-[11px] text-zinc-500">
            {stats?.cantidadVentas > 0 ? (stats.unidadesHoy / stats.cantidadVentas).toFixed(1) : '0'} items por venta
          </p>
        </KpiCard>

        {/* Card 4 — Caja actual */}
        <KpiCard icon={Wallet} title="Caja actual">
          <p className="text-2xl font-bold text-accent tabular-nums leading-tight">
            {formatCurrency((todayCash?.expectedCash || 0) + (mainCash?.balance || 0))}
          </p>
          <div className="text-[11px] text-zinc-500 space-y-0.5">
            <div className="flex justify-between"><span>Caja chica</span><span className="text-zinc-300 tabular-nums">{formatCurrency(todayCash?.expectedCash || 0)}</span></div>
            <div className="flex justify-between"><span>Caja grande</span><span className="text-zinc-300 tabular-nums">{formatCurrency(mainCash?.balance || 0)}</span></div>
          </div>
          <span className={cn('mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full w-fit',
            cashOpen ? 'bg-green-500/15 text-green-400' : 'bg-zinc-500/15 text-zinc-400')}>
            <span className={cn('w-1.5 h-1.5 rounded-full', cashOpen ? 'bg-green-400' : 'bg-zinc-500')} />
            {cashOpen ? 'Caja abierta' : 'Caja cerrada'}
          </span>
        </KpiCard>

        {/* Card 5 — Clientes del día */}
        <KpiCard icon={Users} title="Clientas del día">
          <p className="text-2xl font-bold text-white tabular-nums leading-tight">{stats?.clientesHoy || 0}</p>
          <p className="text-[11px] text-zinc-500">
            <span className="text-green-400">{extras?.clientes?.nuevas || 0} nuevas</span> · {extras?.clientes?.recurrentes || 0} recurrentes
          </p>
          {extras?.clientes?.topBuyer && (
            <p className="text-[11px] text-zinc-500 truncate">
              🏆 {extras.clientes.topBuyer.name} · <span className="text-zinc-300">{formatCurrency(extras.clientes.topBuyer.total)}</span>
            </p>
          )}
        </KpiCard>
      </div>

      {/* ══ SECCIÓN 3 — GRÁFICO PRINCIPAL ══ */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
          <SectionTitle icon={Activity}>Evolución de ventas</SectionTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {PERIODS.map(p => (
                <button key={p.days} onClick={() => setPeriod(p.days)}
                  className={cn('px-2.5 py-1 text-xs no-drag transition-colors', period === p.days ? 'bg-accent text-white' : 'text-zinc-400 hover:bg-white/5')}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {[{ id: 'monto', l: 'Monto' }, { id: 'ventas', l: 'Ventas' }].map(m => (
                <button key={m.id} onClick={() => setMetric(m.id)}
                  className={cn('px-2.5 py-1 text-xs no-drag transition-colors', metric === m.id ? 'bg-highlight text-white' : 'text-zinc-400 hover:bg-white/5')}>
                  {m.l}
                </button>
              ))}
            </div>
          </div>
        </div>
        {chartData.length === 0 ? <EmptyMini>Sin datos</EmptyMini> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
              <XAxis dataKey="label" stroke="#52525b" tick={{ fontSize: 10 }}
                interval={Math.max(0, Math.floor(chartData.length / 10))} minTickGap={12} />
              <YAxis stroke="#52525b" tick={{ fontSize: 10 }}
                tickFormatter={(v) => metric === 'monto' ? `$${(v / 1000).toFixed(0)}k` : v} width={44} />
              <Tooltip content={<MainTooltip metric={metric} />} />
              <Line type="monotone" dataKey={metric === 'monto' ? 'prevTotal' : 'prevCount'} stroke="#6b7280"
                strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="Período anterior" isAnimationActive={false} />
              <Line type="monotone" dataKey="ma7" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Prom. 7 días" opacity={0.7} isAnimationActive={false} />
              <Line type="monotone" dataKey={metric === 'monto' ? 'total' : 'count'} stroke="#e91e8c" strokeWidth={2.5}
                name="Actual"
                dot={(props) => {
                  const { cx, cy, payload, index } = props
                  if (payload.isRecord) return <text key={index} x={cx} y={cy - 8} textAnchor="middle" fontSize={13}>⭐</text>
                  return <circle key={index} cx={cx} cy={cy} r={0} fill="none" />
                }}
                activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div className="flex items-center gap-4 mt-2 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-accent inline-block" /> Actual</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: '#6b7280' }} /> Período anterior</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Prom. 7 días</span>
          <span>⭐ Récord histórico</span>
        </div>
      </Card>

      {/* ══ SECCIÓN 4 — ANÁLISIS EN TIEMPO REAL ══ */}
      <div className="grid lg:grid-cols-3 gap-3">
        {/* Ventas en vivo */}
        <Card className="p-4">
          <SectionTitle icon={Clock}>Ventas de hoy en vivo</SectionTitle>
          {recent.length === 0 ? <EmptyMini>Todavía no hay ventas hoy</EmptyMini> : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
              {recent.map(s => (
                <div key={s.id} className="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-2">
                  <span className="text-[11px] text-zinc-500 tabular-nums w-10 shrink-0">
                    {new Date(s.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: AR_TZ })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white truncate">{s.main_product || s.client_name || `Venta #${s.id}`}</p>
                    <p className="text-[10px] text-zinc-500 truncate">{s.seller_name || 'Sin vendedora'}</p>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ background: `${paymentColor(s.payment_method)}22`, color: paymentColor(s.payment_method) }}>
                    {s.payment_method || 'Otro'}
                  </span>
                  <span className="text-xs font-semibold text-white tabular-nums shrink-0 w-20 text-right">{formatCurrency(s.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Top productos del día */}
        <Card className="p-4">
          <SectionTitle icon={Package}>Top productos del día</SectionTitle>
          {topProd.length === 0 ? <EmptyMini>Sin ventas de productos hoy</EmptyMini> : (
            <div className="space-y-2">
              {topProd.map((p, i) => {
                const max = topProd[0]?.qty || 1
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-zinc-200 truncate flex items-center gap-1">
                        {i === 0 && <span title="Más vendido">🔥</span>}{p.name || 'Producto'}
                      </span>
                      <span className="text-zinc-400 tabular-nums shrink-0 ml-2">{p.qty} u · {formatCurrency(p.revenue)}</span>
                    </div>
                    <ProgressBar pct={(p.qty / max) * 100} color={i === 0 ? '#e91e8c' : '#6366f1'} className="h-2" />
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Medios de pago */}
        <Card className="p-4">
          <SectionTitle icon={Wallet}>Medios de pago (hoy)</SectionTitle>
          {byPayment.length === 0 ? <EmptyMini>Sin datos</EmptyMini> : (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={byPayment} dataKey="total" nameKey="payment_method" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2}>
                    {byPayment.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={{ background: '#000', border: '1px solid #1e1e1e', borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-1">
                {(() => {
                  const total = byPayment.reduce((s, x) => s + x.total, 0) || 1
                  return byPayment.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <span className="w-2 h-2 rounded-full" style={{ background: p.fill }} /> {p.payment_method || 'Otro'}
                      </span>
                      <span className="text-zinc-300 tabular-nums">{formatCurrency(p.total)} · {((p.total / total) * 100).toFixed(0)}%</span>
                    </div>
                  ))
                })()}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ══ SECCIÓN 5 — VELOCÍMETRO Y PUNTO DE EQUILIBRIO ══ */}
      <div className="grid lg:grid-cols-2 gap-3">
        {/* Velocímetro */}
        <Card className="p-4">
          <SectionTitle icon={GaugeIcon}>Ritmo del día</SectionTitle>
          <Gauge value={proj.value} max={proj.max} label={metric === 'monto' ? '' : ''} />
          <div className="text-center -mt-2">
            <p className="text-[11px] text-zinc-500">Proyección del día</p>
            <p className="text-2xl font-bold text-accent tabular-nums">{formatCurrency(Math.round(proj.value))}</p>
            <p className="text-xs text-zinc-500 mt-1">Si seguís a este ritmo, cerrás cerca de {formatCurrency(Math.round(proj.value))}</p>
            {proj.vsWeekday !== null && (
              <p className="text-xs mt-1">
                <Delta pct={proj.vsWeekday} /> <span className="text-zinc-500">vs. promedio de este día</span>
              </p>
            )}
          </div>
        </Card>

        {/* Punto de equilibrio */}
        <Card className="p-4">
          <SectionTitle icon={Target}>Punto de equilibrio del mes</SectionTitle>
          {!breakeven ? <EmptyMini>Sin datos</EmptyMini> : (() => {
            const pct = breakeven.pct || 0
            const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'
            const dailyPace = breakeven.daysElapsed > 0 ? breakeven.monthlySales / breakeven.daysElapsed : 0
            const daysToBreak = dailyPace > 0 ? Math.ceil(breakeven.remaining / dailyPace) : null
            return (
              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold tabular-nums" style={{ color }}>{pct.toFixed(0)}%</p>
                    <p className="text-[11px] text-zinc-500">alcanzado</p>
                  </div>
                  <div className="text-right text-[11px] text-zinc-500 space-y-0.5">
                    <div>Gastos fijos: <span className="text-amber-400 tabular-nums">{formatCurrency(breakeven.fixedCosts)}</span></div>
                    <div>Vendido: <span className="text-white tabular-nums">{formatCurrency(breakeven.monthlySales)}</span></div>
                  </div>
                </div>
                <ProgressBar pct={pct} color={color} className="h-3" />
                {breakeven.achieved ? (
                  <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 size={13} /> ¡Ya cubriste tus gastos fijos este mes!</p>
                ) : (
                  <>
                    <p className="text-xs text-zinc-400">Faltan <span className="text-white font-semibold">{formatCurrency(breakeven.remaining)}</span> en ventas para cubrir los gastos fijos.</p>
                    {daysToBreak !== null && daysToBreak <= 60 && (
                      <p className="text-xs text-zinc-500">Lo lográs en ~{daysToBreak} día{daysToBreak !== 1 ? 's' : ''} más si mantenés el ritmo.</p>
                    )}
                  </>
                )}
              </div>
            )
          })()}
        </Card>
      </div>

      {/* ══ SECCIÓN 6 — STOCK E IA ══ */}
      <div className="grid lg:grid-cols-2 gap-3">
        {/* Alertas de stock */}
        <Card className="p-4">
          <SectionTitle icon={AlertTriangle}>Atención requerida — Stock</SectionTitle>
          {stockBreaks.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-green-400 py-4">
              <CheckCircle2 size={16} /> Stock saludable — sin alertas críticas
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
              {stockBreaks.slice(0, 8).map((b, i) => {
                const dot = b.level === 'red' ? '🔴' : b.level === 'orange' ? '🟠' : '🟡'
                return (
                  <div key={i} className="flex items-center gap-2 bg-surface border border-border rounded-lg px-2.5 py-2">
                    <span className="shrink-0">{dot}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{b.product_name} T.{b.size}</p>
                      <p className="text-[10px] text-zinc-500">Se acaba en {b.days_left} día{b.days_left !== 1 ? 's' : ''} · quedan {b.current_stock} u.</p>
                    </div>
                    <button onClick={() => navigate('/reposicion')}
                      className="text-[10px] text-accent hover:text-white border border-accent/30 hover:bg-accent/10 rounded-lg px-2 py-1 no-drag shrink-0">
                      Crear pedido
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Recomendaciones IA */}
        <Card className="p-4" data-tour="dash-ia">
          <SectionTitle icon={Brain} right={<HelpTip text={TOOLTIPS.ia}><span className="cursor-help text-zinc-600">ⓘ</span></HelpTip>}>DELPA recomienda</SectionTitle>
          {recCards.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-4"><Sparkles size={16} className="text-accent" /> Todo en orden por ahora.</div>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {recCards.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5 bg-surface border border-border rounded-lg px-3 py-2.5">
                  <c.icon size={16} className={cn('mt-0.5 shrink-0', c.tone)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-300 leading-snug">{c.text}</p>
                    <button onClick={() => navigate(c.go)} className="text-[11px] text-accent hover:text-white mt-1 no-drag">{c.action} →</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ══ SECCIÓN 7 — FINANCIERO DEL MES ══ */}
      <div className="grid lg:grid-cols-3 gap-3">
        {/* Rentabilidad real */}
        <Card className="p-4">
          <SectionTitle icon={DollarSign}>Rentabilidad del mes</SectionTitle>
          {!monthlyProfit ? <EmptyMini>Sin datos</EmptyMini> : (
            <div className="space-y-1.5 text-sm">
              <Row label="Total ventas" value={monthlyProfit.monthlySales} />
              <Row label="Ganancia bruta" value={monthlyProfit.grossProfit} valueClass="text-green-400" />
              <Row label="Gastos variables" value={-monthlyProfit.monthlyExpenses} valueClass="text-red-400" />
              <Row label="Gastos fijos" value={-monthlyProfit.fixedCostsTotal} valueClass="text-amber-400" />
              <div className="border-t border-border my-1.5" />
              <div className="flex items-center justify-between">
                <span className="text-zinc-300 font-medium">Ganancia neta</span>
                <span className={cn('text-base font-bold tabular-nums', monthlyProfit.realProfit >= 0 ? 'text-accent' : 'text-red-400')}>
                  {formatCurrency(monthlyProfit.realProfit)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">Margen</span>
                <span className={cn('font-semibold', marginColor(monthlyProfit.margin))}>{monthlyProfit.margin.toFixed(1)}%</span>
              </div>
              {monthComp?.pctVar !== null && monthComp?.pctVar !== undefined && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-zinc-500">Ventas vs. mes anterior</span>
                  <Delta pct={Number(monthComp.pctVar)} />
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Flujo de caja */}
        <Card className="p-4">
          <SectionTitle icon={TrendingUp}>Flujo de caja proyectado</SectionTitle>
          {!cashflow?.projection ? <EmptyMini>Sin datos</EmptyMini> : (() => {
            const weeks = [0, 1, 2, 3].map(w => {
              const slice = cashflow.projection.slice(w * 7, w * 7 + 7)
              return {
                label: `Sem ${w + 1}`,
                ingresos: Math.round(slice.reduce((s, d) => s + d.ingresos, 0)),
                egresos: Math.round(slice.reduce((s, d) => s + d.egresos, 0)),
              }
            })
            const finalBalance = cashflow.projection[cashflow.projection.length - 1]?.balance || 0
            return (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={weeks} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
                    <XAxis dataKey="label" stroke="#52525b" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#52525b" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={40} />
                    <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={{ background: '#000', border: '1px solid #1e1e1e', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="ingresos" stackId="a" fill="#22c55e" name="Ingresos" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="egresos" stackId="b" fill="#ef4444" name="Egresos" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-between text-xs mt-2">
                  <span className="text-zinc-500">Saldo proyectado fin de mes</span>
                  <span className={cn('font-bold tabular-nums', finalBalance >= 0 ? 'text-accent' : 'text-red-400')}>{formatCurrency(finalBalance)}</span>
                </div>
              </>
            )
          })()}
        </Card>

        {/* Control fiscal */}
        <Card className="p-4" data-tour="dash-fiscal">
          <SectionTitle icon={Receipt}>Control fiscal</SectionTitle>
          {!fiscal ? <EmptyMini>Sin datos</EmptyMini> : fiscal.regimen === 'MONO' ? (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1"><span className="text-zinc-500">Mes (cat. {fiscal.monoCategoria})</span>
                  <span className="text-zinc-300 tabular-nums">{(fiscal.pctMes || 0).toFixed(0)}%</span></div>
                <ProgressBar pct={fiscal.pctMes || 0} color={fiscal.alertaMes === 'roja' ? '#ef4444' : fiscal.alertaMes === 'amarilla' ? '#f59e0b' : '#22c55e'} />
                <p className="text-[10px] text-zinc-600 mt-0.5">{formatCurrency(fiscal.facturadoMes)} de {formatCurrency(fiscal.limiteMes)}</p>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1"><span className="text-zinc-500">Año</span>
                  <span className="text-zinc-300 tabular-nums">{(fiscal.pctAnio || 0).toFixed(0)}%</span></div>
                <ProgressBar pct={fiscal.pctAnio || 0} color={fiscal.alertaAnio === 'roja' ? '#ef4444' : fiscal.alertaAnio === 'amarilla' ? '#f59e0b' : '#22c55e'} />
                <p className="text-[10px] text-zinc-600 mt-0.5">{formatCurrency(fiscal.facturadoAnio)} de {formatCurrency(fiscal.limiteAnual)}</p>
              </div>
              {(fiscal.alertaMes !== 'ok' || fiscal.alertaAnio !== 'ok') && (
                <p className="text-[11px] text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> Cerca del límite de facturación</p>
              )}
              <p className="text-[10px] text-zinc-600">* Solo facturas con CAE de AFIP</p>
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <Row label="Débito fiscal" value={fiscal.debitoFiscal || 0} valueClass="text-red-400" />
              <Row label="Crédito fiscal" value={fiscal.creditoFiscal || 0} valueClass="text-green-400" />
              <div className="border-t border-border my-1.5" />
              <div className="flex items-center justify-between">
                <span className="text-zinc-300 font-medium">Posición IVA</span>
                <span className={cn('font-bold tabular-nums', (fiscal.posicionIva || 0) >= 0 ? 'text-red-400' : 'text-green-400')}>{formatCurrency(fiscal.posicionIva || 0)}</span>
              </div>
              {fiscal.vencimientoDDJJ && <p className="text-[11px] text-zinc-500">Vence DDJJ: {fiscal.vencimientoDDJJ}</p>}
              <p className="text-[10px] text-zinc-600">* Solo facturas con CAE de AFIP</p>
            </div>
          )}
        </Card>
      </div>

      {/* ══ SECCIÓN 8 — CLIENTES Y FIDELIZACIÓN ══ */}
      <div className="grid lg:grid-cols-2 gap-3">
        {/* Top clientas del mes */}
        <Card className="p-4">
          <SectionTitle icon={Crown}>Top clientas del mes</SectionTitle>
          {topClients.length === 0 ? <EmptyMini>Sin ventas con cliente este mes</EmptyMini> : (
            <div className="space-y-2">
              {topClients.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3">
                  <div className={cn('w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                    i === 0 ? 'bg-accent/20 text-accent' : 'bg-white/5 text-zinc-400')}>
                    {(c.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate flex items-center gap-1">
                      {c.name}{i === 0 && <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">👑 VIP</span>}
                    </p>
                    <p className="text-[11px] text-zinc-500">{c.count} compras · {c.points || 0} pts</p>
                  </div>
                  <span className="text-sm font-semibold text-white tabular-nums shrink-0">{formatCurrency(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Fidelización */}
        <Card className="p-4">
          <SectionTitle icon={Sparkles}>Estado de fidelización</SectionTitle>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-surface border border-border rounded-lg p-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Puntos activos</p>
              <p className="text-lg font-bold text-white tabular-nums">{(extras?.puntos?.active || 0).toLocaleString('es-AR')}</p>
            </div>
            <div className="bg-surface border border-border rounded-lg p-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Por vencer este mes</p>
              <p className="text-lg font-bold text-amber-400 tabular-nums">{(extras?.puntos?.porVencer || 0).toLocaleString('es-AR')}</p>
            </div>
            <div className="bg-surface border border-border rounded-lg p-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Nuevas clientas</p>
              <p className="text-lg font-bold text-green-400 tabular-nums">
                {extras?.nuevasClientas?.esteMes || 0}
                <span className="text-[11px] text-zinc-600 font-normal"> vs {extras?.nuevasClientas?.mesAnterior || 0} mes ant.</span>
              </p>
            </div>
            <div className="bg-surface border border-border rounded-lg p-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Con deuda vencida</p>
              <p className="text-lg font-bold text-red-400 tabular-nums">{overdue.length}</p>
            </div>
          </div>
          {overdue.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Cobranzas pendientes</p>
              {overdue.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2 bg-surface border border-border rounded-lg px-2.5 py-1.5">
                  <span className="text-xs text-white truncate">{c.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-red-400 tabular-nums">{formatCurrency(c.balance)}</span>
                    {waLink(c.phone) && (
                      <a href={waLink(c.phone)} target="_blank" rel="noreferrer"
                        onClick={(e) => { e.preventDefault(); api.shell.openExternal(waLink(c.phone)) }}
                        className="text-green-400 hover:text-green-300 no-drag"><MessageCircle size={14} /></a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ══ SECCIÓN 9 — SCORE DE SALUD ══ */}
      <Card className="p-4">
        <SectionTitle icon={Activity} right={
          health && <span className="text-xs text-zinc-500">Tu negocio está al <span className="text-white font-semibold">{health.total}%</span> de su potencial</span>
        }><span className="inline-flex items-center gap-1">Score de salud del negocio <HelpTip text={TOOLTIPS.healthScore}><span className="cursor-help text-zinc-600">ⓘ</span></HelpTip></span></SectionTitle>
        {!health ? <EmptyMini>Sin datos</EmptyMini> : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-4xl font-bold tabular-nums" style={{ color: health.color === 'green' ? '#22c55e' : health.color === 'yellow' ? '#f59e0b' : health.color === 'orange' ? '#f97316' : '#ef4444' }}>
                {health.total}
              </span>
              <div className="flex-1">
                <div className="flex h-3 rounded-full overflow-hidden bg-black/40">
                  {health.scores.map((s, i) => (
                    <div key={i} title={s.label} style={{ width: `${s.max}%`, background: s.pts / s.max >= 0.75 ? '#22c55e' : s.pts / s.max >= 0.5 ? '#f59e0b' : '#ef4444', opacity: 0.3 + 0.7 * (s.pts / s.max) }} />
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-1">{health.label}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {health.scores.map((s, i) => {
                const ratio = s.pts / s.max
                const color = ratio >= 0.75 ? 'text-green-400' : ratio >= 0.5 ? 'text-amber-400' : 'text-red-400'
                return (
                  <div key={i} className="bg-surface border border-border rounded-lg p-2.5">
                    <p className="text-[11px] text-zinc-500">{s.label}</p>
                    <p className={cn('text-lg font-bold tabular-nums', color)}>{s.pts}<span className="text-zinc-600 text-xs">/{s.max}</span></p>
                    {s.tip && <p className="text-[10px] text-zinc-600 leading-tight mt-0.5">{s.tip}</p>}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* ══ SECCIÓN 10 — ACCESOS RÁPIDOS ══ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { icon: PlusCircle, label: 'Nueva venta', go: '/ventas' },
          { icon: PackagePlus, label: 'Ingresar mercadería', go: '/ingreso' },
          { icon: UserSearch, label: 'Buscar clienta', go: '/clientes' },
          { icon: FileBarChart, label: 'Ver informes', go: '/informes' },
          { icon: Wallet, label: 'Abrir caja', go: '/caja' },
          { icon: Ruler, label: 'Buscar por talle', go: '/productos' },
        ].map((b, i) => (
          <button key={i} onClick={() => navigate(b.go)}
            className="flex flex-col items-center justify-center gap-1.5 bg-card border border-border rounded-xl py-4 hover:border-accent/40 hover:bg-accent/5 transition-colors no-drag group">
            <b.icon size={20} className="text-zinc-400 group-hover:text-accent transition-colors" />
            <span className="text-xs text-zinc-400 group-hover:text-white text-center px-1">{b.label}</span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

// ── Fila de tabla financiera ──────────────────────────────────────────────────
function Row({ label, value, valueClass }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={cn('font-semibold tabular-nums', valueClass || 'text-zinc-300')}>{formatCurrency(value)}</span>
    </div>
  )
}

// ── Badge de conexión ─────────────────────────────────────────────────────────
function ConnBadge({ icon: Icon, label, ok }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border',
      ok ? 'border-green-500/30 text-green-400 bg-green-500/5' : 'border-border text-zinc-500')}>
      <Icon size={12} /> {label} {ok ? '✓' : '·'}
    </span>
  )
}
