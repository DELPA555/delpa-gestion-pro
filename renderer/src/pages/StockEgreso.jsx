import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  PackageMinus, Plus, Trash2, Search, ChevronLeft, ChevronRight,
  FileDown, MessageCircle, CheckCircle, Truck, RefreshCw, XCircle,
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

// ── Grilla de talles con stock y validación ───────────────────────────────────

function SizeGridEgreso({ sizes, onChange }) {
  if (!sizes?.length) return null
  const cols = Math.min(sizes.length, 8)
  return (
    <div className="grid gap-2 pt-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(50px, 1fr))` }}>
      {sizes.map(({ size, stock, qty }) => {
        const n    = qty || 0
        const warn = stock != null && n > stock
        return (
          <div key={size} className="flex flex-col items-center gap-0.5">
            <span className="text-[11px] text-zinc-400 font-mono font-medium">T.{size}</span>
            {stock != null && (
              <span className={cn('text-[9px] tabular-nums leading-none',
                stock === 0 ? 'text-red-400' : 'text-zinc-600')}>
                St:{stock}
              </span>
            )}
            <input
              type="number" min="0"
              value={n || ''}
              onChange={e => onChange(size, Math.max(0, Number(e.target.value) || 0))}
              className={cn(
                'w-full bg-[#0a0a0a] border rounded px-1 py-1.5 text-sm text-white text-center outline-none transition-colors no-drag',
                warn
                  ? 'border-amber-500 focus:border-amber-400'
                  : 'border-border focus:border-accent'
              )}
              placeholder="0"
            />
            {warn && (
              <span className="text-[8px] text-amber-400 leading-none">Máx {stock}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tarjeta de producto con grilla de talles ──────────────────────────────────

function ProductCardEgreso({ card, onUpdate, onRemove }) {
  const [search,  setSearch]  = useState(card.product_name || '')
  const [results, setResults] = useState([])
  const [open,    setOpen]    = useState(false)
  const dropRef   = useRef(null)
  const timer     = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSearch(q) {
    setSearch(q)
    if (!q) { onUpdate({ ...card, product_id: null, product_name: '', sizes: [] }); setOpen(false); return }
    clearTimeout(timer.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    timer.current = setTimeout(async () => {
      try {
        const res = await api.products.search(q) || []
        setResults(res)
        setOpen(res.length > 0)
      } catch {}
    }, 220)
  }

  async function pick(p) {
    setSearch(p.name)
    setResults([])
    setOpen(false)
    try {
      const full = await api.products.get(p.id)
      // Cargar TODOS los talles (incluso con stock 0) para poder devolver cualquier talle
      const sizes = (full?.sizes || []).map(s => ({ size: s.size, stock: s.stock ?? 0, qty: 0 }))
      onUpdate({ ...card, product_id: p.id, product_name: p.name, color: p.color || '', cost_price: p.cost || 0, sizes })
    } catch {
      onUpdate({ ...card, product_id: p.id, product_name: p.name, color: p.color || '', cost_price: p.cost || 0, sizes: [] })
    }
  }

  const totalQty = card.sizes.reduce((s, sz) => s + (sz.qty || 0), 0)
  const subtotal = totalQty * (Number(card.cost_price) || 0)
  const hasWarn  = card.sizes.some(sz => (sz.qty || 0) > (sz.stock ?? 999))

  return (
    <div className={cn(
      'p-4 bg-surface border rounded-xl space-y-3 transition-colors',
      hasWarn ? 'border-amber-500/40' : 'border-border'
    )}>
      {/* Búsqueda */}
      <div className="flex items-start gap-2">
        <div className="relative flex-1" ref={dropRef}>
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            className={cn(inputCls, 'pl-8')}
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Buscar producto por nombre o código..."
            autoComplete="off"
          />
          {open && results.length > 0 && (
            <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-[#111] border border-border rounded-xl shadow-2xl overflow-hidden max-h-52 overflow-y-auto">
              {results.slice(0, 10).map(p => {
                const totalStock = (p.sizes || []).reduce((s, sz) => s + (sz.stock || 0), 0)
                return (
                  <button key={p.id} type="button" onClick={() => pick(p)}
                    className="w-full text-left px-3 py-2.5 text-xs hover:bg-white/[0.06] transition-colors border-b border-border/40 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-medium truncate">{p.name}</span>
                      <span className={cn('text-[10px] shrink-0 tabular-nums',
                        totalStock === 0 ? 'text-red-400' : 'text-green-400')}>
                        Stock total: {totalStock}
                      </span>
                    </div>
                    {(p.color || p.cost) && (
                      <div className="flex gap-2 mt-0.5 text-zinc-500">
                        {p.color && <span>{p.color}</span>}
                        {p.cost  && <span>Costo: {formatCurrency(p.cost)}</span>}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button type="button" onClick={onRemove}
          className="no-drag mt-0.5 p-1.5 text-zinc-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10 shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Grilla de talles */}
      {card.product_id && card.sizes.length > 0 && (
        <>
          <SizeGridEgreso
            sizes={card.sizes}
            onChange={(size, qty) =>
              onUpdate({ ...card, sizes: card.sizes.map(s => s.size === size ? { ...s, qty } : s) })
            }
          />

          {/* Costo + resumen */}
          <div className="flex items-center gap-3 pt-2 border-t border-border/50">
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 whitespace-nowrap">Precio costo:</label>
              <input
                type="number" min="0" step="0.01"
                value={card.cost_price || ''}
                onChange={e => onUpdate({ ...card, cost_price: Number(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-28 bg-[#0a0a0a] border border-border rounded-lg px-2 py-1.5 text-sm text-white text-right outline-none focus:border-accent transition-colors no-drag"
              />
            </div>
            <div className="ml-auto text-right">
              <span className="text-xs text-zinc-500">Subtotal: </span>
              <span className="text-sm font-semibold text-accent tabular-nums">{formatCurrency(subtotal)}</span>
              <span className="text-xs text-zinc-600 ml-2">({totalQty} u.)</span>
            </div>
          </div>
        </>
      )}

      {card.product_id && card.sizes.length === 0 && (
        <p className="text-xs text-zinc-600 text-center py-1">Sin talles registrados para este producto</p>
      )}

      {!card.product_id && (
        <p className="text-xs text-zinc-600 text-center py-1">
          ← Buscá y seleccioná un producto para ver la grilla de talles
        </p>
      )}
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
                {data.egresos.map((e) => {
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
                  className="no-drag p-1.5 border border-border rounded-lg text-zinc-400 hover:text-white disabled:opacity-40">
                  <ChevronLeft size={15}/>
                </button>
                <span className="text-xs text-zinc-500">Pág. {page} / {data.pages}</span>
                <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page >= data.pages}
                  className="no-drag p-1.5 border border-border rounded-lg text-zinc-400 hover:text-white disabled:opacity-40">
                  <ChevronRight size={15}/>
                </button>
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

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="grid text-[11px] text-zinc-500 uppercase px-3 py-2 border-b border-border bg-surface"
                style={{ gridTemplateColumns: '2fr 70px 70px 60px 90px 90px' }}>
                <span>Producto</span><span className="text-center">Talle</span><span className="text-center">Color</span>
                <span className="text-right">Cant.</span><span className="text-right">Costo</span><span className="text-right">Subtotal</span>
              </div>
              <div className="divide-y divide-border">
                {(detail.items || []).map((item, i) => (
                  <div key={i} className="row-alt grid items-center px-3 py-2.5 text-sm"
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
                {(detail.status === 'pending' || detail.status === 'sent') && (
                  <button
                    onClick={() => {
                      if (window.confirm('¿Cancelar este egreso? El stock descontado será restaurado.')) {
                        updateStatus(detail.id, 'cancelled')
                      }
                    }}
                    className="no-drag flex items-center gap-1.5 px-3 py-2 text-sm bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors">
                    <XCircle size={13} /> Cancelar egreso
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
  const [cards,  setCards]  = useState([newCard()])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    api.suppliers.list({}).then(r => setSuppliers(r?.suppliers || [])).catch(() => {})
  }, [])

  function newCard() {
    return { _key: Date.now() + Math.random(), product_id: null, product_name: '', color: '', sizes: [], cost_price: 0 }
  }

  const addCard    = () => setCards(p => [...p, newCard()])
  const removeCard = (key) => setCards(p => p.filter(c => c._key !== key))
  const updateCard = (updated) => setCards(p => p.map(c => c._key === updated._key ? updated : c))

  const handleSupplier = (id) => {
    const sup = suppliers.find(s => String(s.id) === id)
    setForm(p => ({ ...p, supplier_id: id, supplier_name: sup?.name || '' }))
  }

  // Calcular totales sumando todas las tarjetas y talles
  const totalUnits  = cards.reduce((s, c) => s + c.sizes.reduce((ss, sz) => ss + (sz.qty || 0), 0), 0)
  const totalAmount = cards.reduce((s, c) => {
    const qty = c.sizes.reduce((ss, sz) => ss + (sz.qty || 0), 0)
    return s + qty * (Number(c.cost_price) || 0)
  }, 0)

  const confirmar = async () => {
    // Expandir tarjetas a lista plana de ítems (una entrada por talle con qty > 0)
    const validItems = []
    for (const card of cards) {
      if (!card.product_id) continue
      for (const sz of card.sizes) {
        if ((sz.qty || 0) > 0) {
          validItems.push({
            product_id:   card.product_id,
            product_name: card.product_name,
            color:        card.color || '',
            size:         sz.size,
            quantity:     sz.qty,
            cost_price:   Number(card.cost_price) || 0,
            stock_actual: sz.stock ?? null,
            subtotal:     (sz.qty || 0) * (Number(card.cost_price) || 0),
          })
        }
      }
    }
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

  // ── Pantalla de éxito post-confirmación ──
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
          <button onClick={() => { setResult(null); setCards([newCard()]); setForm(p => ({ ...p, notes: '' })) }}
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

        {/* Productos */}
        <p className="text-[11px] text-zinc-500 uppercase tracking-wider px-1">
          Productos a devolver — seleccioná el producto y distribuí cantidades por talle
        </p>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {cards.map(card => (
              <motion.div key={card._key}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.15 }}>
                <ProductCardEgreso card={card} onUpdate={updateCard} onRemove={() => removeCard(card._key)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <button type="button" onClick={addCard}
          className="no-drag flex items-center gap-2 px-4 py-2.5 w-full border border-dashed border-border rounded-xl text-zinc-500 hover:text-white hover:border-accent/50 transition-colors text-sm">
          <Plus size={14} /> Agregar producto
        </button>

        {/* Footer totales + confirmar */}
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
  const [view, setView] = useState('list')
  return view === 'list'
    ? <HistorialView onNew={() => setView('new')} />
    : <NuevoEgresoView onDone={() => setView('list')} />
}
