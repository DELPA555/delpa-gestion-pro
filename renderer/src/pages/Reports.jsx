import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts'
import { BarChart3, RefreshCw, Download, Package, Users, Printer, TrendingDown, TrendingUp, MessageCircle, Clock, Search, Receipt, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SkeletonTable from '@/components/shared/SkeletonLoader'

const PIE_COLORS = ['#e91e8c','#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#84cc16','#f97316','#64748b']

const defaultFrom = () => new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
const defaultTo = () => new Date().toISOString().split('T')[0]

const TT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm shadow-xl">
      <p className="text-zinc-400 text-xs mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} className="font-semibold" style={{ color: p.color }}>{formatCurrency(p.value)}</p>)}
    </div>
  )
}

// ── Componente FiscalTab ──────────────────────────────────────────────────────

function FiscalTab({ fiscalSubTab, setFiscalSubTab, fiscalFrom, setFiscalFrom, fiscalTo, setFiscalTo, loadFiscal, fiscalLoading, ivaVentas, ivaCompras, posicionFiscal, mono12m, syncing, setSyncing, inputCls }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {[
          { id: 'ventas',      label: 'Libro IVA Ventas' },
          { id: 'compras',     label: 'Libro IVA Compras' },
          { id: 'posicion',    label: 'Posición Fiscal' },
          { id: 'monotributo', label: 'Control Monotributo' },
        ].map(st => (
          <button key={st.id} onClick={() => setFiscalSubTab(st.id)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              fiscalSubTab === st.id ? 'bg-accent text-black' : 'bg-surface text-zinc-400 hover:text-white border border-border')}>
            {st.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input type="date" value={fiscalFrom} onChange={e => setFiscalFrom(e.target.value)} className={inputCls} />
        <span className="text-zinc-600">→</span>
        <input type="date" value={fiscalTo} onChange={e => setFiscalTo(e.target.value)} className={inputCls} />
        <button onClick={loadFiscal} disabled={fiscalLoading}
          className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
          <RefreshCw size={13} className={fiscalLoading ? 'animate-spin' : ''} /> Actualizar
        </button>
        {fiscalSubTab === 'ventas' && (
          <button onClick={async () => {
            setSyncing(true)
            try {
              const { api: apiMod } = await import('@/lib/api')
              const res = await apiMod.fiscal.syncComprobantes({})
              if (res?.ok) { toast.success(`${res.sincronizados} comprobantes sincronizados`); loadFiscal() }
              else toast.error(res?.error || 'Error al sincronizar con AFIP')
            } finally { setSyncing(false) }
          }} disabled={syncing}
            className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-accent transition-colors disabled:opacity-50">
            <Receipt size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sincronizando...' : 'Sincronizar AFIP'}
          </button>
        )}
      </div>

      {fiscalLoading ? (
        <div className="py-10 flex justify-center"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div>
      ) : fiscalSubTab === 'ventas' && ivaVentas ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[['Neto gravado',ivaVentas.totalNeto,'text-white'],['IVA débito',ivaVentas.totalIva,'text-amber-400'],['Total ventas',ivaVentas.totalTotal,'text-accent']].map(([l,v,c])=>(
              <div key={l} className="bg-card border border-border rounded-xl px-4 py-3">
                <p className="text-xs text-zinc-500 mb-1">{l}</p>
                <p className={`text-xl font-bold tabular-nums ${c}`}>{formatCurrency(v)}</p>
              </div>
            ))}
          </div>
          <button onClick={() => {
            const rows = ivaVentas.ventas.map(r => [r.fecha,r.numero||'',r.tipo,r.cliente,r.neto.toFixed(2),r.iva.toFixed(2),r.total.toFixed(2),r.cae||''].join(','))
            const csv = ['Fecha,Número,Tipo,Cliente,Neto,IVA,Total,CAE',...rows].join('\n')
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'})); a.download=`iva_ventas_${fiscalFrom}_${fiscalTo}.csv`; a.click()
          }} disabled={!ivaVentas.ventas.length} className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white transition-colors disabled:opacity-50">
            <Download size={13}/> CSV para contador
          </button>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2 border-b border-border bg-surface"
              style={{ gridTemplateColumns: '1fr 1fr 1fr 2fr 1fr 1fr 1fr' }}>
              <span>Fecha</span><span>N°</span><span>Tipo</span><span>Cliente</span>
              <span className="text-right">Neto</span><span className="text-right">IVA</span><span className="text-right">Total</span>
            </div>
            <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
              {ivaVentas.ventas.map((r,i) => (
                <div key={i} className="row-alt grid items-center px-4 py-2 text-xs"
                  style={{ gridTemplateColumns: '1fr 1fr 1fr 2fr 1fr 1fr 1fr' }}>
                  <span className="text-zinc-400">{r.fecha}</span>
                  <span className="text-zinc-400 font-mono">{r.numero||'—'}</span>
                  <span className="text-zinc-500">{r.tipo}</span>
                  <span className="text-white truncate pr-2">{r.cliente}</span>
                  <span className="text-right tabular-nums text-zinc-300">{formatCurrency(r.neto)}</span>
                  <span className="text-right tabular-nums text-amber-400">{formatCurrency(r.iva)}</span>
                  <span className="text-right tabular-nums text-white font-medium">{formatCurrency(r.total)}</span>
                </div>
              ))}
              {!ivaVentas.ventas.length && <div className="py-8 text-center text-zinc-600 text-sm">Sin ventas en el período</div>}
            </div>
          </div>
        </div>

      ) : fiscalSubTab === 'compras' && ivaCompras ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[['Neto compras',ivaCompras.totalNeto,'text-white'],['IVA crédito',ivaCompras.totalIva,'text-green-400'],['Total compras',ivaCompras.totalTotal,'text-accent']].map(([l,v,c])=>(
              <div key={l} className="bg-card border border-border rounded-xl px-4 py-3">
                <p className="text-xs text-zinc-500 mb-1">{l}</p>
                <p className={`text-xl font-bold tabular-nums ${c}`}>{formatCurrency(v)}</p>
              </div>
            ))}
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2 border-b border-border bg-surface"
              style={{ gridTemplateColumns: '1fr 3fr 1fr 1fr 1fr' }}>
              <span>Fecha</span><span>Proveedor</span>
              <span className="text-right">Neto</span><span className="text-right">IVA</span><span className="text-right">Total</span>
            </div>
            <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
              {ivaCompras.compras.map((r,i) => (
                <div key={i} className="row-alt grid items-center px-4 py-2 text-xs"
                  style={{ gridTemplateColumns: '1fr 3fr 1fr 1fr 1fr' }}>
                  <span className="text-zinc-400">{r.fecha}</span>
                  <span className="text-white truncate pr-2">{r.proveedor}</span>
                  <span className="text-right tabular-nums text-zinc-300">{formatCurrency(r.neto)}</span>
                  <span className="text-right tabular-nums text-green-400">{formatCurrency(r.iva)}</span>
                  <span className="text-right tabular-nums text-white font-medium">{formatCurrency(r.total)}</span>
                </div>
              ))}
              {!ivaCompras.compras.length && <div className="py-8 text-center text-zinc-600 text-sm">Sin compras en el período</div>}
            </div>
          </div>
        </div>

      ) : fiscalSubTab === 'posicion' ? (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-medium text-white mb-4">Posición de IVA mensual — últimos 12 meses</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={posicionFiscal} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                  tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<TT />} />
                <Bar dataKey="debito"  name="Débito fiscal"  fill="#f59e0b" radius={[3,3,0,0]} />
                <Bar dataKey="credito" name="Crédito fiscal" fill="#22c55e" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2 border-b border-border bg-surface"
              style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr' }}>
              <span>Mes</span><span className="text-right">Ventas</span><span className="text-right">Débito</span>
              <span className="text-right">Crédito</span><span className="text-right">Posición</span>
            </div>
            <div className="divide-y divide-border">
              {posicionFiscal.map(r => (
                <div key={r.mes} className="row-alt grid items-center px-4 py-2.5 text-sm"
                  style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr' }}>
                  <span className="text-zinc-300 font-mono text-xs">{r.mes}</span>
                  <span className="text-right text-zinc-300 tabular-nums text-xs">{formatCurrency(r.ventas)}</span>
                  <span className="text-right text-amber-400 tabular-nums text-xs">{formatCurrency(r.debito)}</span>
                  <span className="text-right text-green-400 tabular-nums text-xs">{formatCurrency(r.credito)}</span>
                  <span className={cn('text-right font-semibold tabular-nums text-xs', r.posicion >= 0 ? 'text-red-400' : 'text-green-400')}>
                    {r.posicion >= 0 ? 'A pagar' : 'A favor'}: {formatCurrency(Math.abs(r.posicion))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      ) : fiscalSubTab === 'monotributo' && mono12m ? (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-medium text-white mb-1">Control Monotributo — Categoría {mono12m.categoria}</h3>
            <p className="text-xs text-zinc-500 mb-4">Límite anual: {formatCurrency(mono12m.limiteAnual)} · Límite mensual: {formatCurrency(mono12m.limiteMensual)}</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={mono12m.meses} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                  tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<TT />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#6b7280' }} />
                <Line type="monotone" dataKey="facturado" name="Facturado" stroke="#e91e8c" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey={() => mono12m.limiteMensual} name="Límite mensual" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2 border-b border-border bg-surface"
              style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr' }}>
              <span>Mes</span><span className="text-right">Ops.</span><span className="text-right">Facturado</span>
              <span className="text-right">Límite mes</span><span className="text-right">Uso %</span>
            </div>
            <div className="divide-y divide-border">
              {[...mono12m.meses].reverse().map(r => {
                const pct = mono12m.limiteMensual > 0 ? r.facturado / mono12m.limiteMensual * 100 : 0
                return (
                  <div key={r.mes} className="row-alt grid items-center px-4 py-2.5 text-sm"
                    style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr' }}>
                    <span className="text-zinc-300 font-mono text-xs">{r.mes}</span>
                    <span className="text-right text-zinc-400 text-xs tabular-nums">{r.operaciones}</span>
                    <span className="text-right text-white tabular-nums">{formatCurrency(r.facturado)}</span>
                    <span className="text-right text-zinc-500 text-xs tabular-nums">{formatCurrency(mono12m.limiteMensual)}</span>
                    <span className={cn('text-right text-xs font-semibold tabular-nums', pct>=95?'text-red-400':pct>=80?'text-amber-400':'text-green-400')}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <button onClick={() => {
            const rows = mono12m.meses.map(r=>[r.mes,r.operaciones,r.facturado.toFixed(2),mono12m.limiteMensual.toFixed(2),(r.facturado/mono12m.limiteMensual*100).toFixed(1)+'%'].join(','))
            const csv = ['Mes,Operaciones,Facturado,Límite Mensual,Uso %',...rows].join('\n')
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'})); a.download='monotributo_control.csv'; a.click()
          }} className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white transition-colors">
            <Download size={13}/> Exportar para el contador
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function Reports() {
  const [tab, setTab] = useState('general')
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(defaultTo())
  const [groupBy, setGroupBy] = useState('day')
  const [trend, setTrend] = useState([])
  const [topProducts, setTopProducts] = useState([])
  const [profitability, setProfitability] = useState(null)
  const [byCategory, setByCategory] = useState([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Comisiones tab
  const [commFrom, setCommFrom] = useState(defaultFrom())
  const [commTo, setCommTo] = useState(defaultTo())
  const [commissions, setCommissions] = useState([])
  const [commLoading, setCommLoading] = useState(false)

  // Artículo tab
  const [artFrom, setArtFrom] = useState(defaultFrom())
  const [artTo, setArtTo] = useState(defaultTo())
  const [artData, setArtData] = useState([])
  const [artLoading, setArtLoading] = useState(false)
  const [artSearch, setArtSearch] = useState('')

  // Ranking tab
  const [rankFrom,     setRankFrom]     = useState(defaultFrom())
  const [rankTo,       setRankTo]       = useState(defaultTo())
  const [rankCat,      setRankCat]      = useState('')
  const [rankData,     setRankData]     = useState([])
  const [rankPrev,     setRankPrev]     = useState([])
  const [rankLoading,  setRankLoading]  = useState(false)

  // Colores tab
  const [colorFrom,    setColorFrom]    = useState(defaultFrom())
  const [colorTo,      setColorTo]      = useState(defaultTo())
  const [colorCat,     setColorCat]     = useState('')
  const [colorData,    setColorData]    = useState([])
  const [colorLoading, setColorLoading] = useState(false)

  // Deudas tab
  const [debtData,    setDebtData]    = useState([])
  const [debtLoading, setDebtLoading] = useState(false)

  // Historial precios tab
  const [phFrom,      setPhFrom]      = useState(defaultFrom())
  const [phTo,        setPhTo]        = useState(defaultTo())
  const [phSearch,    setPhSearch]    = useState('')
  const [phData,      setPhData]      = useState([])
  const [phLoading,   setPhLoading]   = useState(false)
  const [phProductId, setPhProductId] = useState('')
  const [phProductHistory, setPhProductHistory] = useState([])
  const [allProducts, setAllProducts] = useState([])

  // Categorías para filtros
  const [categories, setCategories] = useState([])

  // Fiscal tab
  const [fiscalSubTab,   setFiscalSubTab]   = useState('ventas')
  const [fiscalFrom,     setFiscalFrom]     = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0])
  const [fiscalTo,       setFiscalTo]       = useState(defaultTo())
  const [ivaVentas,      setIvaVentas]      = useState(null)
  const [ivaCompras,     setIvaCompras]     = useState(null)
  const [posicionFiscal, setPosicionFiscal] = useState([])
  const [mono12m,        setMono12m]        = useState(null)
  const [fiscalLoading,  setFiscalLoading]  = useState(false)
  const [syncing,        setSyncing]        = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, top, p, cat] = await Promise.all([
        api.reports.salesByPeriod({ from, to, groupBy }),
        api.reports.topProducts({ from, to, limit: 10 }),
        api.reports.profitability({ from, to }),
        api.reports.salesByCategory({ from, to }),
      ])
      setTrend(t); setTopProducts(top); setProfitability(p); setByCategory(cat)
    } finally { setLoading(false) }
  }, [from, to, groupBy])

  const loadArt = useCallback(async () => {
    setArtLoading(true)
    try { setArtData(await api.reports.salesByProduct({ from: artFrom, to: artTo })) }
    finally { setArtLoading(false) }
  }, [artFrom, artTo])

  const loadComm = useCallback(async () => {
    setCommLoading(true)
    try { setCommissions(await api.reports.commissions({ from: commFrom, to: commTo })) }
    catch { setCommissions([]) }
    finally { setCommLoading(false) }
  }, [commFrom, commTo])

  const loadRanking = useCallback(async () => {
    setRankLoading(true)
    try {
      const [r, p] = await Promise.all([
        api.reports.rankingProductos({ from: rankFrom, to: rankTo, category: rankCat, limit: 20 }),
        api.reports.rankingPrev({ from: rankFrom, to: rankTo, category: rankCat, limit: 20 }),
      ])
      setRankData(r); setRankPrev(p)
    } finally { setRankLoading(false) }
  }, [rankFrom, rankTo, rankCat])

  const loadColors = useCallback(async () => {
    setColorLoading(true)
    try { setColorData(await api.reports.colorAnalysis({ from: colorFrom, to: colorTo, category: colorCat })) }
    finally { setColorLoading(false) }
  }, [colorFrom, colorTo, colorCat])

  const loadDebt = useCallback(async () => {
    setDebtLoading(true)
    try { setDebtData(await api.reports.clientDebt()) }
    finally { setDebtLoading(false) }
  }, [])

  const loadPH = useCallback(async () => {
    setPhLoading(true)
    try { setPhData(await api.reports.priceHistoryReport({ from: phFrom, to: phTo, productSearch: phSearch })) }
    finally { setPhLoading(false) }
  }, [phFrom, phTo, phSearch])

  const handleExport = async (type) => {
    setExporting(true)
    try {
      const path = await api.reports.exportCSV({ from, to, type })
      if (path) toast.success(`Exportado: ${path.split('\\').pop()}`)
    } catch { toast.error('Error al exportar') }
    finally { setExporting(false) }
  }

  const exportArticulosCSV = () => {
    const filtered = artData.filter(r =>
      !artSearch || r.product_name?.toLowerCase().includes(artSearch.toLowerCase()) ||
      r.color?.toLowerCase().includes(artSearch.toLowerCase())
    )
    const header = 'Producto,Color,Talle,Unidades,Precio promedio,Total ventas,Costo promedio,Ganancia'
    const rows = filtered.map(r =>
      [r.product_name, r.color || '', r.size || '', r.qty_sold,
       r.avg_price?.toFixed(2), r.revenue?.toFixed(2), r.avg_cost?.toFixed(2), r.profit?.toFixed(2)].join(',')
    )
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `articulos_${artFrom}_${artTo}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const printArticulosPDF = () => {
    const filtered = artData.filter(r =>
      !artSearch || r.product_name?.toLowerCase().includes(artSearch.toLowerCase()) ||
      r.color?.toLowerCase().includes(artSearch.toLowerCase())
    )
    const totUnits  = filtered.reduce((s, r) => s + r.qty_sold, 0)
    const totRev    = filtered.reduce((s, r) => s + r.revenue, 0)
    const totProfit = filtered.reduce((s, r) => s + r.profit, 0)
    const totMargin = totRev > 0 ? (totProfit / totRev) * 100 : 0
    const fmt = (n) => '$' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const rows = filtered.map(r => {
      const margin = r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0
      return `<tr>
        <td>${r.product_name || ''}${r.color ? ` <span style="color:#888;font-size:11px">${r.color}</span>` : ''}${r.size ? ` <span style="color:#888;font-size:11px">T.${r.size}</span>` : ''}</td>
        <td style="text-align:right">${r.qty_sold}</td>
        <td style="text-align:right">${fmt(r.avg_price)}</td>
        <td style="text-align:right">${fmt(r.revenue)}</td>
        <td style="text-align:right">${r.avg_cost > 0 ? fmt(r.avg_cost) : '—'}</td>
        <td style="text-align:right">${fmt(r.profit)}</td>
        <td style="text-align:right">${margin.toFixed(1)}%</td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Artículos vendidos ${artFrom} — ${artTo}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 24px; }
        h2 { font-size: 16px; margin-bottom: 4px; }
        p.sub { color: #555; font-size: 11px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px; text-align: left; border-bottom: 2px solid #ddd; }
        th:not(:first-child) { text-align: right; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
        tr:nth-child(even) td { background: #fafafa; }
        tfoot td { background: #f0f0f0; font-weight: bold; border-top: 2px solid #ccc; padding: 7px 8px; }
        tfoot td:not(:first-child) { text-align: right; }
        @media print { body { padding: 0; } button { display:none; } }
      </style>
    </head><body>
      <h2>Reporte de artículos vendidos</h2>
      <p class="sub">Período: ${artFrom} al ${artTo} · ${filtered.length} artículos</p>
      <table>
        <thead><tr>
          <th>Producto / Color / Talle</th><th>Unidades</th><th>P. promedio</th>
          <th>Total ventas</th><th>Costo prom.</th><th>Ganancia</th><th>Margen</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td>Total (${filtered.length} artículos)</td>
          <td>${totUnits}</td><td></td>
          <td>${fmt(totRev)}</td><td></td>
          <td>${fmt(totProfit)}</td>
          <td>${totMargin.toFixed(1)}%</td>
        </tr></tfoot>
      </table>
      <script>window.onload = () => { window.print(); window.close() }<\/script>
    </body></html>`
    const win = window.open('', '_blank', 'width=900,height=700')
    if (win) { win.document.write(html); win.document.close() }
  }

  // Load categories once
  useEffect(() => {
    api.reports.salesByCategory({}).then(d => setCategories(d.map(r => r.category).filter(Boolean))).catch(() => {})
    api.products.list({ limit: 9999 }).then(r => setAllProducts(r.products || [])).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'articulos')  loadArt()     }, [tab, loadArt])
  useEffect(() => { if (tab === 'comisiones') loadComm()    }, [tab, loadComm])
  useEffect(() => { if (tab === 'ranking')    loadRanking() }, [tab, loadRanking])
  useEffect(() => { if (tab === 'colores')    loadColors()  }, [tab, loadColors])
  useEffect(() => { if (tab === 'deudas')     loadDebt()    }, [tab, loadDebt])
  useEffect(() => { if (tab === 'precios')    loadPH()      }, [tab, loadPH])

  const loadFiscal = useCallback(async () => {
    setFiscalLoading(true)
    try {
      const [v, c, p, m] = await Promise.all([
        api.fiscal.ivaVentas({ from: fiscalFrom, to: fiscalTo }),
        api.fiscal.ivaCompras({ from: fiscalFrom, to: fiscalTo }),
        api.fiscal.posicion(),
        api.fiscal.monotributo12m(),
      ])
      setIvaVentas(v); setIvaCompras(c); setPosicionFiscal(p); setMono12m(m)
    } finally { setFiscalLoading(false) }
  }, [fiscalFrom, fiscalTo])

  useEffect(() => { if (tab === 'fiscal') loadFiscal() }, [tab, loadFiscal])

  const inputCls = 'input-field bg-card border border-border rounded-lg px-3 py-2 text-sm text-white no-drag'

  const filteredArt = artData.filter(r =>
    !artSearch || r.product_name?.toLowerCase().includes(artSearch.toLowerCase()) ||
    r.color?.toLowerCase().includes(artSearch.toLowerCase())
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6 space-y-6"
    >
      <PageHeader title="Reportes" subtitle="Análisis de ventas y rentabilidad" />

      {/* Tabs */}
      <div className="flex border-b border-border overflow-x-auto">
        {[
          { id: 'general',    label: 'General' },
          { id: 'articulos',  label: 'Por artículo' },
          { id: 'ranking',    label: 'Ranking' },
          { id: 'colores',    label: 'Colores' },
          { id: 'deudas',     label: 'Deudas' },
          { id: 'precios',    label: 'Historial precios' },
          { id: 'fiscal',     label: '⚖ Fiscal' },
          { id: 'comisiones', label: 'Comisiones' },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'fiscal' ? (
        <FiscalTab
          fiscalSubTab={fiscalSubTab} setFiscalSubTab={setFiscalSubTab}
          fiscalFrom={fiscalFrom} setFiscalFrom={setFiscalFrom}
          fiscalTo={fiscalTo} setFiscalTo={setFiscalTo}
          loadFiscal={loadFiscal} fiscalLoading={fiscalLoading}
          ivaVentas={ivaVentas} ivaCompras={ivaCompras}
          posicionFiscal={posicionFiscal} mono12m={mono12m}
          syncing={syncing} setSyncing={setSyncing}
          inputCls={inputCls}
        />
      ) : tab === 'comisiones' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input type="date" value={commFrom} onChange={e => setCommFrom(e.target.value)} className={inputCls} />
            <span className="text-zinc-600">→</span>
            <input type="date" value={commTo} onChange={e => setCommTo(e.target.value)} className={inputCls} />
            <button onClick={loadComm} disabled={commLoading} className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
              <RefreshCw size={13} className={commLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button
              onClick={() => {
                if (!commissions.length) return
                const header = 'Vendedora,N° ventas,Total vendido,Comisión %,Comisión $'
                const rows = commissions.map(c =>
                  [c.seller_name, c.sale_count, c.total_sold.toFixed(2), c.commission_rate, c.commission_amount.toFixed(2)].join(',')
                )
                const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url; a.download = `comisiones_${commFrom}_${commTo}.csv`; a.click()
                URL.revokeObjectURL(url)
              }}
              disabled={commissions.length === 0}
              className="no-drag ml-auto flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50"
            >
              <Download size={13} /> CSV
            </button>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {commLoading ? (
              <div className="py-4"><SkeletonTable rows={5} cols={5} /></div>
            ) : commissions.length === 0 ? (
              <EmptyState icon={Users} title="Sin datos de comisiones" subtitle="No hay vendedoras con comisiones en el período seleccionado" />
            ) : (
              <>
                <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                  style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
                  <span>Vendedora</span>
                  <span className="text-right">N° ventas</span>
                  <span className="text-right">Total vendido</span>
                  <span className="text-right">Comisión %</span>
                  <span className="text-right">A pagar</span>
                </div>
                <div className="divide-y divide-border">
                  {commissions.map(c => (
                    <div key={c.seller_name} className="row-alt grid items-center px-4 py-3 text-sm"
                      style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
                      <span className="text-white font-medium">{c.seller_name}</span>
                      <span className="text-right text-zinc-400 tabular-nums">{c.sale_count}</span>
                      <span className="text-right text-zinc-300 tabular-nums">{formatCurrency(c.total_sold)}</span>
                      <span className="text-right text-zinc-400 tabular-nums">{c.commission_rate}%</span>
                      <span className="text-right text-accent font-semibold tabular-nums">{formatCurrency(c.commission_amount)}</span>
                    </div>
                  ))}
                </div>
                {(() => {
                  const totSales = commissions.reduce((s, c) => s + c.sale_count, 0)
                  const totRev = commissions.reduce((s, c) => s + c.total_sold, 0)
                  const totComm = commissions.reduce((s, c) => s + c.commission_amount, 0)
                  return (
                    <div className="grid items-center px-4 py-3 text-sm bg-surface border-t border-border font-medium"
                      style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
                      <span className="text-zinc-400 uppercase text-xs tracking-wider">Total ({commissions.length} vendedoras)</span>
                      <span className="text-right text-white tabular-nums">{totSales}</span>
                      <span className="text-right text-white tabular-nums">{formatCurrency(totRev)}</span>
                      <span></span>
                      <span className="text-right text-accent font-bold tabular-nums">{formatCurrency(totComm)}</span>
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        </div>
      ) : tab === 'ranking' ? (
        /* ─── RANKING DE PRODUCTOS ──────────────────────────────────────── */
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={rankFrom} onChange={e => setRankFrom(e.target.value)} className={inputCls} />
            <span className="text-zinc-600">→</span>
            <input type="date" value={rankTo} onChange={e => setRankTo(e.target.value)} className={inputCls} />
            <select value={rankCat} onChange={e => setRankCat(e.target.value)} className={inputCls}>
              <option value="">Todas las categorías</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={loadRanking} disabled={rankLoading} className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
              <RefreshCw size={13} className={rankLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button onClick={() => {
              if (!rankData.length) return
              const fmt = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0 })
              const rows = rankData.map(r => `<tr><td>${r.rank}</td><td>${r.product_name}</td><td style="text-align:right">${r.category}</td><td style="text-align:right">${r.qty_sold}</td><td style="text-align:right">${fmt(r.revenue)}</td><td style="text-align:right">${r.pct_revenue}%</td></tr>`).join('')
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ranking</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial;font-size:12px;padding:24px}h2{margin-bottom:12px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.3px}td{padding:5px 8px;border-bottom:1px solid #eee}tr:nth-child(even)td{background:#fafafa}@media print{@page{size:A4;margin:12mm}}</style></head><body><h2>Ranking de productos — ${rankFrom} al ${rankTo}</h2><table><thead><tr><th>#</th><th>Producto</th><th>Categoría</th><th style="text-align:right">Unidades</th><th style="text-align:right">Ingresos</th><th style="text-align:right">%</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`
              const w = window.open('','_blank','width=800,height=600'); w.document.write(html); w.document.close()
            }} disabled={!rankData.length} className="no-drag ml-auto flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
              <Printer size={13} /> PDF
            </button>
          </div>

          {rankLoading ? <div className="py-8 flex justify-center"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div> : rankData.length === 0 ? (
            <EmptyState icon={Package} title="Sin datos en el período" />
          ) : (
            <>
              {/* Gráfico barras horizontal top 10 */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-medium text-white mb-4">Top 10 por unidades vendidas</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={rankData.slice(0,10)} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
                    <XAxis type="number" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                    <YAxis type="category" dataKey="product_name" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} width={140}
                      tickFormatter={v => v.length > 22 ? v.slice(0, 22) + '…' : v} />
                    <Tooltip content={<TT />} formatter={v => [v + ' un.', 'Unidades']} />
                    <Bar dataKey="qty_sold" fill="#e91e8c" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabla con comparativa vs período anterior */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                  style={{ gridTemplateColumns: '30px 3fr 1fr 1fr 1fr 1fr 1fr' }}>
                  <span>#</span><span>Producto</span><span className="text-right">Categoría</span>
                  <span className="text-right">Unidades</span><span className="text-right">Ingresos</span>
                  <span className="text-right">% total</span><span className="text-right">vs anterior</span>
                </div>
                <div className="divide-y divide-border">
                  {rankData.map(r => {
                    const prevRow = rankPrev.find(p => p.product_id === r.product_id)
                    const prevQty = prevRow?.qty_sold ?? 0
                    const diff    = prevQty > 0 ? ((r.qty_sold - prevQty) / prevQty * 100).toFixed(0) : null
                    return (
                      <div key={r.product_id} className="row-alt grid items-center px-4 py-2.5 text-sm"
                        style={{ gridTemplateColumns: '30px 3fr 1fr 1fr 1fr 1fr 1fr' }}>
                        <span className="text-zinc-500 font-bold text-xs">{r.rank}</span>
                        <span className="text-white truncate pr-2">{r.product_name}</span>
                        <span className="text-right text-zinc-500 text-xs truncate">{r.category}</span>
                        <span className="text-right text-zinc-300 tabular-nums">{r.qty_sold}</span>
                        <span className="text-right text-white tabular-nums">{formatCurrency(r.revenue)}</span>
                        <span className="text-right text-zinc-400 tabular-nums text-xs">{r.pct_revenue}%</span>
                        <span className={cn('text-right text-xs tabular-nums font-medium flex items-center justify-end gap-0.5',
                          diff === null ? 'text-zinc-600' : Number(diff) >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {diff === null ? '—' : <>{Number(diff) >= 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}{diff}%</>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>

      ) : tab === 'colores' ? (
        /* ─── ANÁLISIS DE COLORES ───────────────────────────────────────── */
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={colorFrom} onChange={e => setColorFrom(e.target.value)} className={inputCls} />
            <span className="text-zinc-600">→</span>
            <input type="date" value={colorTo} onChange={e => setColorTo(e.target.value)} className={inputCls} />
            <select value={colorCat} onChange={e => setColorCat(e.target.value)} className={inputCls}>
              <option value="">Todas las categorías</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={loadColors} disabled={colorLoading} className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
              <RefreshCw size={13} className={colorLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
          </div>

          {colorLoading ? <div className="py-8 flex justify-center"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div> : colorData.length === 0 ? (
            <EmptyState icon={Package} title="Sin datos en el período" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Torta */}
              <div className="bg-card border border-border rounded-xl p-4">
                <h3 className="text-sm font-medium text-white mb-2">Distribución por color</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={colorData.slice(0,10)} cx="50%" cy="50%" outerRadius={100}
                      dataKey="qty_sold" nameKey="color" label={({ color, pct }) => `${color} ${pct}%`} labelLine={false}>
                      {colorData.slice(0,10).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v + ' unidades', n]} />
                    <Legend formatter={v => v.length > 14 ? v.slice(0,14)+'…' : v} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Tabla */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                  style={{ gridTemplateColumns: '14px 2fr 1fr 1fr 1fr' }}>
                  <span/><span>Color</span><span className="text-right">Unidades</span>
                  <span className="text-right">Ingresos</span><span className="text-right">%</span>
                </div>
                <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
                  {colorData.map((r, i) => (
                    <div key={r.color} className="row-alt grid items-center px-4 py-2.5 text-sm"
                      style={{ gridTemplateColumns: '14px 2fr 1fr 1fr 1fr' }}>
                      <span className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-white">{r.color}</span>
                      <span className="text-right text-zinc-300 tabular-nums">{r.qty_sold}</span>
                      <span className="text-right text-white tabular-nums">{formatCurrency(r.revenue)}</span>
                      <span className="text-right text-zinc-400 tabular-nums text-xs">{r.pct}%</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2.5 border-t border-border bg-surface text-xs text-zinc-500 text-center">
                  {colorData.length} colores · {colorData.reduce((s,r)=>s+r.qty_sold,0)} unidades totales
                </div>
              </div>
            </div>
          )}
        </div>

      ) : tab === 'deudas' ? (
        /* ─── DEUDAS Y CUENTAS CORRIENTES ───────────────────────────────── */
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={loadDebt} disabled={debtLoading} className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
              <RefreshCw size={13} className={debtLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button onClick={() => {
              if (!debtData.length) return
              const fmt = n => '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2 })
              const semColor = d => d <= 30 ? '#16a34a' : d <= 60 ? '#d97706' : '#dc2626'
              const rows = debtData.map(r => `<tr><td>${r.name}</td><td>${r.phone||'—'}</td><td style="text-align:right;font-weight:bold">${fmt(r.debt)}</td><td>${r.last_purchase?new Date(r.last_purchase).toLocaleDateString('es-AR'):'—'}</td><td style="text-align:right;color:${semColor(r.days_since)}">${r.days_since >= 999?'Sin compras':r.days_since+' días'}</td></tr>`).join('')
              const total = debtData.reduce((s,r)=>s+r.debt,0)
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Deudas</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial;font-size:12px;padding:24px}h2{margin-bottom:12px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;padding:6px 8px;font-size:10px;text-transform:uppercase}td{padding:5px 8px;border-bottom:1px solid #eee}tr:nth-child(even)td{background:#fafafa}.total{font-weight:bold;background:#f0f0f0}@media print{@page{size:A4;margin:12mm}}</style></head><body><h2>Deudas y cuentas corrientes</h2><table><thead><tr><th>Cliente</th><th>Teléfono</th><th style="text-align:right">Deuda</th><th>Última compra</th><th style="text-align:right">Días</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="total"><td colspan="2">TOTAL DEUDA (${debtData.length} clientes)</td><td style="text-align:right">${fmt(total)}</td><td colspan="2"></td></tr></tfoot></table><script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`
              const w = window.open('','_blank','width=800,height=600'); w.document.write(html); w.document.close()
            }} disabled={!debtData.length} className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
              <Printer size={13} /> PDF
            </button>
            {debtData.length > 0 && (
              <div className="ml-auto text-right">
                <p className="text-xs text-zinc-500">Total deuda</p>
                <p className="text-lg font-bold text-accent tabular-nums">
                  {formatCurrency(debtData.reduce((s,r)=>s+r.debt,0))}
                </p>
              </div>
            )}
          </div>

          {debtLoading ? <div className="py-8 flex justify-center"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div> : debtData.length === 0 ? (
            <EmptyState icon={Users} title="Sin deudas pendientes" subtitle="Todos los clientes están al día 🎉" />
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px' }}>
                <span>Cliente</span><span>Teléfono</span>
                <span className="text-right">Deuda</span><span className="text-center">Última compra</span>
                <span className="text-center">Días sin pagar</span><span/>
              </div>
              <div className="divide-y divide-border">
                {debtData.map(r => {
                  const sem = r.days_since <= 30 ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : r.days_since <= 60 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                  const waMsg = encodeURIComponent(
                    `Hola ${r.name.split(' ')[0]}, te recordamos que tenés un saldo pendiente de $${Number(r.debt).toLocaleString('es-AR',{minimumFractionDigits:2})} en nuestra tienda. Cualquier consulta estamos a disposición. ¡Gracias!`
                  )
                  return (
                    <div key={r.id} className="row-alt grid items-center px-4 py-3 text-sm"
                      style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px' }}>
                      <span className="text-white font-medium truncate pr-2">{r.name}</span>
                      <span className="text-zinc-400 text-xs">{r.phone || '—'}</span>
                      <span className="text-right text-accent font-bold tabular-nums">{formatCurrency(r.debt)}</span>
                      <span className="text-center text-zinc-400 text-xs">
                        {r.last_purchase ? new Date(r.last_purchase).toLocaleDateString('es-AR') : '—'}
                      </span>
                      <span className="text-center">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full border', sem)}>
                          {r.days_since >= 999 ? 'Sin compras' : `${r.days_since}d`}
                        </span>
                      </span>
                      <div className="flex justify-end">
                        {r.phone && (
                          <a href={`https://wa.me/54${r.phone.replace(/\D/g,'')}?text=${waMsg}`}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="no-drag flex items-center gap-1 px-2 py-1.5 rounded-lg bg-green-600/10 text-green-400 hover:bg-green-600/20 text-xs transition-colors">
                            <MessageCircle size={11}/> WA
                          </a>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="px-4 py-3 border-t border-border bg-surface flex items-center justify-between text-sm">
                <span className="text-zinc-500 text-xs uppercase tracking-wider">{debtData.length} clientes con deuda</span>
                <span className="text-accent font-bold tabular-nums">{formatCurrency(debtData.reduce((s,r)=>s+r.debt,0))}</span>
              </div>
            </div>
          )}
        </div>

      ) : tab === 'precios' ? (
        /* ─── HISTORIAL DE PRECIOS ──────────────────────────────────────── */
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={phFrom} onChange={e => setPhFrom(e.target.value)} className={inputCls} />
            <span className="text-zinc-600">→</span>
            <input type="date" value={phTo} onChange={e => setPhTo(e.target.value)} className={inputCls} />
            <input value={phSearch} onChange={e => setPhSearch(e.target.value)}
              placeholder="Buscar producto..." className={`${inputCls} w-52`} />
            <button onClick={loadPH} disabled={phLoading} className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
              <RefreshCw size={13} className={phLoading ? 'animate-spin' : ''} /> Buscar
            </button>
          </div>

          {/* Selector de producto para ver evolución gráfica */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2"><Search size={13}/> Evolución de precio por producto</h3>
            <div className="flex gap-3">
              <select className={`${inputCls} flex-1`} value={phProductId} onChange={async e => {
                setPhProductId(e.target.value)
                if (e.target.value) {
                  const h = await api.reports.priceHistoryProduct({ productId: Number(e.target.value) })
                  setPhProductHistory(h)
                } else {
                  setPhProductHistory([])
                }
              }}>
                <option value="">— Seleccioná un producto —</option>
                {allProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.color ? ` (${p.color})` : ''}</option>)}
              </select>
            </div>
            {phProductHistory.length > 0 && (
              <div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={phProductHistory.map(r => ({
                    fecha: new Date(r.changed_at).toLocaleDateString('es-AR'),
                    precio: r.new_price,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" />
                    <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip formatter={v => [formatCurrency(v), 'Precio']} />
                    <Line type="monotone" dataKey="precio" stroke="#e91e8c" strokeWidth={2} dot={{ r: 4, fill: '#e91e8c' }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {[...phProductHistory].reverse().map(r => (
                    <div key={r.id} className="flex items-center gap-3 text-xs text-zinc-400 px-1">
                      <span className="w-28 shrink-0">{new Date(r.changed_at).toLocaleString('es-AR')}</span>
                      <span className="text-red-400 tabular-nums">{formatCurrency(r.old_price)}</span>
                      <span className="text-zinc-600">→</span>
                      <span className="text-green-400 tabular-nums">{formatCurrency(r.new_price)}</span>
                      <span className={cn('tabular-nums font-medium', r.new_price > r.old_price ? 'text-amber-400' : 'text-blue-400')}>
                        {r.new_price > r.old_price ? '+' : ''}{((r.new_price - r.old_price)/r.old_price*100).toFixed(1)}%
                      </span>
                      <span className="text-zinc-600 ml-auto">{r.changed_by}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tabla de cambios en el período */}
          {phLoading ? <div className="py-8 flex justify-center"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div> : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-surface flex items-center justify-between">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Cambios de precio en el período</h3>
                <span className="text-xs text-zinc-600">{phData.length} cambios</span>
              </div>
              {phData.length === 0 ? (
                <div className="py-8 flex items-center justify-center text-zinc-600 text-sm">Sin cambios de precio en el período</div>
              ) : (
                <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
                  <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2 border-b border-border bg-surface/50"
                    style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
                    <span>Producto</span><span className="text-right">Precio anterior</span>
                    <span className="text-right">Precio nuevo</span><span className="text-right">Variación</span>
                    <span className="text-right">Fecha · Usuario</span>
                  </div>
                  {phData.map(r => {
                    const diff = ((r.new_price - r.old_price) / r.old_price * 100).toFixed(1)
                    return (
                      <div key={r.id} className="row-alt grid items-center px-4 py-2.5 text-sm"
                        style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}>
                        <span className="text-white truncate pr-2">{r.product_name}</span>
                        <span className="text-right text-zinc-400 tabular-nums">{formatCurrency(r.old_price)}</span>
                        <span className="text-right text-white tabular-nums font-medium">{formatCurrency(r.new_price)}</span>
                        <span className={cn('text-right tabular-nums text-xs font-medium',
                          Number(diff) > 0 ? 'text-amber-400' : 'text-blue-400')}>
                          {Number(diff) > 0 ? '+' : ''}{diff}%
                        </span>
                        <div className="text-right">
                          <p className="text-zinc-400 text-xs">{new Date(r.changed_at).toLocaleDateString('es-AR')}</p>
                          <p className="text-zinc-600 text-[10px]">{r.changed_by}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      ) : tab === 'general' ? (
        <div className="space-y-6">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
            <span className="text-zinc-600">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
            <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className={inputCls}>
              <option value="day">Por día</option>
              <option value="month">Por mes</option>
            </select>
            <button onClick={load} disabled={loading} className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <div className="ml-auto flex gap-2">
              <button onClick={() => handleExport('sales')} disabled={exporting}
                className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
                <Download size={13} /> Ventas CSV
              </button>
              <button onClick={() => handleExport('products')} disabled={exporting}
                className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
                <Download size={13} /> Productos CSV
              </button>
            </div>
          </div>

          {/* KPIs */}
          {profitability && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total ventas', value: profitability.total_ventas, color: 'text-white' },
                { label: 'Ganancia bruta', value: profitability.ganancia_bruta, color: 'text-green-400' },
                { label: 'Gastos', value: profitability.gastos, color: 'text-red-400' },
                { label: 'Ganancia neta', value: profitability.ganancia_neta, color: profitability.ganancia_neta >= 0 ? 'text-emerald-400' : 'text-red-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">{label}</p>
                  <p className={`text-xl font-bold tabular-nums ${color}`}>{formatCurrency(value)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Trend chart */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-medium text-white mb-4">Evolución de ventas</h3>
            {trend.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trend} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
                  <XAxis dataKey="period" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} />
                  <YAxis stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                    tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="total" fill="#e91e8c" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-zinc-600 text-sm">Sin datos en el período</div>
            )}
          </div>

          {/* By category */}
          {byCategory.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-medium text-white mb-4">Ventas por categoría</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={byCategory} margin={{ left: -10 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" horizontal={false} />
                  <XAxis type="number" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false}
                    tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="category" stroke="#3f3f3f" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} width={90} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="revenue" fill="#6366f1" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top products */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-medium text-white">Ranking de productos más vendidos</h3>
            </div>
            {topProducts.length === 0 ? (
              <EmptyState icon={BarChart3} title="Sin datos en el período" />
            ) : (
              <div className="divide-y divide-border">
                <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2 border-b border-border bg-surface"
                  style={{ gridTemplateColumns: '30px 3fr 1fr 1fr 1fr' }}>
                  <span>#</span><span>Producto</span><span className="text-right">Unidades</span><span className="text-right">Ingresos</span><span className="text-right">Ganancia</span>
                </div>
                {topProducts.map((p, i) => (
                  <div key={p.product_id} className="row-alt grid items-center px-4 py-2.5 text-sm" style={{ gridTemplateColumns: '30px 3fr 1fr 1fr 1fr' }}>
                    <span className="text-zinc-600 font-bold">{i + 1}</span>
                    <span className="text-white truncate">{p.product_name}</span>
                    <span className="text-right text-zinc-300 tabular-nums">{p.qty_sold}</span>
                    <span className="text-right text-white tabular-nums">{formatCurrency(p.revenue)}</span>
                    <span className="text-right text-green-400 tabular-nums">{formatCurrency(p.profit)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Artículos tab */
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input type="date" value={artFrom} onChange={e => setArtFrom(e.target.value)} className={inputCls} />
            <span className="text-zinc-600">→</span>
            <input type="date" value={artTo} onChange={e => setArtTo(e.target.value)} className={inputCls} />
            <button onClick={loadArt} disabled={artLoading} className="btn-primary no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
              <RefreshCw size={13} className={artLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <input
              value={artSearch} onChange={e => setArtSearch(e.target.value)}
              placeholder="Buscar producto o color..."
              className={`${inputCls} w-64`}
            />
            <div className="ml-auto flex gap-2">
              <button onClick={exportArticulosCSV} disabled={filteredArt.length === 0}
                className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
                <Download size={13} /> CSV
              </button>
              <button onClick={printArticulosPDF} disabled={filteredArt.length === 0}
                className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
                <Printer size={13} /> PDF
              </button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {artLoading ? (
              <div className="py-4"><SkeletonTable rows={8} cols={7} /></div>
            ) : filteredArt.length === 0 ? (
              <EmptyState icon={Package} title="Sin datos" subtitle="Ajustá el período o buscá otro producto" />
            ) : (
              <>
                <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                  style={{ gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                  <span>Producto / Color / Talle</span>
                  <span className="text-right">Unidades</span>
                  <span className="text-right">P. promedio</span>
                  <span className="text-right">Total ventas</span>
                  <span className="text-right">Costo prom.</span>
                  <span className="text-right">Ganancia</span>
                  <span className="text-right">Margen</span>
                </div>
                <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
                  {filteredArt.map((r, i) => {
                    const margin = r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0
                    return (
                      <div key={i} className="row-alt grid items-center px-4 py-2.5 text-sm"
                        style={{ gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                        <div>
                          <span className="text-white font-medium">{r.product_name}</span>
                          {(r.color || r.size) && (
                            <span className="text-zinc-500 text-xs ml-2">
                              {[r.color, r.size && `T.${r.size}`].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                        <span className="text-right text-zinc-300 tabular-nums">{r.qty_sold}</span>
                        <span className="text-right text-zinc-300 tabular-nums">{formatCurrency(r.avg_price)}</span>
                        <span className="text-right text-white tabular-nums font-medium">{formatCurrency(r.revenue)}</span>
                        <span className="text-right text-zinc-400 tabular-nums">{r.avg_cost > 0 ? formatCurrency(r.avg_cost) : '—'}</span>
                        <span className="text-right text-green-400 tabular-nums">{formatCurrency(r.profit)}</span>
                        <span className={cn('text-right tabular-nums text-xs',
                          margin >= 30 ? 'text-green-400' : margin >= 10 ? 'text-amber-400' : 'text-red-400')}>
                          {margin.toFixed(1)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
                {/* Totals footer */}
                {filteredArt.length > 0 && (() => {
                  const totUnits = filteredArt.reduce((s, r) => s + r.qty_sold, 0)
                  const totRev = filteredArt.reduce((s, r) => s + r.revenue, 0)
                  const totProfit = filteredArt.reduce((s, r) => s + r.profit, 0)
                  const totMargin = totRev > 0 ? (totProfit / totRev) * 100 : 0
                  return (
                    <div className="grid items-center px-4 py-3 text-sm bg-surface border-t border-border font-medium"
                      style={{ gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                      <span className="text-zinc-400 uppercase text-xs tracking-wider">Total ({filteredArt.length} artículos)</span>
                      <span className="text-right text-white tabular-nums">{totUnits}</span>
                      <span></span>
                      <span className="text-right text-white tabular-nums">{formatCurrency(totRev)}</span>
                      <span></span>
                      <span className="text-right text-green-400 tabular-nums">{formatCurrency(totProfit)}</span>
                      <span className={cn('text-right tabular-nums text-xs',
                        totMargin >= 30 ? 'text-green-400' : totMargin >= 10 ? 'text-amber-400' : 'text-red-400')}>
                        {totMargin.toFixed(1)}%
                      </span>
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}
