import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  LineChart, Line, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { TrendingUp, ShoppingCart, DollarSign, Package, Wallet, AlertTriangle, RefreshCw, ShoppingBag, Cake, MessageCircle, Globe } from 'lucide-react'
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

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [trend, setTrend] = useState([])
  const [byPayment, setByPayment] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [cashbox, setCashbox] = useState(null)
  const [cashSummary, setCashSummary] = useState(null)
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, t, p, l, cb, bdays, bmsg, wc, hm, mp, mc, cc] = await Promise.all([
        api.dashboard.stats(),
        api.dashboard.salesTrend(),
        api.dashboard.salesByPayment(),
        api.dashboard.lowStock(),
        api.cashbox.current(),
        api.clients.birthdays(),
        api.settings.get('birthday_message'),
        api.dashboard.weekComparison(),
        api.dashboard.heatmap(),
        api.dashboard.monthlyProfit(),
        api.dashboard.monthComparison(),
        api.dashboard.categoryComparison(),
      ])
      setStats(s)
      setMonthlyProfit(mp)
      setMonthComparison(mc)
      setCategoryComp(cc || [])
      setTrend(t.map(d => ({ ...d, day: d.day.slice(5) })))
      setByPayment(p.map(it => ({ ...it, fill: PAYMENT_COLORS[it.payment_method] || '#6b7280' })))
      setLowStock(l)
      setCashbox(cb)
      setTodayBirthdays(bdays || [])
      if (bmsg) setBirthdayMsg(bmsg)
      if (cb?.id) {
        const summary = await api.cashbox.summary(cb.id)
        setCashSummary(summary)
      }

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

  useEffect(() => { load() }, [load])

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
      {cashbox && cashSummary && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          className="bg-card border border-border rounded-xl p-4"
        >
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Wallet size={14} className="text-accent" /> Desglose de caja (sesión actual)
          </h3>
          <div className="grid grid-cols-4 gap-3 text-sm">
            {[
              { label: 'Apertura', value: cashbox.opening_cash, color: 'text-zinc-300' },
              { label: 'Ventas efectivo', value: cashSummary.cash_sales ?? 0, color: 'text-green-400' },
              { label: 'Gastos', value: cashSummary.total_expenses ?? 0, color: 'text-red-400' },
              {
                label: 'Neto esperado',
                value: (cashbox.opening_cash ?? 0) + (cashSummary.cash_sales ?? 0) - (cashSummary.total_expenses ?? 0),
                color: 'text-accent font-bold',
              },
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
    </motion.div>
  )
}
