import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Ticket, Plus, Trash2, Pencil, X, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import Modal from '@/components/shared/Modal'

const TYPES = [
  { v: '2x1',          label: '2x1 (lleva 2 paga 1)',        desc: 'El más barato de cada par sale gratis.' },
  { v: 'nxm',          label: 'Nx M (lleva N paga M)',       desc: 'Ej: 3x2. El/los más baratos van gratis.' },
  { v: 'price_bundle', label: 'N por precio especial',       desc: 'Ej: 2 remeras por $3000.' },
  { v: 'qty_discount', label: 'Descuento por cantidad',      desc: 'Ej: desde 3 unidades, 15% off.' },
  { v: 'combo',        label: 'Combo de productos',          desc: 'Productos específicos juntos a un precio.' },
]
const typeLabel = (t) => (TYPES.find(x => x.v === t)?.label) || t
const money = (n) => '$' + (Number(n) || 0).toLocaleString('es-AR')

const EMPTY = {
  id: null, name: '', type: '2x1', applies_to: 'all', applies_value: '',
  active: 1, starts_at: '', ends_at: '',
  n: 3, pay: 2, qty: 2, price: 0, minQty: 3, percent: 15, comboItems: [],
}

const inputCls = 'w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600'
const labelCls = 'text-xs text-zinc-400 font-medium'

