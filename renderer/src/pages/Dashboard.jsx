import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LineChart, Line, PieChart, Pie, Cell, BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, ShoppingCart, DollarSign, Package, Wallet, AlertTriangle, RefreshCw, ShoppingBag, Cake, MessageCircle, Globe, Receipt, TrendingDown, Brain, Zap, Archive, Target, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { SkeletonCard } from '@/components/shared/SkeletonLoader'

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function getWeekBounds(offset = 0) {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

const PAYMENT_COLORS = {
  'Efectivo': '#22c55e',
  'Transferencia': '#3b82f6',
  'Mercado Pago': '#6366f1',
  'Tarjeta Crédito': '#f59e0b',
  'Tarjeta Débito': '#f97316',
  'Cuenta Corriente': '#a855f7',
  'Otro': '#6b7280',
}

const CARD_VARIANTS = {
  green:  'bg-gradient-to-br from-green-950/50 to-card border border-green-900/30',
  blue:   'bg-gradient-to-br from-blue-950/50 to-card border border-blue-900/30',
  amber:  'bg-gradient-to-br from-amber-950/50 to-card border border-amber-900/30',
  red:    'bg-gradient-to-br from-red-950/50 to-card border border-red-900/30',
  indigo: 'bg-gradient-to-br from-indigo-950/50 to-card border border-indigo-900/30',
  purple: 'bg-gradient-to-br from-purple-950/50 to-card border border-purple-900/30',
}
const ICON_VARIANTS = {
  green:  'bg-green-500/10 text-green-400',
  blue:   'bg-blue-500/10 text-blue-400',
  amber:  'bg-amber-500/10 text-amber-400',
  red:    'bg-red-500/10 text-red-400',
  indigo: 'bg-indigo-500/10 text-indigo-400',
  purple: 'bg-purple-500/10 text-purple-400',
}

function StatCard({ title, value, icon: Icon, variant = 'indigo', subtitle, delay = 0, plain = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.015, boxShadow: '0 8px 30px rgba(0,200,83,0.08)' }}
      transition={{ delay, duration: 0.25 }}
      className={`rounded-xl p-4 flex items-start gap-3 ${CARD_VARIANTS[variant]}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${ICON_VARIANTS[variant]}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-zinc-500 uppercase tracking-wider truncate">{title}</p>
        {plain
          ? <p className="text-xl font-bold text-white mt-0.5 tabular-nums">{value}</p>
          : <p className="text-xl font-bold text-white mt-0.5 tabular-nums">{formatCurrency(value ?? 0)}</p>}
        {subtitle && <p className="text-[11px] text-zinc-600 mt-0.5">{subtitle}</p>}
      </div>
    </motion.div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="text-zinc-400 text-xs mb-1">{label}</p>
      <p className="text-white font-semibold">{formatCurrency(payload[0].value)}</p>
    </div>
  )
}

function whatsappUrl(client, message) {
  const phone = (client.phone || '').replace(/\D/g, '')
  if (!phone) return null
  const wp = phone.startsWith('54') ? phone : '54' + (phone.startsWith('0') ? phone.slice(1) : phone)
  const firstName = (client.name || '').split(' ')[0]
  const text = encodeURIComponent((message || 'Feliz cumple [nombre]!').replace('[nombre]', firstName))
  return `https://wa.me/${wp}?text=${text}`
}

function ChannelSalesCard() {
  const [period, setPeriod] = useState('day')
  const [local, setLocal] = useState({ total: 0, count: 0 })
  const [tn, setTn] = useState({ connected: false, total: 0, count: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ok = true
    setLoading(true)
    Promise.all([
      api.dashboard.localSalesPeriod(period).catch(() => ({ total: 0, count: 0 })),
      api.tn.salesPeriod(period).catch(() => ({ connected: false, total: 0, count: 0 })),
    ]).then(([l, t]) => {
      if (!ok) return
      setLocal(l || { total: 0, count: 0 })
      setTn(t || { connected: false, total: 0, count: 0 })
    }).finally(() => { if (ok) setLoading(false) })
    return () => { ok = false }
  }, [period])

  const localTotal = Number(local.total) || 0
  const tnTotal = Number(tn.total) || 0
  const total = localTotal + tnTotal
  const pct = (v) => total > 0 ? Math.round(v / total * 100) : 0
  const data = [
    { name: 'Local', value: localTotal, fill: '#22c55e' },
    { name: 'Tienda Nube', value: tnTotal, fill: '#3b82f6' },
  ]
  const periods = [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']]

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Ventas totales por canal</h3>
          <p className="text-[11px] text-zinc-500">Local + Tienda Nube</p>
        </div>
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-0.5">
          {periods.map(([id, lbl]) => (
            <button key={id} onClick={() => setPeriod(id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors no-drag ${period === id ? 'bg-accent text-black' : 'text-zinc-400 hover:text-white'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-zinc-600 text-sm">Cargando...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-zinc-300"><span className="w-2.5 h-2.5 rounded-sm bg-green-500"></span>Local</span>
              <span className="text-sm text-white tabular-nums">{formatCurrency(localTotal)} <span className="text-zinc-500 text-xs">({pct(localTotal)}%)</span></span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-zinc-300"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500"></span>Tienda Nube</span>
              <span className="text-sm text-white tabular-nums">{tn.connected
                ? <>{formatCurrency(tnTotal)} <span className="text-zinc-500 text-xs">({pct(tnTotal)}%)</span></>
                : <span className="text-zinc-600 text-xs">No conectada</span>}</span>
            </div>
            <div className="border-t border-border pt-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">TOTAL</span>
              <span className="text-lg font-bold text-accent tabular-nums">{formatCurrency(total)}</span>
            </div>
            <p className="text-[11px] text-zinc-600">{(local.count || 0) + (tn.count || 0)} ventas · Local {local.count || 0} · TN {tn.count || 0}</p>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 6, right: 18 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={84} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => formatCurrency(v)} contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={26}>
                  {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </motion.div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [trend, setTrend] = useState([])
  const [byPayment, setByPayment] = useState([])
  const [intelligenceRecs, setIntelligenceRecs] = useState([])
  const [stockBreaks, setStockBreaks] = useState([])
  const [intelligenceLoading, setIntelligenceLoading] = useState(false)
  const [stockSpecular, setStockSpecular] = useState([])
  const [cashflow, setCashflow] = useState(null)
  const [breakeven, setBreakeven] = useState(null)
  const [healthScore, setHealthScore] = useState(null)
  const [healthDrilldown, setHealthDrilldown] = useState(false)
  const [lowStock, setLowStock] = useState([])
  const [todayCash, setTodayCash] = useState(null)
  const [todayBirthdays, setTodayBirthdays] = useState([])
  const [birthdayMsg, setBirthdayMsg] = useState('Feliz cumple [nombre]! 🎁')
  const [loading, setLoading] = useState(true)
  const [weekData, setWeekData] = useState([])
  const [heatmapData, setHeatmapData] = useState({})
  const [tnSales, setTnSales] = useState(null)
  const [tnConnected, setTnConnected] = useState(false)
  const [monthlyProfit,    setMonthlyProfit]    = useState(null)
  const [monthComparison,  setMonthComparison]  = useState(null)
  const [categoryComp,     setCategoryComp]     = useState([])
  const [fiscalStats,      setFiscalStats]      = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, t, p, l, cb, bdays, bmsg, wc, hm, mp, mc, cc, fs] = await Promise.all([
        api.dashboard.stats(),
        api.dashboard.salesTrend(),
        api.dashboard.salesByPayment(),
        api.dashboard.lowStock(),
        api.cashbox.todaySummary(),
        api.clients.birthdays(),
        api.settings.get('birthday_message'),
        api.dashboard.weekComparison(),
        api.dashboard.heatmap(),
        api.dashboard.monthlyProfit(),
        api.dashboard.monthComparison(),
        api.dashboard.categoryComparison(),
        api.fiscal.stats().catch(() => null),
      ])
      setStats(s)
      setMonthlyProfit(mp)
      setMonthComparison(mc)
      setCategoryComp(cc || [])
      setFiscalStats(fs)
      setTrend(t.map(d => ({ ...d, day: d.day.slice(5) })))
      setByPayment(p.map(it => ({ ...it, fill: PAYMENT_COLORS[it.payment_method] || '#6b7280' })))
      setLowStock(l)
      setTodayCash(cb)
      setTodayBirthdays(bdays || [])
      if (bmsg) setBirthdayMsg(bmsg)

      // Week comparison
      const thisWeek = getWeekBounds(0)
      const lastWeek = getWeekBounds(-1)
      const byDay = Object.fromEntries((wc || []).map(r => [r.day, r.total]))
      setWeekData(DAYS_ES.map((label, i) => ({
        label,
        'Esta semana': Math.round(byDay[thisWeek[i]] || 0),
        'Semana anterior': Math.round(byDay[lastWeek[i]] || 0),
      })))

      // Heatmap
      const hm2 = {}
      for (const r of (hm || [])) {
        const key = `${r.dow}-${r.hour}`
        hm2[key] = { count: r.count, total: r.total }
      }
      setHeatmapData(hm2)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    api.tn.status().then(s => {
      const connected = s?.connected || false
      setTnConnected(connected)
      if (connected) api.tn.salesToday().then(setTnSales).catch(() => {})
    }).catch(() => {})
  }, [])

  // Load intelligence widgets lazily (after main load, non-blocking)
  useEffect(() => {
    setIntelligenceLoading(true)
    Promise.allSettled([
      api.intelligence.recommendations(),
      api.intelligence.stockBreaks(),
    ]).then(([recs, breaks]) => {
      if (recs.status === 'fulfilled') setIntelligenceRecs(recs.value || [])
      if (breaks.status === 'fulfilled') setStockBreaks(breaks.value || [])
    }).finally(() => setIntelligenceLoading(false))
  }, [])

  useEffect(() => {
    Promise.allSettled([
      api.intelligence.stockSpecular(),
      api.cashflow.projection(),
      api.breakeven.data(),
      api.health.score(),
    ]).then(([spec, cf, be, hs]) => {
      if (spec.status === 'fulfilled') setStockSpecular(spec.value || [])
      if (cf.status === 'fulfilled') setCashflow(cf.value)
      if (be.status === 'fulfilled') setBreakeven(be.value)
      if (hs.status === 'fulfilled') setHealthScore(hs.value)
    })
  }, [])

  useEffect(() => { load() }, [load])

  const navigate = useNavigate()
  const today = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6 space-y-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white capitalize">Dashboard</h1>
          <p className="text-sm text-zinc-500 capitalize mt-0.5">{today}</p>
        </div>
        <button onClick={load} disabled={loading} className="no-drag flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-border disabled:opacity-40">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {/* KPI grid */}
      {loading ? (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard title="Ventas hoy" value={stats?.ventas} icon={ShoppingCart} variant="blue"
              subtitle={`${stats?.cantidadVentas ?? 0} transacciones`} delay={0} />
            <StatCard title="Ganancia bruta" value={stats?.gananciaBruta} icon={TrendingUp} variant="green" delay={0.05} />
            <StatCard title="Ganancia neta" value={stats?.gananciaNeta} icon={DollarSign}
              variant={(stats?.gananciaNeta ?? 0) >= 0 ? 'green' : 'red'}
              subtitle={`Gastos: ${formatCurrency(stats?.gastos ?? 0)}`} delay={0.1} />
            <StatCard title="Cuentas pendientes" value={stats?.cuentasCorrientes} icon={Wallet} variant="amber" delay={0.15} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <StatCard title="Unidades vendidas hoy" value={stats?.unidadesHoy ?? 0} icon={ShoppingBag} variant="indigo"
              plain subtitle="prendas" delay={0.18} />
            <StatCard title="Inversión en stock" value={stats?.inversionStock} icon={Package} variant="blue" delay={0.2} />
            <StatCard title="Venta potencial (stock)" value={stats?.ventaPotencial} icon={TrendingUp} variant="purple" delay={0.22} />
          </div>

          {tnConnected && tnSales && (
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-gradient-to-br from-blue-950/40 to-card border border-blue-900/30 rounded-xl p-4 flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <Globe size={18} className="text-blue-400" />
              </div>
              <div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Ventas web hoy (Tienda Nube)</p>
                <p className="text-xl font-bold text-white tabular-nums mt-0.5">{formatCurrency(tnSales.total ?? 0)}</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">{tnSales.count ?? 0} pedidos pagados</p>
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* Ventas totales por canal (Local + Tienda Nube) */}
      <ChannelSalesCard />

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4">
        {/* Trend */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          className="col-span-2 bg-card border border-border rounded-xl p-4"
        >
          <h3 className="text-sm font-medium text-white mb-4">Ventas — últimos 30 días</h3>
          {trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trend} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
                <XAxis dataKey="day" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                <YAxis stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="total" stroke="#00c853" strokeWidth={2}
                  dot={false} activeDot={{ r: 4, fill: '#00c853', stroke: '#111111', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-zinc-600 text-sm">Sin datos en los últimos 30 días</div>
          )}
        </motion.div>

        {/* By payment */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.33 }}
          className="bg-card border border-border rounded-xl p-4"
        >
          <h3 className="text-sm font-medium text-white mb-3">Medios de pago (hoy)</h3>
          {byPayment.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={byPayment} dataKey="total" nameKey="payment_method"
                    cx="50%" cy="50%" outerRadius={58} innerRadius={35} paddingAngle={2}>
                    {byPayment.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111111', border: '1px solid #1e1e1e', borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => [formatCurrency(v), '']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {byPayment.map(p => (
                  <div key={p.payment_method} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.fill }} />
                      <span className="text-zinc-400 truncate">{p.payment_method}</span>
                    </div>
                    <span className="text-white font-medium tabular-nums">{formatCurrency(p.total)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-zinc-600 text-sm">Sin ventas hoy</div>
          )}
        </motion.div>
      </div>

      {/* Cash breakdown */}
      {todayCash && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="bg-card border border-border rounded-xl p-4"
        >
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Wallet size={14} className="text-accent" />
            Desglose de caja
            {todayCash.openCount > 1 && (
              <span className="ml-1 text-xs bg-accent/15 text-accent px-2 py-0.5 rounded-full">
                {todayCash.openCount} turnos
              </span>
            )}
          </h3>
          <div className="grid grid-cols-4 gap-3 text-sm">
            {[
              { label: 'Apertura', value: todayCash.totalOpening, color: 'text-zinc-300' },
              { label: 'Total ventas', value: todayCash.totalSales, color: 'text-green-400' },
              { label: 'Gastos', value: todayCash.totalExpenses, color: 'text-red-400' },
              { label: 'Efectivo esperado', value: todayCash.expectedCash, color: 'text-accent font-bold' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface rounded-lg p-3 border border-border">
                <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-1">{label}</p>
                <p className={`text-base tabular-nums ${color}`}>{formatCurrency(value)}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Week comparison */}
      {weekData.some(d => d['Esta semana'] > 0 || d['Semana anterior'] > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-card border border-border rounded-xl p-4"
        >
          <h3 className="text-sm font-medium text-white mb-4">Comparativa semanal — esta semana vs. anterior</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weekData} margin={{ left: -10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
              <XAxis dataKey="label" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
              <YAxis stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111111', border: '1px solid #1e1e1e', borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [formatCurrency(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#6b7280' }} />
              <Bar dataKey="Esta semana" fill="#00c853" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Semana anterior" fill="#3f3f3f" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* ── Widget Fiscal ── */}
      {fiscalStats && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className={`bg-card border rounded-xl p-4 ${
            fiscalStats.alertaAnio === 'roja' ? 'border-red-500/40' :
            fiscalStats.alertaAnio === 'amarilla' ? 'border-amber-500/40' :
            'border-border'
          }`}
        >
          <div className="flex items-center gap-2 mb-4">
            <Receipt size={15} className="text-accent" />
            <h3 className="text-sm font-medium text-white">
              Control fiscal — {fiscalStats.regimen === 'MONO' ? `Monotributo Cat. ${fiscalStats.monoCategoria}` : 'Responsable Inscripto'}
            </h3>
            {(fiscalStats.alertaAnio === 'roja' || fiscalStats.alertaMes === 'roja') && (
              <span className="ml-auto text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">⚠ Límite cerca</span>
            )}
            {(fiscalStats.alertaAnio === 'amarilla' || fiscalStats.alertaMes === 'amarilla') && !fiscalStats.alertaAnio?.includes('roja') && (
              <span className="ml-auto text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">80% del límite</span>
            )}
          </div>

          {fiscalStats.regimen === 'MONO' ? (
            <div className="space-y-4">
              {/* Este mes */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-zinc-400">Facturado este mes</span>
                  <span className="font-medium text-white tabular-nums">
                    {formatCurrency(fiscalStats.facturadoMes)}
                    <span className="text-zinc-600 ml-1">/ {formatCurrency(fiscalStats.limiteMes)}</span>
                  </span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      fiscalStats.pctMes >= 95 ? 'bg-red-500' :
                      fiscalStats.pctMes >= 80 ? 'bg-amber-400' : 'bg-accent'
                    }`}
                    style={{ width: `${Math.min(100, fiscalStats.pctMes)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] mt-1 text-zinc-600">
                  <span>{fiscalStats.pctMes.toFixed(1)}% utilizado</span>
                  <span>Disponible: {formatCurrency(fiscalStats.disponibleMes)}</span>
                </div>
              </div>

              {/* Este año */}
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-zinc-400">Facturado este año</span>
                  <span className="font-medium text-white tabular-nums">
                    {formatCurrency(fiscalStats.facturadoAnio)}
                    <span className="text-zinc-600 ml-1">/ {formatCurrency(fiscalStats.limiteAnual)}</span>
                  </span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      fiscalStats.pctAnio >= 95 ? 'bg-red-500' :
                      fiscalStats.pctAnio >= 80 ? 'bg-amber-400' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, fiscalStats.pctAnio)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] mt-1 text-zinc-600">
                  <span>{fiscalStats.pctAnio.toFixed(1)}% del límite anual</span>
                  <span>Libre: {formatCurrency(fiscalStats.disponibleAnio)}</span>
                </div>
              </div>

              {/* Aclaración: solo CAE */}
              {fiscalStats.soloCae && (
                <div className="text-[10px] text-zinc-600 text-right">
                  Basado en {fiscalStats.facturasAnio || 0} factura{fiscalStats.facturasAnio !== 1 ? 's' : ''} electrónica{fiscalStats.facturasAnio !== 1 ? 's' : ''} con CAE
                </div>
              )}

              {/* Proyección y alertas */}
              {fiscalStats.proyeccionMes && (
                <div className="text-xs text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-2">
                  📅 Al ritmo actual, superarías el límite en <strong className="text-white">{fiscalStats.proyeccionMes}</strong>
                </div>
              )}
              {fiscalStats.pctAnio >= 95 && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  ⚠ Superaste el 95% del límite anual. Considerá recategorizar o consultar a tu contador.
                </div>
              )}
            </div>
          ) : (
            // Responsable Inscripto — posición IVA
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'IVA Débito', value: formatCurrency(fiscalStats.debitoFiscal),  color: 'text-red-400',   icon: TrendingDown },
                { label: 'IVA Crédito', value: formatCurrency(fiscalStats.creditoFiscal), color: 'text-green-400', icon: TrendingUp },
                {
                  label: fiscalStats.posicionIva >= 0 ? 'A pagar' : 'A favor',
                  value: formatCurrency(Math.abs(fiscalStats.posicionIva)),
                  color: fiscalStats.posicionIva >= 0 ? 'text-amber-400' : 'text-green-400',
                  icon: fiscalStats.posicionIva >= 0 ? TrendingDown : TrendingUp,
                },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className="bg-surface rounded-xl p-3">
                  <p className="text-[10px] text-zinc-500 mb-1">{label}</p>
                  <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
                </div>
              ))}
              <div className="col-span-3 text-[10px] text-zinc-600 px-1">
                Vencimiento DDJJ IVA aprox.: <span className="text-zinc-400">{fiscalStats.vencimientoDDJJ}</span>
                {' · '}Alícuota: {fiscalStats.ivaAlicuota}%
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Monthly comparison */}
      {monthComparison?.days?.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.41 }}
          className="bg-card border border-border rounded-xl p-4"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-medium text-white">Comparativa mensual — este mes vs. mes anterior</h3>
              <div className="flex gap-4 mt-1">
                {monthComparison.pctVar !== null && (
                  <span className={`text-xs font-semibold ${Number(monthComparison.pctVar) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {Number(monthComparison.pctVar) >= 0 ? '↑' : '↓'} {Math.abs(Number(monthComparison.pctVar))}% vs. mes anterior
                  </span>
                )}
                {monthComparison.bestDay && (
                  <span className="text-xs text-zinc-500">Mejor día: <span className="text-green-400">día {monthComparison.bestDay} ({formatCurrency(monthComparison.bestAmount)})</span></span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-zinc-500">Este mes</p>
              <p className="text-lg font-bold text-white tabular-nums">{formatCurrency(monthComparison.totalEste)}</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={monthComparison.days} margin={{ left: -10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
              <XAxis dataKey="day" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                tickFormatter={v => `${v}`} />
              <YAxis stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111', border: '1px solid #1e1e1e', borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [formatCurrency(v), name]}
                labelFormatter={v => `Día ${v}`}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: '#6b7280' }} />
              <Line type="monotone" dataKey="este_mes"      name="Este mes"      stroke="#e91e8c" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="mes_anterior"  name="Mes anterior"  stroke="#4b5563" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
            </LineChart>
          </ResponsiveContainer>

          {/* Comparativa por categoría */}
          {categoryComp.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Categorías — este mes vs. anterior</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {categoryComp.slice(0, 6).map(c => (
                  <div key={c.category} className="flex items-center justify-between bg-surface rounded-lg px-3 py-2">
                    <span className="text-xs text-zinc-400 truncate mr-2">{c.category}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-medium text-white tabular-nums">{formatCurrency(c.este_mes)}</span>
                      {c.pct !== null && (
                        <span className={`text-[10px] font-semibold ${Number(c.pct) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {Number(c.pct) >= 0 ? '+' : ''}{c.pct}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Sales heatmap */}
      {Object.keys(heatmapData).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.43 }}
          className="bg-card border border-border rounded-xl p-4"
        >
          <h3 className="text-sm font-medium text-white mb-4">Mapa de calor de ventas — últimos 90 días</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 2 }}>
            <div />
            {HOURS.map(h => (
              <div key={h} className="text-[9px] text-zinc-600 text-center">{h}h</div>
            ))}
            {DAYS_ES.map((day, dow) => {
              const rowVals = HOURS.map(h => heatmapData[`${dow}-${String(h).padStart(2, '0')}`]?.count || 0)
              const maxVal = Math.max(...Object.values(heatmapData).map(v => v.count), 1)
              return [
                <div key={`label-${dow}`} className="text-[10px] text-zinc-500 flex items-center">{day}</div>,
                ...HOURS.map(h => {
                  const cell = heatmapData[`${dow}-${String(h).padStart(2, '0')}`]
                  const val = cell?.count || 0
                  const intensity = val / maxVal
                  return (
                    <div
                      key={`${dow}-${h}`}
                      title={val > 0 ? `${day} ${h}h: ${val} venta${val !== 1 ? 's' : ''}` : ''}
                      className="rounded-sm"
                      style={{
                        height: 14,
                        backgroundColor: val > 0
                          ? `rgba(0,200,83,${0.1 + intensity * 0.75})`
                          : 'rgba(255,255,255,0.03)',
                      }}
                    />
                  )
                }),
              ]
            })}
          </div>
          <div className="flex items-center gap-2 mt-3 justify-end">
            <span className="text-[10px] text-zinc-600">Menos</span>
            {[0.1, 0.3, 0.55, 0.75, 0.85].map(v => (
              <div key={v} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(0,200,83,${v})` }} />
            ))}
            <span className="text-[10px] text-zinc-600">Más</span>
          </div>
        </motion.div>
      )}

      {/* Birthdays today */}
      {todayBirthdays.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-card border border-border rounded-xl overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Cake size={15} className="text-pink-400" />
            <h3 className="text-sm font-medium text-white">Cumpleaños de hoy — {todayBirthdays.length} {todayBirthdays.length === 1 ? 'clienta' : 'clientas'}</h3>
          </div>
          <div className="divide-y divide-border">
            {todayBirthdays.map(client => {
              const url = whatsappUrl(client, birthdayMsg)
              return (
                <div key={client.id} className="row-alt flex items-center justify-between px-4 py-2.5 text-sm transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-pink-500/10 flex items-center justify-center shrink-0">
                      <Cake size={13} className="text-pink-400" />
                    </span>
                    <span className="text-zinc-200 font-medium truncate">{client.name}</span>
                    {client.phone && <span className="text-zinc-600 text-xs shrink-0">{client.phone}</span>}
                  </div>
                  {url && (
                    <button
                      onClick={() => api.shell.openExternal(url)}
                      className="no-drag shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                    >
                      <MessageCircle size={12} /> WhatsApp
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* Profitability & Projection */}
      {monthlyProfit && (
        <div className="grid grid-cols-2 gap-4">
          {/* Real profitability */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.44 }}
            className="bg-card border border-border rounded-xl p-4 space-y-3"
          >
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <DollarSign size={14} className="text-accent" /> Rentabilidad real del mes
            </h3>
            <div className="space-y-2">
              {[
                { label: 'Ventas del mes', value: monthlyProfit.monthlySales, color: 'text-green-400' },
                { label: 'Gastos variables', value: -monthlyProfit.monthlyExpenses, color: 'text-red-400' },
                { label: 'Gastos fijos', value: -monthlyProfit.fixedCostsTotal, color: 'text-amber-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{label}</span>
                  <span className={`font-semibold tabular-nums ${color}`}>{formatCurrency(Math.abs(value))}</span>
                </div>
              ))}
              <div className="border-t border-border pt-2 flex items-center justify-between">
                <span className="text-sm font-medium text-white">Ganancia neta</span>
                <span className={`text-base font-bold tabular-nums ${monthlyProfit.realProfit >= 0 ? 'text-accent' : 'text-red-400'}`}>
                  {formatCurrency(monthlyProfit.realProfit)}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Monthly projection */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.46 }}
            className="bg-card border border-border rounded-xl p-4 space-y-3"
          >
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-400" /> Proyección del mes
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Ventas hasta hoy</span>
                <span className="text-white font-semibold tabular-nums">{formatCurrency(monthlyProfit.monthlySales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Proyección total</span>
                <span className="text-blue-400 font-semibold tabular-nums">{formatCurrency(monthlyProfit.projected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Días restantes</span>
                <span className="text-zinc-300">{monthlyProfit.daysLeft} de {monthlyProfit.daysInMonth}</span>
              </div>
              {monthlyProfit.monthlyGoal > 0 && (
                <div className="pt-2 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Meta mensual</span>
                    <span className="text-zinc-300 tabular-nums">{formatCurrency(monthlyProfit.monthlyGoal)}</span>
                  </div>
                  <div className="w-full bg-white/[0.06] rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, (monthlyProfit.monthlySales / monthlyProfit.monthlyGoal) * 100).toFixed(1)}%`,
                        background: monthlyProfit.monthlySales >= monthlyProfit.monthlyGoal ? '#00c853' : '#3b82f6',
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-zinc-600 text-right">
                    {((monthlyProfit.monthlySales / monthlyProfit.monthlyGoal) * 100).toFixed(1)}% de la meta
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Low stock */}
      {lowStock.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42 }}
          className="bg-card border border-border rounded-xl overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <AlertTriangle size={15} className="text-amber-400" />
            <h3 className="text-sm font-medium text-white">Stock mínimo — {lowStock.length} alertas</h3>
          </div>
          <div className="divide-y divide-border max-h-52 overflow-y-auto">
            {lowStock.map((item, i) => (
              <div key={i} className="row-alt flex items-center justify-between px-4 py-2 text-sm transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${item.stock === 0 ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <span className="text-zinc-200 truncate">{item.name}</span>
                  <span className="text-zinc-600 shrink-0">T.{item.size}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`font-bold tabular-nums ${item.stock === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                    {item.stock} ud.
                  </span>
                  <span className="text-zinc-700 text-xs">mín {item.min_stock}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Intelligence widgets */}
      {!intelligenceLoading && intelligenceRecs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-card border border-border rounded-xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Brain size={15} className="text-purple-400" />
              <h3 className="text-sm font-medium text-white">Recomendaciones inteligentes</h3>
            </div>
            <button onClick={() => navigate('/reposicion')}
              className="no-drag text-xs text-accent hover:underline">Ver pedidos →</button>
          </div>
          <div className="divide-y divide-border">
            {intelligenceRecs.map((rec, i) => {
              const urgencyConfig = {
                critical: { dot: 'bg-red-500', text: 'text-red-400', badge: 'bg-red-500/10 text-red-400 border-red-500/30', label: 'Crítico' },
                high:     { dot: 'bg-orange-400', text: 'text-orange-400', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/30', label: 'Alto' },
                seasonal: { dot: 'bg-blue-400', text: 'text-blue-400', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30', label: 'Estacional' },
                medium:   { dot: 'bg-amber-400', text: 'text-amber-400', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30', label: 'Medio' },
              }
              const uc = urgencyConfig[rec.urgency] || urgencyConfig.medium
              return (
                <div key={i} className="row-alt flex items-start justify-between px-4 py-3 text-sm transition-colors">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${uc.dot}`} />
                    <div className="min-w-0">
                      <p className="text-zinc-200 text-xs leading-relaxed">{rec.message}</p>
                      <p className="text-zinc-600 text-[10px] mt-0.5">
                        Stock actual: {rec.current_stock} u. · Velocidad: {rec.daily_velocity} u/día · Necesitás: {rec.units_needed} u.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${uc.badge}`}>{uc.label}</span>
                    <button onClick={() => navigate('/reposicion')}
                      className="no-drag text-xs text-accent hover:underline whitespace-nowrap">Crear pedido</button>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      {/* ── Widget: Stock Especular ──────────────────────────────────── */}
      {stockSpecular.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 }}
          className="bg-card border border-amber-900/30 rounded-xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Archive size={15} className="text-amber-400" />
              <h3 className="text-sm font-medium text-white">Capital inmovilizado — sin movimiento 60 días</h3>
              <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                {formatCurrency(stockSpecular.reduce((s, r) => s + r.capital_inmovilizado, 0))}
              </span>
            </div>
            <button onClick={() => navigate('/remitos')}
              className="no-drag text-xs text-accent hover:underline">Crear remito →</button>
          </div>
          <div className="divide-y divide-border max-h-52 overflow-y-auto">
            {stockSpecular.slice(0, 10).map((item, i) => (
              <div key={i} className="row-alt flex items-center justify-between px-4 py-2.5 text-sm transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-zinc-200 truncate">{item.product_name}</span>
                  <span className="text-zinc-600 text-xs shrink-0">T.{item.size}</span>
                  <span className="text-zinc-700 text-xs shrink-0">{item.stock} u.</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-amber-400 font-bold text-xs tabular-nums">{formatCurrency(item.capital_inmovilizado)}</span>
                  <span className="text-zinc-600 text-[10px]">Desc. sugerido: {formatCurrency(item.discount_price)}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Widget: Flujo de Caja Proyectado ─────────────────────────── */}
      {cashflow && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className={`bg-card rounded-xl p-4 border ${
            cashflow.status === 'red' ? 'border-red-900/40' :
            cashflow.status === 'yellow' ? 'border-amber-900/40' : 'border-border'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className={cashflow.status === 'green' ? 'text-green-400' : cashflow.status === 'yellow' ? 'text-amber-400' : 'text-red-400'} />
              <h3 className="text-sm font-medium text-white">Flujo de caja proyectado — próximos 30 días</h3>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-zinc-500">Ingreso prom: <span className="text-green-400 font-medium">{formatCurrency(cashflow.avgDaily)}/día</span></span>
              <span className="text-zinc-500">Egreso prom: <span className="text-red-400 font-medium">{formatCurrency(cashflow.avgExpDaily)}/día</span></span>
              <div className={`w-3 h-3 rounded-full shrink-0 ${cashflow.status === 'green' ? 'bg-green-500' : cashflow.status === 'yellow' ? 'bg-amber-400' : 'bg-red-500'}`} title={`${cashflow.negativeDays} días negativos`} />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={cashflow.projection} margin={{ left: -10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
              <XAxis dataKey="day" stroke="#3f3f3f" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false}
                tickFormatter={v => `D${v}`} interval={4} />
              <YAxis stroke="#3f3f3f" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false}
                tickFormatter={v => v >= 0 ? `$${(v/1000).toFixed(0)}k` : `-$${(Math.abs(v)/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111', border: '1px solid #1e1e1e', borderRadius: 8, fontSize: 11 }}
                formatter={(v, name) => [formatCurrency(v), name]}
                labelFormatter={v => `Día ${v}`}
              />
              <Area type="monotone" dataKey="balance" name="Balance" stroke="#00c853" fill="rgba(0,200,83,0.08)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          {cashflow.negativeDays > 0 && (
            <div className="mt-2 flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle size={12} />
              ⚠ {cashflow.negativeDays} día{cashflow.negativeDays !== 1 ? 's' : ''} con balance negativo proyectado — considerá reducir egresos o incrementar ventas
            </div>
          )}
        </motion.div>
      )}

      {/* ── Widget: Punto de Equilibrio ───────────────────────────────── */}
      {breakeven && breakeven.fixedCosts > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className={`bg-card rounded-xl p-4 border ${breakeven.achieved ? 'border-green-900/40' : 'border-border'}`}
        >
          <div className="flex items-center gap-2 mb-3">
            <Target size={15} className={breakeven.achieved ? 'text-green-400' : 'text-accent'} />
            <h3 className="text-sm font-medium text-white">Punto de equilibrio — {new Date().toLocaleString('es-AR', { month: 'long', year: 'numeric' })}</h3>
            {breakeven.achieved && (
              <span className="ml-auto text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">
                ✓ Gastos cubiertos
              </span>
            )}
          </div>

          {breakeven.achieved ? (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
              <p className="text-green-400 font-bold text-base">¡Ya cubriste los gastos fijos del mes!</p>
              <p className="text-xs text-zinc-500 mt-1">
                Vendiste {formatCurrency(breakeven.monthlySales)} vs punto de equilibrio {formatCurrency(breakeven.breakeven)}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">Ventas del mes</span>
                <span className="text-white font-medium">{formatCurrency(breakeven.monthlySales)} <span className="text-zinc-600">/ {formatCurrency(breakeven.breakeven)}</span></span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${breakeven.pct >= 80 ? 'bg-green-500' : breakeven.pct >= 50 ? 'bg-amber-400' : 'bg-accent'}`}
                  style={{ width: `${Math.min(100, breakeven.pct)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-zinc-600">
                <span>{breakeven.pct.toFixed(0)}% del punto de equilibrio</span>
                <span>Faltan {formatCurrency(breakeven.remaining)} para cubrir gastos</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mt-3">
            {[
              { label: 'Gastos fijos/mes', value: formatCurrency(breakeven.fixedCosts), color: 'text-red-400' },
              { label: 'Margen contribución', value: `${(breakeven.marginRate * 100).toFixed(0)}%`, color: 'text-blue-400' },
              { label: 'Punto de equilibrio', value: formatCurrency(breakeven.breakeven), color: 'text-white' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-surface rounded-lg px-3 py-2">
                <p className="text-[10px] text-zinc-600 uppercase">{label}</p>
                <p className={`text-sm font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Widget: Score de Salud del Negocio ────────────────────────── */}
      {healthScore && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.09 }}
          className={`bg-card rounded-xl p-4 border ${
            healthScore.color === 'green' ? 'border-green-900/40' :
            healthScore.color === 'yellow' ? 'border-amber-900/40' :
            healthScore.color === 'orange' ? 'border-orange-900/40' : 'border-red-900/40'
          }`}
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity size={15} className={
              healthScore.color === 'green' ? 'text-green-400' :
              healthScore.color === 'yellow' ? 'text-amber-400' :
              healthScore.color === 'orange' ? 'text-orange-400' : 'text-red-400'
            } />
            <h3 className="text-sm font-medium text-white">Score de salud del negocio</h3>
          </div>

          <div className="flex items-center gap-6">
            {/* Score circle */}
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-20 h-20 rounded-full flex flex-col items-center justify-center border-4 ${
                healthScore.color === 'green' ? 'border-green-500 bg-green-500/10' :
                healthScore.color === 'yellow' ? 'border-amber-400 bg-amber-500/10' :
                healthScore.color === 'orange' ? 'border-orange-400 bg-orange-500/10' : 'border-red-500 bg-red-500/10'
              }`}>
                <span className={`text-2xl font-black tabular-nums ${
                  healthScore.color === 'green' ? 'text-green-400' :
                  healthScore.color === 'yellow' ? 'text-amber-400' :
                  healthScore.color === 'orange' ? 'text-orange-400' : 'text-red-400'
                }`}>{healthScore.total}</span>
                <span className="text-[9px] text-zinc-600 uppercase tracking-wider">/ 100</span>
              </div>
              <span className={`text-xs font-semibold mt-1 ${
                healthScore.color === 'green' ? 'text-green-400' :
                healthScore.color === 'yellow' ? 'text-amber-400' :
                healthScore.color === 'orange' ? 'text-orange-400' : 'text-red-400'
              }`}>{healthScore.label}</span>
            </div>

            {/* Category bars */}
            <div className="flex-1 space-y-2">
              {healthScore.scores.map(s => (
                <div key={s.label}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-zinc-400">{s.label}</span>
                    <span className="text-zinc-500 tabular-nums">{s.pts}/{s.max}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        s.pts / s.max >= 0.8 ? 'bg-green-500' :
                        s.pts / s.max >= 0.5 ? 'bg-amber-400' : 'bg-red-500'
                      }`}
                      style={{ width: `${(s.pts / s.max) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tips drilldown */}
          <button
            onClick={() => setHealthDrilldown(v => !v)}
            className="no-drag mt-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-accent transition-colors"
          >
            {healthDrilldown ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {healthDrilldown ? 'Ocultar consejos' : 'Ver consejos para mejorar'}
          </button>
          {healthDrilldown && (
            <div className="mt-3 space-y-1.5">
              {healthScore.scores.filter(s => s.tip).map(s => (
                <div key={s.label} className="flex items-start gap-2 text-xs bg-surface rounded-lg px-3 py-2">
                  <span className="text-amber-400 shrink-0 mt-0.5">→</span>
                  <span className="text-zinc-300"><span className="text-zinc-500">{s.label}:</span> {s.tip}</span>
                </div>
              ))}
              {healthScore.scores.every(s => !s.tip) && (
                <p className="text-xs text-green-400 text-center py-2">¡Todo en orden! Seguí así.</p>
              )}
            </div>
          )}
        </motion.div>
      )}

      {!intelligenceLoading && stockBreaks.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.07 }}
          className="bg-card border border-red-900/30 rounded-xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Zap size={15} className="text-red-400" />
              <h3 className="text-sm font-medium text-white">Alertas de quiebre de stock</h3>
              <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">{stockBreaks.length} alertas</span>
            </div>
            <button onClick={() => navigate('/reposicion')}
              className="no-drag text-xs text-accent hover:underline">Pedir ahora →</button>
          </div>
          <div className="divide-y divide-border max-h-52 overflow-y-auto">
            {stockBreaks.map((item, i) => {
              const levelConfig = {
                red:    { dot: 'bg-red-500',    text: 'text-red-400',    label: `${item.days_left}d` },
                orange: { dot: 'bg-orange-400', text: 'text-orange-400', label: `${item.days_left}d` },
                yellow: { dot: 'bg-amber-400',  text: 'text-amber-400',  label: `${item.days_left}d` },
              }
              const lc = levelConfig[item.level] || levelConfig.yellow
              return (
                <div key={i} className="row-alt flex items-center justify-between px-4 py-2.5 text-sm transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${lc.dot}`} />
                    <span className="text-zinc-200 truncate">{item.product_name}</span>
                    <span className="text-zinc-600 text-xs shrink-0">T.{item.size}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-zinc-500 text-xs tabular-nums">{item.current_stock} en stock</span>
                    <span className={`font-bold text-xs tabular-nums ${lc.text}`}>{lc.label} restantes</span>
                    <button onClick={() => navigate('/reposicion')}
                      className="no-drag text-xs text-zinc-500 hover:text-accent transition-colors">Pedir</button>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
