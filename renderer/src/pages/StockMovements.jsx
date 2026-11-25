import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Boxes, X, FileSpreadsheet, ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, cn } from '@/lib/utils'
import { exportXlsx } from '@/lib/xlsx'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

// Metadatos por tipo de movimiento: etiqueta legible y color del badge.
const TIPO_META = {
  venta:            { label: 'Venta',            cls: 'text-red-400 bg-red-500/10' },
  venta_online:     { label: 'Venta online',     cls: 'text-rose-400 bg-rose-500/10' },
  cambio:           { label: 'Cambio',           cls: 'text-amber-400 bg-amber-500/10' },
  devolucion:       { label: 'Devolución',       cls: 'text-green-400 bg-green-500/10' },
  ingreso:          { label: 'Ingreso',          cls: 'text-green-400 bg-green-500/10' },
  egreso:           { label: 'Egreso',           cls: 'text-red-400 bg-red-500/10' },
  egreso_cancelado: { label: 'Egreso cancelado', cls: 'text-emerald-400 bg-emerald-500/10' },
  ajuste:           { label: 'Ajuste',           cls: 'text-blue-400 bg-blue-500/10' },
  alta:             { label: 'Alta',             cls: 'text-cyan-400 bg-cyan-500/10' },
  'seña':           { label: 'Seña',             cls: 'text-orange-400 bg-orange-500/10' },
  'seña_cancelada': { label: 'Seña cancelada',   cls: 'text-emerald-400 bg-emerald-500/10' },
  transferencia:    { label: 'Transferencia',    cls: 'text-purple-400 bg-purple-500/10' },
}
const tipoMeta = (t) => TIPO_META[t] || { label: (t || '—').replace(/_/g, ' '), cls: 'text-zinc-400 bg-zinc-500/10' }

const LIMIT = 50
const GRID = '150px 120px 2fr 90px 120px 2fr'

export default function StockMovements() {
  const [data, setData] = useState({ rows: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [opts, setOpts] = useState({ tipos: [], categories: [] })

  // Filtros
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [tipo, setTipo] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')

  const filters = useCallback((extra = {}) => ({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    tipo: tipo || undefined,
    category: category || undefined,
    search: search.trim() || undefined,
    ...extra,
  }), [dateFrom, dateTo, tipo, category, search])

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.stockMovements.list(filters({ page, limit: LIMIT }))) }
    finally { setLoading(false) }
  }, [filters, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { api.stockMovements.filters().then(setOpts).catch(() => {}) }, [])
  // Al cambiar cualquier filtro, volver a la página 1.
  useEffect(() => { setPage(1) }, [dateFrom, dateTo, tipo, category, search])

  const hasFilters = dateFrom || dateTo || tipo || category || search
  const clearFilters = () => { setDateFrom(''); setDateTo(''); setTipo(''); setCategory(''); setSearch('') }

  const onExport = async () => {
    setExporting(true)
    try {
      const all = await api.stockMovements.list(filters({ page: 1, limit: 100000 }))
      const ok = exportXlsx('movimientos_stock', all.rows, [
        { key: 'created_at', header: 'Fecha y hora', format: v => formatDateTime(v) },
        { key: 'tipo', header: 'Tipo', format: v => tipoMeta(v).label },
        { key: 'product_name', header: 'Producto' },
        { key: 'size', header: 'Talle', format: v => (v && v !== 'N/A' ? v : '') },
        { key: 'color', header: 'Color' },
        { key: 'category', header: 'Categoría' },
        { key: 'cantidad', header: 'Cantidad' },
        { key: 'stock_anterior', header: 'Stock anterior' },
        { key: 'stock_nuevo', header: 'Stock nuevo' },
        { key: 'referencia_tipo', header: 'Ref. tipo' },
        { key: 'referencia_id', header: 'Ref. N°' },
        { key: 'usuario', header: 'Usuario' },
        { key: 'detalle', header: 'Detalle' },
      ])
      if (!ok) alert('No hay movimientos para exportar con esos filtros.')
    } finally {
      setExporting(false)
    }
  }

  const inputCls = 'input-field bg-card border border-border rounded-lg px-3 py-2 text-sm text-white no-drag'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Movimientos de stock" subtitle={`${data.total} movimientos registrados`} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Desde
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Hasta
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
        </label>
        <select value={tipo} onChange={e => setTipo(e.target.value)} className={inputCls}>
          <option value="">Todos los tipos</option>
          {opts.tipos.map(t => <option key={t} value={t}>{tipoMeta(t).label}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls}>
          <option value="">Todas las categorías</option>
          {opts.categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar producto, detalle…" className={cn(inputCls, 'flex-1 min-w-[180px]')}
        />
        {hasFilters && (
          <button onClick={clearFilters} className="text-zinc-500 hover:text-white p-2" title="Limpiar filtros">
            <X size={14} />
          </button>
        )}
        <button
          onClick={onExport} disabled={exporting || data.total === 0}
          className="ml-auto flex items-center gap-2 text-sm bg-card border border-border rounded-lg px-3 py-2 text-emerald-400 hover:text-emerald-300 disabled:opacity-40 no-drag"
        >
          <FileSpreadsheet size={15} /> {exporting ? 'Exportando…' : 'Exportar a Excel'}
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: GRID }}>
          <span>Fecha y hora</span><span>Tipo</span><span>Producto</span>
          <span className="text-right">Cantidad</span><span className="text-center">Stock</span><span>Referencia</span>
        </div>
        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={8} cols={6} />
            : data.rows.length === 0 ? (
              <EmptyState icon={Boxes} title="Sin movimientos de stock" subtitle="No hay movimientos para los filtros elegidos." />
            ) : data.rows.map(m => {
              const meta = tipoMeta(m.tipo)
              const extra = [m.size && m.size !== 'N/A' ? `T. ${m.size}` : '', m.color].filter(Boolean).join(' · ')
              return (
                <div key={m.id} className="row-alt grid items-center px-4 py-2.5 text-sm" style={{ gridTemplateColumns: GRID }}>
                  <span className="text-zinc-400 text-xs">{formatDateTime(m.created_at)}</span>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium w-fit', meta.cls)}>{meta.label}</span>
                  <span className="text-zinc-200 pr-2">
                    {m.product_name || '—'}
                    {extra && <span className="block text-[11px] text-zinc-500">{extra}</span>}
                  </span>
                  <span className={cn('text-right font-medium tabular-nums', m.cantidad < 0 ? 'text-red-400' : 'text-green-400')}>
                    {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                  </span>
                  <span className="text-center text-xs text-zinc-400 flex items-center justify-center gap-1 tabular-nums">
                    {m.stock_anterior} <ArrowRight size={11} className="text-zinc-600" /> <span className="text-zinc-200">{m.stock_nuevo}</span>
                  </span>
                  <span className="text-zinc-400 text-xs pr-2">
                    {m.detalle || (m.referencia_tipo ? `${m.referencia_tipo}${m.referencia_id ? ' #' + m.referencia_id : ''}` : '—')}
                    {m.usuario && <span className="block text-[11px] text-zinc-600">por {m.usuario}</span>}
                  </span>
                </div>
              )
            })}
        </div>
        <Pagination page={page} pages={data.pages} total={data.total} limit={LIMIT} onChange={setPage} />
      </div>
    </motion.div>
  )
}
