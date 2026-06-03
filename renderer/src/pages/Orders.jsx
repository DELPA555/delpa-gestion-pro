import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ClipboardList, Plus, X, Edit2, Trash2, Phone, CheckCircle,
  Clock, Package, XCircle, ListTodo, Bell, Check, Hourglass,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'
import Pagination from '@/components/shared/Pagination'

// ─── Orders helpers ───────────────────────────────────────────────────────────
function itemLabel(it) {
  if (typeof it === 'string') return it
  if (it && typeof it === 'object') {
    const name = it.name || it.product_name || ''
    const size = it.size ? ` T.${it.size}` : ''
    const qty  = it.quantity > 1 ? ` ×${it.quantity}` : ''
    return `${name}${size}${qty}`.trim() || JSON.stringify(it)
  }
  return String(it ?? '')
}

const STATUS_CONFIG = {
  pendiente:  { label: 'Pendiente',  color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20',  Icon: Clock },
  listo:      { label: 'Listo',      color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/20',    Icon: Package },
  entregado:  { label: 'Entregado',  color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/20',  Icon: CheckCircle },
  cancelado:  { label: 'Cancelado',  color: 'text-zinc-500',   bg: 'bg-zinc-500/10 border-zinc-500/20',   Icon: XCircle },
}

const EMPTY_FORM = {
  client_name: '', client_phone: '', items: '', total: '', advance: '',
  status: 'pendiente', notes: '', delivery_date: '',
}

// ─── Waitlist helpers ─────────────────────────────────────────────────────────
const WL_STATUS = {
  waiting:   { label: 'En espera',  color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20',  Icon: Hourglass },
  arrived:   { label: 'Llegó',      color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/20',  Icon: CheckCircle },
  completed: { label: 'Completado', color: 'text-zinc-500',   bg: 'bg-zinc-500/10 border-zinc-500/20',   Icon: Check },
}

const EMPTY_WL = {
  client_name: '', client_phone: '', product_name: '', size: '',
  color: '', estimated_date: '', notes: '',
}

// ─── Shared style constants ───────────────────────────────────────────────────
const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

// ─── Main component ───────────────────────────────────────────────────────────
export default function Orders() {
  const [mainTab, setMainTab] = useState('orders') // 'orders' | 'waitlist'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader
        title="Pedidos"
        subtitle="Encargos y lista de espera"
      />

      <div className="flex gap-1 mb-5 border-b border-border">
        <button
          onClick={() => setMainTab('orders')}
          className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            mainTab === 'orders' ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <ClipboardList size={14} /> Pedidos
        </button>
        <button
          onClick={() => setMainTab('waitlist')}
          className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            mainTab === 'waitlist' ? 'border-purple-500 text-purple-400' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
        >
          <ListTodo size={14} /> Lista de espera
        </button>
      </div>

      {mainTab === 'orders' ? <OrdersTab /> : <WaitlistTab />}
    </motion.div>
  )
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab() {
  const [orders, setOrders] = useState({ orders: [], total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.orders.list({ page, limit: 25, status: statusFilter })
      setOrders(res && Array.isArray(res.orders) ? res : { orders: [], total: 0, pages: 1 })
    } catch {
      setOrders({ orders: [], total: 0, pages: 1 })
    } finally { setLoading(false) }
  }, [page, statusFilter])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditing(null); setForm(EMPTY_FORM); setModal(true) }
  const openEdit = (o) => {
    setEditing(o)
    setForm({
      client_name: o.client_name,
      client_phone: o.client_phone || '',
      items: Array.isArray(o.items) ? o.items.map(itemLabel).join('\n') : '',
      total: o.total || '',
      advance: o.advance || '',
      status: o.status,
      notes: o.notes || '',
      delivery_date: o.delivery_date || '',
    })
    setModal(true)
  }

  const handleSave = async () => {
    if (!form.client_name.trim()) return toast.error('Ingresá el nombre del cliente')
    setSaving(true)
    try {
      const data = {
        client_name: form.client_name,
        client_phone: form.client_phone,
        items: form.items.split('\n').map(s => s.trim()).filter(Boolean),
        total: Number(form.total) || 0,
        advance: Number(form.advance) || 0,
        status: form.status,
        notes: form.notes,
        delivery_date: form.delivery_date,
      }
      if (editing) {
        await api.orders.update(editing.id, data)
        toast.success('Pedido actualizado')
      } else {
        await api.orders.create(data)
        toast.success('Pedido creado')
      }
      setModal(false)
      load()
    } catch (e) { toast.error(e.message || 'Error al guardar') }
    finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este pedido?')) return
    try { await api.orders.delete(id); toast.success('Pedido eliminado'); load() }
    catch { toast.error('Error al eliminar') }
  }

  const updateStatus = async (o, status) => {
    try {
      await api.orders.update(o.id, {
        client_name: o.client_name, client_phone: o.client_phone,
        items: (Array.isArray(o.items) ? o.items : []).map(itemLabel),
        total: o.total, advance: o.advance,
        status, notes: o.notes, delivery_date: o.delivery_date,
      })
      load()
    } catch { toast.error('Error al actualizar') }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {[{ id: '', label: 'Todos' }, ...Object.entries(STATUS_CONFIG).map(([id, { label }]) => ({ id, label }))].map(({ id, label }) => (
            <button key={id} onClick={() => { setStatusFilter(id); setPage(1) }}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors rounded-md',
                statusFilter === id ? 'bg-accent/15 text-accent' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]')}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={openNew} className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
          <Plus size={14} /> Nuevo pedido
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '60px 1fr 1fr 1fr 1fr 100px auto' }}>
          <span>#</span><span>Cliente</span><span>Detalle</span><span>Entrega</span><span className="text-right">Total</span><span>Estado</span><span />
        </div>

        <div className="divide-y divide-border">
          {loading ? (
            <SkeletonTable rows={6} cols={7} />
          ) : orders.orders.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Sin pedidos" subtitle="Creá un nuevo pedido para comenzar" />
          ) : (
            orders.orders.map(o => {
              const sc = STATUS_CONFIG[o.status] || STATUS_CONFIG.pendiente
              return (
                <div key={o.id} className="row-alt grid items-center px-4 py-3 text-sm gap-2"
                  style={{ gridTemplateColumns: '60px 1fr 1fr 1fr 1fr 100px auto' }}>
                  <span className="text-zinc-600 font-mono">#{o.id}</span>
                  <div>
                    <p className="text-white font-medium">{o.client_name}</p>
                    {o.client_phone && (
                      <a href={`tel:${o.client_phone}`} className="text-xs text-zinc-500 flex items-center gap-1 hover:text-accent">
                        <Phone size={10} /> {o.client_phone}
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 max-w-[180px]">
                    {(Array.isArray(o.items) ? o.items : []).slice(0, 2).map((it, i) => (
                      <p key={i} className="truncate">{itemLabel(it)}</p>
                    ))}
                    {(o.items?.length || 0) > 2 && <p className="text-zinc-600">+{o.items.length - 2} más</p>}
                  </div>
                  <span className="text-zinc-400 text-xs">{o.delivery_date || '—'}</span>
                  <div className="text-right">
                    <p className="text-white tabular-nums font-medium">{formatCurrency(o.total)}</p>
                    {o.advance > 0 && <p className="text-xs text-zinc-500">Seña: {formatCurrency(o.advance)}</p>}
                  </div>
                  <div>
                    <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border', sc.bg, sc.color)}>
                      <sc.Icon size={10} />{sc.label}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(o)} className="p-1.5 text-zinc-600 hover:text-zinc-300 rounded">
                      <Edit2 size={13} />
                    </button>
                    {o.status === 'pendiente' && (
                      <button onClick={() => updateStatus(o, 'listo')} title="Marcar listo"
                        className="p-1.5 text-zinc-600 hover:text-blue-400 rounded"><Package size={13} /></button>
                    )}
                    {o.status === 'listo' && (
                      <button onClick={() => updateStatus(o, 'entregado')} title="Marcar entregado"
                        className="p-1.5 text-zinc-600 hover:text-green-400 rounded"><CheckCircle size={13} /></button>
                    )}
                    <button onClick={() => handleDelete(o.id)} className="p-1.5 text-zinc-600 hover:text-red-400 rounded">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
        <Pagination page={page} pages={orders.pages} total={orders.total} limit={25} onChange={setPage} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Editar pedido #${editing.id}` : 'Nuevo pedido'} width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nombre del cliente *</label>
              <input className={inputCls} value={form.client_name} onChange={e => f('client_name', e.target.value)} placeholder="María López" autoFocus />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input className={inputCls} value={form.client_phone} onChange={e => f('client_phone', e.target.value)} placeholder="+54 9 11..." />
            </div>
          </div>
          <div>
            <label className={labelCls}>Detalle del pedido (una línea por ítem)</label>
            <textarea className={`${inputCls} min-h-[80px] resize-none`} value={form.items}
              onChange={e => f('items', e.target.value)}
              placeholder={`Remera M negra\nPantalón 40 azul\n...`} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Total $</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.total} onChange={e => f('total', e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className={labelCls}>Seña $</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.advance} onChange={e => f('advance', e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className={labelCls}>Fecha entrega</label>
              <input type="date" className={inputCls} value={form.delivery_date} onChange={e => f('delivery_date', e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Estado</label>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(STATUS_CONFIG).map(([id, { label, color, bg }]) => (
                <button key={id} onClick={() => f('status', id)}
                  className={cn('px-3 py-1.5 rounded-full text-xs border transition-colors', form.status === id ? `${bg} ${color}` : 'border-border text-zinc-500 hover:text-zinc-200')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Notas</label>
            <input className={inputCls} value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Observaciones..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">
            {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear pedido'}
          </button>
        </div>
      </Modal>
    </>
  )
}

// ─── Waitlist Tab ─────────────────────────────────────────────────────────────
function WaitlistTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('waiting')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_WL)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await api.waitlist.list({ status: statusFilter })
      setItems(Array.isArray(rows) ? rows : [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  // Listen for new arrivals broadcast
  useEffect(() => {
    const unsub = window.electron.on('waitlist:arrivals', (arrived) => {
      if (Array.isArray(arrived) && arrived.length > 0) {
        toast.success(`¡Llegó mercadería! ${arrived.map(a => a.product_name).join(', ')}`, { duration: 6000 })
        load()
      }
    })
    return unsub
  }, [load])

  const handleAdd = async () => {
    if (!form.client_name.trim() || !form.product_name.trim())
      return toast.error('Nombre del cliente y producto son requeridos')
    setSaving(true)
    try {
      const res = await api.waitlist.add(form)
      if (!res?.ok) throw new Error(res?.error || 'Error')
      toast.success('Agregado a lista de espera')
      setModal(false)
      setForm(EMPTY_WL)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  const handleNotify = async (item) => {
    try {
      await api.waitlist.notify(item.id)
      toast.success('Marcado como notificado')
      load()
    } catch { toast.error('Error al notificar') }
  }

  const handleWhatsApp = (item) => {
    const phone = (item.client_phone || '').replace(/\D/g, '')
    if (!phone) return toast.error('El cliente no tiene teléfono registrado')
    const msg = encodeURIComponent(
      `Hola ${item.client_name}! Te escribimos de DELPA para avisarte que llegó: ${item.product_name}${item.size ? ` T.${item.size}` : ''}${item.color ? ` ${item.color}` : ''}. ¡Pasá a buscarlo!`
    )
    window.electron.invoke('shell:openExternal', `https://wa.me/${phone}?text=${msg}`)
    handleNotify(item)
  }

  const handleComplete = async (id) => {
    try {
      await api.waitlist.complete(id)
      toast.success('Marcado como completado')
      load()
    } catch { toast.error('Error') }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este registro?')) return
    try { await api.waitlist.delete(id); toast.success('Eliminado'); load() }
    catch { toast.error('Error al eliminar') }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const allStatuses = [
    { id: 'waiting', label: 'En espera' },
    { id: 'arrived', label: 'Llegó' },
    { id: 'completed', label: 'Completados' },
    { id: '', label: 'Todos' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {allStatuses.map(({ id, label }) => (
            <button key={id} onClick={() => setStatusFilter(id)}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors rounded-md',
                statusFilter === id ? 'bg-purple-500/15 text-purple-400' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]')}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => { setForm(EMPTY_WL); setModal(true) }}
          className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
          <Plus size={14} /> Agregar
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '1fr 1fr 80px 100px 1fr auto' }}>
          <span>Cliente</span><span>Producto</span><span>Talle</span><span>Estado</span><span>Fecha est.</span><span />
        </div>

        <div className="divide-y divide-border">
          {loading ? (
            <SkeletonTable rows={5} cols={6} />
          ) : items.length === 0 ? (
            <EmptyState icon={ListTodo} title="Sin registros" subtitle="La lista de espera está vacía" />
          ) : (
            items.map(item => {
              const sc = WL_STATUS[item.status] || WL_STATUS.waiting
              const isArrived = item.status === 'arrived'
              return (
                <div key={item.id}
                  className={cn('row-alt grid items-center px-4 py-3 text-sm gap-2',
                    isArrived && 'bg-green-950/20')}
                  style={{ gridTemplateColumns: '1fr 1fr 80px 100px 1fr auto' }}>
                  <div>
                    <p className="text-white font-medium">{item.client_name}</p>
                    {item.client_phone && (
                      <span className="text-xs text-zinc-500 flex items-center gap-1">
                        <Phone size={10} /> {item.client_phone}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-white">{item.product_name}</p>
                    {item.color && <p className="text-xs text-zinc-500">{item.color}</p>}
                  </div>
                  <span className="text-zinc-400">{item.size || '—'}</span>
                  <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border w-fit', sc.bg, sc.color)}>
                    <sc.Icon size={10} />{sc.label}
                    {item.notified === 1 && <Bell size={9} className="ml-0.5 text-zinc-400" />}
                  </span>
                  <span className="text-zinc-500 text-xs">{item.estimated_date || '—'}</span>
                  <div className="flex gap-1">
                    {isArrived && (
                      <button onClick={() => handleWhatsApp(item)} title="Notificar por WhatsApp"
                        className="p-1.5 rounded bg-green-800/30 text-green-400 hover:bg-green-700/40 text-xs flex items-center gap-1">
                        <Phone size={12} /> WA
                      </button>
                    )}
                    {item.status !== 'completed' && (
                      <button onClick={() => handleComplete(item.id)} title="Marcar completado"
                        className="p-1.5 text-zinc-600 hover:text-green-400 rounded"><Check size={13} /></button>
                    )}
                    <button onClick={() => handleDelete(item.id)} className="p-1.5 text-zinc-600 hover:text-red-400 rounded">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Nueva lista de espera" width="max-w-md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nombre del cliente *</label>
              <input className={inputCls} value={form.client_name} onChange={e => f('client_name', e.target.value)} placeholder="María López" autoFocus />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input className={inputCls} value={form.client_phone} onChange={e => f('client_phone', e.target.value)} placeholder="+54 9 11..." />
            </div>
          </div>
          <div>
            <label className={labelCls}>Producto que busca *</label>
            <input className={inputCls} value={form.product_name} onChange={e => f('product_name', e.target.value)} placeholder="Remera básica" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Talle</label>
              <input className={inputCls} value={form.size} onChange={e => f('size', e.target.value)} placeholder="M" />
            </div>
            <div>
              <label className={labelCls}>Color</label>
              <input className={inputCls} value={form.color} onChange={e => f('color', e.target.value)} placeholder="Negro" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Fecha estimada de llegada</label>
            <input type="date" className={inputCls} value={form.estimated_date} onChange={e => f('estimated_date', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Notas</label>
            <input className={inputCls} value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Observaciones..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-border">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleAdd} disabled={saving} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">
            {saving ? 'Guardando...' : 'Agregar a lista'}
          </button>
        </div>
      </Modal>
    </>
  )
}
