import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Package, DollarSign, Store, RefreshCw, FileSpreadsheet, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import HelpButton from '@/components/HelpButton'

// Formato ARS sin centavos (ej: $ 1.234.567) y números con separador de miles.
const fmtARS = (n) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0)
const fmtNum = (n) => new Intl.NumberFormat('es-AR').format(Number(n) || 0)

const EMPTY_TOTALS = { total_productos: 0, total_unidades: 0, valor_costo: 0, valor_publico: 0 }

export default function Valorizacion() {
  const [totals, setTotals] = useState(EMPTY_TOTALS)
  const [byCategory, setByCategory] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.valuation.data()
      setTotals(res?.totals || EMPTY_TOTALS)
      setByCategory(res?.byCategory || [])
    } catch (e) {
      toast.error('No se pudo cargar la valorización: ' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const exportExcel = () => {
    if (byCategory.length === 0) return toast.error('No hay datos para exportar')
    const rows = [
      ['Categoría', 'Productos', 'Unidades', 'Valor costo', 'Valor público'],
      ...byCategory.map((c) => [
        c.categoria,
        Number(c.total_productos) || 0,
        Number(c.total_unidades) || 0,
        Math.round(Number(c.valor_costo) || 0),
        Math.round(Number(c.valor_publico) || 0),
      ]),
      [
        'TOTAL',
        Number(totals.total_productos) || 0,
        Number(totals.total_unidades) || 0,
        Math.round(Number(totals.valor_costo) || 0),
        Math.round(Number(totals.valor_publico) || 0),
      ],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Valorización')
    const fecha = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `Valorización de Stock - ${fecha}.xlsx`)
    toast.success('Excel exportado')
  }

  const cards = [
    { key: 'u', Icon: Package,    label: 'Cantidad de artículos', value: fmtNum(totals.total_unidades), hint: `${fmtNum(totals.total_productos)} productos`, color: 'text-sky-400',    ring: 'bg-sky-500/10' },
    { key: 'c', Icon: DollarSign, label: 'Valor al costo',        value: fmtARS(totals.valor_costo),      hint: 'Inversión en stock',                             color: 'text-amber-400',  ring: 'bg-amber-500/10' },
    { key: 'p', Icon: Store,      label: 'Valor al público',      value: fmtARS(totals.valor_publico),    hint: 'A precio de venta',                              color: 'text-emerald-400', ring: 'bg-emerald-500/10' },
  ]

  return (
    <div className="p-6">
      <PageHeader
        title="Valorización de Stock"
        subtitle="Valor del inventario al costo y al público, con desglose por categoría"
        actions={
          <>
            <HelpButton />
            <button onClick={load} disabled={loading}
              className="no-drag flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border text-zinc-300 hover:text-white hover:bg-white/5 disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button onClick={exportExcel} disabled={loading || byCategory.length === 0}
              className="no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:brightness-110 disabled:opacity-50">
              <FileSpreadsheet size={15} /> Exportar a Excel
            </button>
          </>
        }
      />

      {/* Cards de resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {cards.map(({ key, Icon, label, value, hint, color, ring }) => (
          <motion.div key={key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', ring)}>
                <Icon size={20} className={color} />
              </div>
              <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
            </div>
            <p className={cn('mt-3 text-2xl font-extrabold tabular-nums', color)}>
              {loading ? '—' : value}
            </p>
            <p className="text-xs text-zinc-500 mt-1">{hint}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabla por categoría */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-white">Desglose por categoría</h2>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500 px-5 py-10 text-sm">
            <Loader2 size={16} className="animate-spin" /> Calculando…
          </div>
        ) : byCategory.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-zinc-500">
            No hay productos activos con stock para valorizar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-border">
                  <th className="px-5 py-3 font-medium">Categoría</th>
                  <th className="px-5 py-3 font-medium text-right">Productos</th>
                  <th className="px-5 py-3 font-medium text-right">Unidades</th>
                  <th className="px-5 py-3 font-medium text-right">Valor costo</th>
                  <th className="px-5 py-3 font-medium text-right">Valor público</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((c, i) => (
                  <tr key={i} className="border-b border-border/60 hover:bg-white/[0.02]">
                    <td className="px-5 py-2.5 text-white">{c.categoria}</td>
                    <td className="px-5 py-2.5 text-right text-zinc-300 tabular-nums">{fmtNum(c.total_productos)}</td>
                    <td className="px-5 py-2.5 text-right text-zinc-300 tabular-nums">{fmtNum(c.total_unidades)}</td>
                    <td className="px-5 py-2.5 text-right text-amber-300 tabular-nums">{fmtARS(c.valor_costo)}</td>
                    <td className="px-5 py-2.5 text-right text-emerald-300 tabular-nums">{fmtARS(c.valor_publico)}</td>
                  </tr>
                ))}
                <tr className="bg-white/[0.04] font-bold border-t border-border">
                  <td className="px-5 py-3 text-white">TOTAL</td>
                  <td className="px-5 py-3 text-right text-white tabular-nums">{fmtNum(totals.total_productos)}</td>
                  <td className="px-5 py-3 text-right text-white tabular-nums">{fmtNum(totals.total_unidades)}</td>
                  <td className="px-5 py-3 text-right text-amber-400 tabular-nums">{fmtARS(totals.valor_costo)}</td>
                  <td className="px-5 py-3 text-right text-emerald-400 tabular-nums">{fmtARS(totals.valor_publico)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