export default function Promotions() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [cats, setCats] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setList(await api.promotions.list()) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { api.stockMovements.filters().then(r => setCats(r?.categories || [])).catch(() => {}) }, [])

  const openNew = () => { setForm(EMPTY); setOpen(true) }
  const openEdit = (p) => {
    let cfg = {}; try { cfg = JSON.parse(p.config || '{}') } catch {}
    setForm({
      id: p.id, name: p.name, type: p.type, applies_to: p.applies_to || 'all',
      applies_value: p.applies_value || '', active: p.active, starts_at: p.starts_at || '', ends_at: p.ends_at || '',
      n: cfg.n || 3, pay: cfg.pay || 2, qty: cfg.qty || 2, price: cfg.price || 0,
      minQty: cfg.minQty || 3, percent: cfg.percent || 15,
      comboItems: Array.isArray(cfg._comboItems) ? cfg._comboItems : (cfg.productIds || []).map(id => ({ id, name: 'Producto #' + id })),
    })
    setOpen(true)
  }

  const buildConfig = (f) => {
    if (f.type === 'nxm') return { n: Number(f.n), pay: Number(f.pay) }
    if (f.type === 'price_bundle') return { qty: Number(f.qty), price: Number(f.price) }
    if (f.type === 'qty_discount') return { minQty: Number(f.minQty), percent: Number(f.percent) }
    if (f.type === 'combo') return { productIds: f.comboItems.map(i => i.id), price: Number(f.price), _comboItems: f.comboItems }
    return {}
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        id: form.id, name: form.name.trim(), type: form.type, config: buildConfig(form),
        applies_to: form.type === 'combo' ? 'all' : form.applies_to,
        applies_value: form.applies_to === 'all' || form.type === 'combo' ? null : form.applies_value,
        active: form.active ? 1 : 0,
        starts_at: form.starts_at || null, ends_at: form.ends_at || null,
      }
      if (form.id) await api.promotions.update(payload)
      else await api.promotions.create(payload)
      setOpen(false); load()
    } finally { setSaving(false) }
  }

  const toggleActive = async (p) => {
    let cfg = {}; try { cfg = JSON.parse(p.config || '{}') } catch {}
    await api.promotions.update({ ...p, config: cfg, active: p.active ? 0 : 1 })
    load()
  }
  const remove = async (p) => {
    if (!confirm(`¿Eliminar la promoción "${p.name}"?`)) return
    await api.promotions.delete(p.id); load()
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="p-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Promociones" subtitle="Se aplican solas en la venta" />
        <button onClick={openNew} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm rounded-lg">
          <Plus size={15} /> Nueva promoción
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden mt-4">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '2fr 1.4fr 1.4fr 90px 120px' }}>
          <span>Nombre</span><span>Tipo</span><span>Aplica a</span><span>Estado</span><span className="text-right">Acciones</span>
        </div>
        <div className="divide-y divide-border">
          {loading ? <div className="p-6 text-zinc-500 text-sm">Cargando…</div>
            : list.length === 0 ? <EmptyState icon={Ticket} title="Sin promociones" subtitle="Creá tu primera promo." />
            : list.map(p => (
              <div key={p.id} className="row-alt grid items-center px-4 py-2.5 text-sm" style={{ gridTemplateColumns: '2fr 1.4fr 1.4fr 90px 120px' }}>
                <span className="text-white">{p.name}</span>
                <span className="text-zinc-400">{typeLabel(p.type)}</span>
                <span className="text-zinc-400">{p.applies_to === 'all' ? 'Todo' : p.applies_to === 'category' ? `Cat: ${p.applies_value}` : p.applies_to === 'product' ? `Producto` : 'Todo'}</span>
                <button onClick={() => toggleActive(p)} className={cn('text-xs px-2 py-0.5 rounded-full font-medium w-fit', p.active ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-500 bg-zinc-500/10')}>
                  {p.active ? 'Activa' : 'Inactiva'}
                </button>
                <div className="flex justify-end gap-1">
                  <button onClick={() => openEdit(p)} className="text-zinc-400 hover:text-white p-1.5"><Pencil size={14} /></button>
                  <button onClick={() => remove(p)} className="text-red-400 hover:text-red-300 p-1.5"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Editar promoción' : 'Nueva promoción'}>
        <PromoForm form={form} setForm={setForm} cats={cats} />
        <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-border">
          <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-border text-zinc-300 hover:text-white">Cancelar</button>
          <button onClick={save} disabled={saving || !form.name.trim()} className="btn-primary px-5 py-2 text-sm rounded-lg disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </Modal>
    </motion.div>
  )
}

function PromoForm({ form, setForm, cats }) {
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Nombre</label>
        <input className={cn(inputCls, 'mt-1')} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej: 2x1 en remeras" />
      </div>
      <div>
        <label className={labelCls}>Tipo de promoción</label>
        <select className={cn(inputCls, 'mt-1')} value={form.type} onChange={e => set('type', e.target.value)}>
          {TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <p className="text-xs text-zinc-600 mt-1">{TYPES.find(t => t.v === form.type)?.desc}</p>
      </div>

      {/* Parámetros por tipo */}
      {form.type === 'nxm' && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Lleva (N)</label><input type="number" min="2" className={cn(inputCls, 'mt-1')} value={form.n} onChange={e => set('n', e.target.value)} /></div>
          <div><label className={labelCls}>Paga (M)</label><input type="number" min="1" className={cn(inputCls, 'mt-1')} value={form.pay} onChange={e => set('pay', e.target.value)} /></div>
        </div>
      )}
      {form.type === 'price_bundle' && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Cantidad</label><input type="number" min="1" className={cn(inputCls, 'mt-1')} value={form.qty} onChange={e => set('qty', e.target.value)} /></div>
          <div><label className={labelCls}>Precio del combo</label><input type="number" min="0" className={cn(inputCls, 'mt-1')} value={form.price} onChange={e => set('price', e.target.value)} /></div>
        </div>
      )}
      {form.type === 'qty_discount' && (
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Desde (unidades)</label><input type="number" min="1" className={cn(inputCls, 'mt-1')} value={form.minQty} onChange={e => set('minQty', e.target.value)} /></div>
          <div><label className={labelCls}>% de descuento</label><input type="number" min="0" max="100" className={cn(inputCls, 'mt-1')} value={form.percent} onChange={e => set('percent', e.target.value)} /></div>
        </div>
      )}
      {form.type === 'combo' && (
        <div className="space-y-3">
          <ComboPicker items={form.comboItems} onChange={(items) => set('comboItems', items)} />
          <div><label className={labelCls}>Precio del combo</label><input type="number" min="0" className={cn(inputCls, 'mt-1')} value={form.price} onChange={e => set('price', e.target.value)} /></div>
        </div>
      )}

      {/* Alcance (no combo) */}
      {form.type !== 'combo' && (
        <div>
          <label className={labelCls}>¿A qué productos aplica?</label>
          <select className={cn(inputCls, 'mt-1')} value={form.applies_to} onChange={e => set('applies_to', e.target.value)}>
            <option value="all">Todos los productos</option>
            <option value="category">Una categoría</option>
            <option value="product">Un producto</option>
          </select>
          {form.applies_to === 'category' && (
            <select className={cn(inputCls, 'mt-2')} value={form.applies_value} onChange={e => set('applies_value', e.target.value)}>
              <option value="">Elegí una categoría…</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {form.applies_to === 'product' && (
            <ProductPicker value={form.applies_value} onPick={(p) => set('applies_value', String(p.id))} />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Desde (opcional)</label><input type="date" className={cn(inputCls, 'mt-1')} value={form.starts_at} onChange={e => set('starts_at', e.target.value)} /></div>
        <div><label className={labelCls}>Hasta (opcional)</label><input type="date" className={cn(inputCls, 'mt-1')} value={form.ends_at} onChange={e => set('ends_at', e.target.value)} /></div>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked ? 1 : 0)} className="w-4 h-4 accent-[var(--accent,#6366f1)]" />
        Promoción activa
      </label>
    </div>
  )
}

function ProductPicker({ value, onPick }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  useEffect(() => {
    if (!q.trim()) { setRes([]); return }
    let on = true
    const t = setTimeout(() => api.products.search(q).then(r => { if (on) setRes((r || []).slice(0, 8)) }).catch(() => {}), 250)
    return () => { on = false; clearTimeout(t) }
  }, [q])
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 bg-[#0a0a0a] border border-border rounded-lg px-2">
        <Search size={14} className="text-zinc-500" />
        <input className="flex-1 bg-transparent py-2 text-sm text-white outline-none" placeholder={value ? `Producto #${value} — buscar otro…` : 'Buscar producto…'} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {res.length > 0 && (
        <div className="mt-1 border border-border rounded-lg overflow-hidden">
          {res.map(p => (
            <button key={p.id} onClick={() => { onPick(p); setQ(''); setRes([]) }} className="block w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/5">
              {p.name} {p.color ? <span className="text-zinc-500">· {p.color}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ComboPicker({ items, onChange }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  useEffect(() => {
    if (!q.trim()) { setRes([]); return }
    let on = true
    const t = setTimeout(() => api.products.search(q).then(r => { if (on) setRes((r || []).slice(0, 8)) }).catch(() => {}), 250)
    return () => { on = false; clearTimeout(t) }
  }, [q])
  const add = (p) => { if (!items.find(i => String(i.id) === String(p.id))) onChange([...items, { id: p.id, name: p.name }]); setQ(''); setRes([]) }
  const rm = (id) => onChange(items.filter(i => String(i.id) !== String(id)))
  return (
    <div>
      <label className={labelCls}>Productos del combo</label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1 mb-2">
          {items.map(i => (
            <span key={i.id} className="flex items-center gap-1 text-xs bg-accent/10 text-accent border border-accent/30 rounded-full px-2 py-1">
              {i.name} <button onClick={() => rm(i.id)} className="hover:text-white"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 bg-[#0a0a0a] border border-border rounded-lg px-2">
        <Search size={14} className="text-zinc-500" />
        <input className="flex-1 bg-transparent py-2 text-sm text-white outline-none" placeholder="Agregar producto al combo…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {res.length > 0 && (
        <div className="mt-1 border border-border rounded-lg overflow-hidden">
          {res.map(p => (
            <button key={p.id} onClick={() => add(p)} className="block w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/5">
              {p.name} {p.color ? <span className="text-zinc-500">· {p.color}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
