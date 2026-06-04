import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  PackageMinus, Plus, Trash2, X, Search, ChevronLeft, ChevronRight,
  FileDown, Send, MessageCircle, CheckCircle, Truck, RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'

const inputCls = 'w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag'

const REASONS = [
  { value: 'defecto',  label: 'Defecto de fábrica' },
  { value: 'talle',    label: 'Talle incorrecto' },
  { value: 'danada',   label: 'Mercadería dañada' },
  { value: 'exceso',   label: 'Exceso de stock' },
  { value: 'otro',     label: 'Otro' },
]

const STATUS_CFG = {
  pending:   { label: 'Pendiente',             cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  sent:      { label: 'Enviado',               cls: 'bg-blue-500/10  text-blue-400  border-blue-500/20'  },
  confirmed: { label: 'Confirmado proveedor',  cls: 'bg-green-500/10 text-green-400 border-green-500/20' },
}

// ── Fila de producto ──────────────────────────────────────────────────────────

function ItemRow({ item, index, onUpdate, onRemove }) {
  const [search, setSearch]   = useState(item.product_name || '')
  const [results, setResults] = useState([])
  const [open,    setOpen]    = useState(false)
  const ref = useRef(null)

  const doSearch = useCallback(async (q) => {
    if (q.length < 2) { setResults([]); return }
    try {
      const res = await api.products.search(q)
      setResults(res?.products || [])
      setOpen(true)
    } catch {}
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 220)
    return () => clearTimeout(t)
  }, [search, doSearch])

  const pick = (p) => {
    onUpdate(index, {
      product_id:   p.id,
      product_name: p.name,
      color:        p.color || '',
      cost_price:   p.cost || 0,
    })
    setSearch(p.name)
    setResults([])
    setOpen(false)
  }

  const subtotal = (Number(item.quantity) || 0) * (Number(item.cost_price) || 0)

  return (
    <div className="grid items-center gap-2 p-3 bg-surface border border-border rounded-xl"
      style={{ gridTemplateColumns: '2fr 80px 100px 110px 110px 36px' }}>
      {/* Producto */}
      <div className="relative" ref={ref}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className={cn(inputCls, 'pl-8')}
            value={search}
            onChange={e => { setSearch(e.target.value); onUpdate(index, { product_name: e.target.value }) }}
            placeholder="Buscar producto..."
          />
        </div>
        {open && results.length > 0 && (
          <div className="absolute top-full mt-1 w-full z-50 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
            {results.slice(0, 8).map(p => (
              <button key={p.id} type="button" onClick={() => pick(p)}
                className="w-full text-left px-3 py-2.5 text-xs hover:bg-white/5 transition-colors border-b border-border/50 last:border-0">
                <p className="text-white font-medium">{p.name}</p>
                <p className="text-zinc-500">{p.color || ''} · Costo: {formatCurrency(p.cost)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Talle */}
      <input
        className={inputCls}
        value={item.size || ''}
        onChange={e => onUpdate(index, { size: e.target.value })}
        placeholder="Talle"
      />

      {/* Cantidad */}
      <input
        type="number" min="1"
        className={cn(inputCls, 'text-center')}
        value={item.quantity || ''}
        onChange={e => onUpdate(index, { quantity: Number(e.target.value) })}
        placeholder="Cant."
      />

      {/* Precio costo */}
      <input
        type="number" min="0" step="0.01"
        className={cn(inputCls, 'text-right')}
        value={item.cost_price || ''}
        onChange={e => onUpdate(index, { cost_price: Number(e.target.value) })}
        placeholder="Costo"
      />

      {/* Subtotal */}
      <span className="text-sm font-semibold text-accent tabular-nums text-right pr-1">
        {formatCurrency(subtotal)}
      </span>

      <button type="button" onClick={() => onRemove(index)}
        className="no-drag p-1.5 text-zinc-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

// ── Vista historial ───────────────────────────────────────────────────────────

function HistorialView({ onNew }) {
  const [data,    setData]    = useState({ egresos: [], total: 0, pages: 1 })
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [detail,  setDetail]  = useState(null)
  const [saving,  setSaving]  = useState(false)

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    try { setData(await api.egreso.list({ page: p, limit: 30 })) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(page) }, [page, load])

  const openDetail = async (id) => {
    const d = await api.egreso.get(id)
    setDetail(d)
  }

  const generatePDF = async (id) => {
    setSaving(true)
    try {
      const res = await api.egreso.pdf(id)
      if (res?.ok) toast.success(`PDF guardado: ${res.filePath?.split('\\').pop()}`)
      else if (res) toast.info('Cancelado')
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setSaving(false) }
  }

  const updateStatus = async (id, status) => {
    await api.egreso.updateStatus({ id, status })
    await load(page)
    if (detail?.id === id) setDetail(d => d ? { ...d, status } : d)
    toast.success('Estado actualizado')
  }

  const totalUnits  = detail?.items?.reduce((s, i) => s + i.quantity, 0) ?? 0
  const totalAmount = detail?.items?.reduce((s, i) => s + i.subtotal,  0) ?? 0

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }} className="p-6 h-full flex flex-col">
        <PageHeader
          title="Egresos de Mercadería"
          subtitle="Devoluciones a proveedor"
          actions={
            <button onClick={onNew}
              className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
              <Plus size={15} /> Nuevo egreso
            </button>
          }
        />

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data.egresos.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-white/[0.04] flex items-center justify-center mb-4">
              <PackageMinus size={28} className="text-zinc-500" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Sin egresos registrados</h3>
            <p className="text-sm text-zinc-500 max-w-xs mb-6">
              Registrá una devolución a proveedor para llevar el control de las salidas de stock.
            </p>
            <button onClick={onNew}
              className="btn-primary no-drag flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold">
              <Plus size={16} /> Nuevo egreso
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                style={{ gridTemplateColumns: '1fr 100px 1.5fr 0.8fr 80px 80px 80px' }}>
                <span>N° Egreso</span>
                <span>Fecha</span>
                <span>Proveedor</span>
                <span>Motivo</span>
                <span className="text-right">Unidades</span>
                <span className="text-right">Total</span>
                <span className="text-center">Estado</span>
              </div>
              <div className="divide-y divide-border">
                {data.egresos.map((e, i) => {
                  const scfg = STATUS_CFG[e.status] || STATUS_CFG.pending
                  const reasonLabel = REASONS.find(r => r.value === e.reason)?.label || e.reason || '—'
                  return (
                    <div key={e.id}
                      onClick={() => openDetail(e.id)}
                      className="row-alt grid items-center px-4 py-3 text-sm cursor-pointer hover:bg-white/[0.02] transition-colors"
                      style={{ gridTemplateColumns: '1fr 100px 1.5fr 0.8fr 80px 80px 80px' }}>
                      <span className="text-accent font-mono font-semibold">{e.number}</span>
                      <span className="text-zinc-400 text-xs">{e.date}</span>
                      <span className="text-white truncate pr-2">{e.supplier_name || '—'}</span>
                      <span className="text-zinc-400 text-xs truncate">{reasonLabel}</span>
                      <span className="text-right text-zinc-300 tabular-nums">{e.total_units}</span>
                      <span className="text-right text-white tabular-nums font-medium">{formatCurrency(e.total_amount)}</span>
                      <span className="flex justify-center">
                        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border', scfg.cls)}>
                          {scfg.label.split(' ')[0]}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {data.pages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="no-drag p-1.5 border border-border rounded-lg text-zinc-400 hover:text-white disabled:opacity-40"><ChevronLeft size={15}/></button>
                <span className="text-xs text-zinc-500">Pág. {page} / {data.pages}</span>
                <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page >= data.pages}
                  className="no-drag p-1.5 border border-border rounded-lg text-zinc-400 hover:text-white disabled:opacity-40"><ChevronRight size={15}/></button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Modal de detalle */}
      <Modal open={!!detail} onClose={() => setDetail(null)}
        title={detail ? `Egreso ${detail.number}` : ''} width="max-w-2xl">
        {detail && (
          <div className="space-y-4">
            {/* Header info */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Proveedor',  value: detail.supplier_name || '—' },
                { label: 'Fecha',      value: detail.date },
                { label: 'Estado',     value: STATUS_CFG[detail.status]?.label || detail.status },
              ].map(s => (
                <div key={s.label} className="bg-surface rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">{s.label}</p>
                  <p className="text-sm font-medium text-white">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="bg-surface rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Motivo</p>
              <p className="text-sm text-white">{REASONS.find(r => r.value === detail.reason)?.label || detail.reason || '—'}</p>
              {detail.notes && <p className="text-xs text-zinc-500 mt-1">{detail.notes}</p>}
            </div>

            {/* Items table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="grid text-[11px] text-zinc-500 uppercase px-3 py-2 border-b border-border bg-surface"
                style={{ gridTemplateColumns: '2fr 70px 70px 60px 90px 90px' }}>
                <span>Producto</span><span className="text-center">Talle</span><span className="text-center">Color</span>
                <span className="text-right">Cant.</span><span className="text-right">Costo</span><span className="text-right">Subtotal</span>
              </div>
              <div className="divide-y divide-border">
                {(detail.items || []).map(item => (
                  <div key={item.id} className="row-alt grid items-center px-3 py-2.5 text-sm"
                    style={{ gridTemplateColumns: '2fr 70px 70px 60px 90px 90px' }}>
                    <span className="text-white truncate pr-1">{item.product_name}</span>
                    <span className="text-center text-zinc-400 font-mono text-xs">{item.size || '—'}</span>
                    <span className="text-center text-zinc-400 text-xs">{item.color || '—'}</span>
                    <span className="text-right text-zinc-300 tabular-nums">{item.quantity}</span>
                    <span className="text-right text-zinc-400 tabular-nums text-xs">{formatCurrency(item.cost_price)}</span>
                    <span className="text-right text-accent font-semibold tabular-nums">{formatCurrency(item.subtotal)}</span>
                  </div>
                ))}
              </div>
              <div className="grid px-3 py-2.5 border-t border-border bg-surface font-medium"
                style={{ gridTemplateColumns: '2fr 70px 70px 60px 90px 90px' }}>
                <span className="text-zinc-400 text-xs uppercase">Total</span>
                <span></span><span></span>
                <span className="text-right text-white tabular-nums">{totalUnits}</span>
                <span></span>
                <span className="text-right text-accent font-bold tabular-nums">{formatCurrency(totalAmount)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 flex-wrap">
              <button onClick={() => generatePDF(detail.id)} disabled={saving}
                className="no-drag flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
                <FileDown size={14} /> {saving ? 'Generando...' : 'Generar PDF'}
              </button>
              {detail.supplier?.phone && (
                <a href={`https://wa.me/54${detail.supplier.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Hola! Te adjunto el egreso ${detail.number} por ${formatCurrency(totalAmount)}. Unidades devueltas: ${totalUnits}. Motivo: ${REASONS.find(r=>r.value===detail.reason)?.label||detail.reason}.`)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="no-drag flex items-center gap-1.5 px-3 py-2 text-sm border border-green-500/30 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors">
                  <MessageCircle size={14} /> WhatsApp
                </a>
              )}
              <div className="ml-auto flex gap-2">
                {detail.status === 'pending' && (
                  <button onClick={() => updateStatus(detail.id, 'sent')}
                    className="no-drag flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors">
                    <Truck size={13} /> Marcar enviado
                  </button>
                )}
                {detail.status === 'sent' && (
                  <button onClick={() => updateStatus(detail.id, 'confirmed')}
                    className="no-drag flex items-center gap-1.5 px-3 py-2 text-sm bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors">
                    <CheckCircle size={13} /> Confirmado por proveedor
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

// ── Vista formulario nuevo egreso ─────────────────────────────────────────────

function NuevoEgresoView({ onDone }) {
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState({
    supplier_id: '', supplier_name: '',
    date: new Date().toISOString().split('T')[0],
    reason: 'defecto', notes: '',
  })
  const [items,   setItems]   = useState([newItem()])
  const [saving,  setSaving]  = useState(false)
  const [result,  setResult]  = useState(null) // { id, number, warnings }

  useEffect(() => {
    api.suppliers.list({}).then(r => setSuppliers(r?.suppliers || [])).catch(() => {})
  }, [])

  function newItem() {
    return { _key: Date.now() + Math.random(), product_id: null, product_name: '', size: '', color: '', quantity: 1, cost_price: 0 }
  }

  const addItem  = () => setItems(p => [...p, newItem()])
  const removeItem = (idx) => setItems(p => p.filter((_, i) => i !== idx))
  const updateItem = (idx, patch) => setItems(p => p.map((it, i) => i === idx ? { ...it, ...patch } : it))

  const totalUnits  = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const totalAmount = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.cost_price) || 0), 0)

  const handleSupplier = (id) => {
    const sup = suppliers.find(s => String(s.id) === id)
    setForm(p => ({ ...p, supplier_id: id, supplier_name: sup?.name || '' }))
  }

  const confirmar = async () => {
    const validItems = items.filter(i => i.product_name.trim() && (Number(i.quantity) || 0) > 0)
    if (!validItems.length) { toast.error('Agregá al menos un producto con cantidad'); return }
    setSaving(true)
    try {
      const res = await api.egreso.create({ ...form, items: validItems, total_amount: totalAmount, total_units: totalUnits })
      if (!res.ok) { toast.error(res.error || 'Error al crear egreso'); return }
      setResult(res)
      if (res.warnings?.length) toast.warning(res.warnings.join('\n'), { duration: 6000 })
      else toast.success(`Egreso ${res.number} creado correctamente`)
    } catch (e) {
      toast.error(e.message || 'Error al crear egreso')
    } finally {
      setSaving(false)
    }
  }

  const generatePDF = async () => {
    if (!result?.id) return
    setSaving(true)
    try {
      const r = await api.egreso.pdf(result.id)
      if (r?.ok) toast.success(`PDF guardado: ${r.filePath?.split('\\').pop()}`)
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  // ── Resultado post-confirmación ──
  if (result) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
        className="p-6 h-full flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
          <CheckCircle size={32} className="text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-1">{result.number}</h2>
        <p className="text-zinc-400 mb-2">Egreso creado · {totalUnits} unidades · {formatCurrency(totalAmount)}</p>
        {result.warnings?.length > 0 && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl max-w-sm text-xs text-amber-300 text-left space-y-1">
            <p className="font-semibold mb-1">⚠ Advertencias:</p>
            {result.warnings.map((w, i) => <p key={i}>· {w}</p>)}
          </div>
        )}
        <div className="flex gap-3 flex-wrap justify-center mt-4">
          <button onClick={generatePDF} disabled={saving}
            className="no-drag flex items-center gap-2 px-5 py-2.5 bg-card border border-border rounded-xl text-sm text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
            <FileDown size={15} /> {saving ? 'Generando...' : 'Generar PDF'}
          </button>
          <button onClick={() => { setResult(null); setItems([newItem()]); setForm(p => ({ ...p, notes: '' })) }}
            className="no-drag flex items-center gap-2 px-5 py-2.5 bg-card border border-border rounded-xl text-sm text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
            <Plus size={15} /> Nuevo egreso
          </button>
          <button onClick={onDone}
            className="no-drag btn-primary px-5 py-2.5 rounded-xl text-sm flex items-center gap-2">
            <PackageMinus size={15} /> Ver historial
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }} className="p-6 h-full flex flex-col">
      <PageHeader
        title="Nuevo Egreso de Mercadería"
        subtitle="Devolución a proveedor"
        actions={
          <button onClick={onDone}
            className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white transition-colors">
            ← Volver al historial
          </button>
        }
      />

      <div className="flex-1 overflow-auto space-y-4">
        {/* Datos generales */}
        <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Proveedor</label>
            <select className={inputCls} value={form.supplier_id} onChange={e => handleSupplier(e.target.value)}>
              <option value="">— Sin especificar —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Fecha</label>
            <input type="date" className={inputCls} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Motivo de devolución</label>
            <select className={inputCls} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}>
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Observaciones</label>
            <input className={inputCls} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Opcional..." />
          </div>
        </div>

        {/* Cabecera de tabla */}
        <div className="grid text-[11px] text-zinc-500 uppercase px-3 py-1.5"
          style={{ gridTemplateColumns: '2fr 80px 100px 110px 110px 36px' }}>
          <span>Producto</span>
          <span className="text-center">Talle</span>
          <span className="text-center">Cantidad</span>
          <span className="text-right">Precio costo</span>
          <span className="text-right">Subtotal</span>
          <span />
        </div>

        {/* Filas */}
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {items.map((item, idx) => (
              <motion.div key={item._key}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.15 }}>
                <ItemRow item={item} index={idx} onUpdate={updateItem} onRemove={removeItem} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Agregar línea */}
        <button type="button" onClick={addItem}
          className="no-drag flex items-center gap-2 px-4 py-2.5 w-full border border-dashed border-border rounded-xl text-zinc-500 hover:text-white hover:border-accent/50 transition-colors text-sm">
          <Plus size={14} /> Agregar línea
        </button>

        {/* Footer con totales y confirmar */}
        <div className="flex items-center gap-4 bg-card border border-border rounded-xl px-5 py-4">
          <div className="flex-1 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500">Total unidades</p>
              <p className="text-xl font-bold text-white tabular-nums">{totalUnits}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Crédito a favor</p>
              <p className="text-xl font-bold text-accent tabular-nums">{formatCurrency(totalAmount)}</p>
            </div>
          </div>
          <button onClick={confirmar} disabled={saving || totalUnits === 0}
            className="no-drag btn-primary flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold disabled:opacity-50">
            <PackageMinus size={16} />
            {saving ? 'Confirmando...' : 'Confirmar egreso'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function StockEgreso() {
  const [view, setView] = useState('list') // 'list' | 'new'
  return view === 'list'
    ? <HistorialView onNew={() => setView('new')} />
    : <NuevoEgresoView onDone={() => setView('list')} />
}
