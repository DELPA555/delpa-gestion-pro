import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Plus, Search, Edit2, Trash2, Truck, Eye, DollarSign, X } from 'lucide-react'
import { PhoneLink, EmailLink } from '@/components/shared/ContactLinks'
import { api } from '@/lib/api'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

function emptyForm() { return { name: '', cuit: '', phone: '', email: '', address: '', cbu: '', alias_cbu: '', notes: '' } }

export default function Suppliers() {
  const [data, setData] = useState({ suppliers: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [histModal, setHistModal] = useState(null)
  const [history, setHistory] = useState([])
  const [payModal, setPayModal] = useState(null)
  const [payForm, setPayForm] = useState({ amount: '', paymentMethod: 'Transferencia', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.suppliers.list({ page, search, limit: 25 })) }
    finally { setLoading(false) }
  }, [page, search])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setForm(emptyForm()); setEditId(null); setModal('form') }
  const openEdit = (s) => { setForm({ name: s.name, cuit: s.cuit, phone: s.phone, email: s.email, address: s.address, cbu: s.cbu, alias_cbu: s.alias_cbu, notes: s.notes }); setEditId(s.id); setModal('form') }
  const openHistory = async (s) => { setHistory(await api.suppliers.history(s.id)); setHistModal(s) }
  const openPayment = (s) => { setPayModal(s); setPayForm({ amount: '', paymentMethod: 'Transferencia', notes: '' }) }

  const save = async () => {
    if (!form.name.trim()) return toast.error('El nombre es requerido')
    setSaving(true)
    try {
      if (editId) { await api.suppliers.update(editId, form); toast.success('Proveedor actualizado') }
      else { await api.suppliers.create(form); toast.success('Proveedor creado') }
      setModal(null); load()
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setSaving(false) }
  }

  const remove = async (id, name) => {
    if (!confirm(`¿Eliminar a "${name}"?`)) return
    await api.suppliers.delete(id); toast.success('Proveedor eliminado'); load()
  }

  const registerPayment = async () => {
    if (!payForm.amount || Number(payForm.amount) <= 0) return toast.error('Monto inválido')
    await api.suppliers.addPayment({ supplierId: payModal.id, amount: Number(payForm.amount), paymentMethod: payForm.paymentMethod, notes: payForm.notes })
    toast.success('Pago registrado'); setPayModal(null); load()
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Proveedores" subtitle={`${data.total} proveedores`}
        actions={<button onClick={openCreate} className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg"><Plus size={15} /> Nuevo proveedor</button>} />

      <div className="relative mb-4 max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input className={`${inputCls} pl-8`} placeholder="Buscar nombre, CUIT..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
          <span>Nombre</span><span>CUIT</span><span>Teléfono</span><span className="text-right">Deuda</span><span />
        </div>
        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={5} cols={5} />
            : data.suppliers.length === 0 ? (
              <EmptyState icon={Truck} title="Sin proveedores registrados" />
            ) : data.suppliers.map(s => (
              <div key={s.id} className="row-alt grid items-center px-4 py-3" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
                <div>
                  <p className="text-sm text-white font-medium">{s.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {s.alias_cbu && <span className="text-xs text-zinc-500">{s.alias_cbu}</span>}
                    {s.email && <EmailLink email={s.email} />}
                    {!s.alias_cbu && !s.email && <span className="text-xs text-zinc-600">—</span>}
                  </div>
                </div>
                <span className="text-sm text-zinc-300">{s.cuit || '—'}</span>
                <PhoneLink phone={s.phone} />
                <span className={cn('text-right font-bold text-sm tabular-nums', s.balance > 0 ? 'text-amber-400' : 'text-zinc-400')}>
                  {s.balance > 0 ? formatCurrency(s.balance) : '—'}
                </span>
                <div className="flex gap-1">
                  {s.balance > 0 && <button onClick={() => openPayment(s)} className="p-1.5 text-zinc-600 hover:text-green-400 rounded"><DollarSign size={13} /></button>}
                  <button onClick={() => openHistory(s)} className="p-1.5 text-zinc-600 hover:text-accent rounded"><Eye size={13} /></button>
                  <button onClick={() => openEdit(s)} className="p-1.5 text-zinc-600 hover:text-accent rounded"><Edit2 size={13} /></button>
                  <button onClick={() => remove(s.id, s.name)} className="p-1.5 text-zinc-600 hover:text-red-400 rounded"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
        </div>
        <Pagination page={page} pages={data.pages} total={data.total} limit={25} onChange={setPage} />
      </div>

      <Modal open={modal === 'form'} onClose={() => setModal(null)} title={editId ? 'Editar proveedor' : 'Nuevo proveedor'} width="max-w-2xl">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={labelCls}>Nombre *</label><input className={inputCls} value={form.name} onChange={e => f('name', e.target.value)} /></div>
          <div><label className={labelCls}>CUIT</label><input className={inputCls} value={form.cuit} onChange={e => f('cuit', e.target.value)} /></div>
          <div><label className={labelCls}>Teléfono</label><input className={inputCls} value={form.phone} onChange={e => f('phone', e.target.value)} /></div>
          <div><label className={labelCls}>Email</label><input className={inputCls} value={form.email} onChange={e => f('email', e.target.value)} /></div>
          <div><label className={labelCls}>Dirección</label><input className={inputCls} value={form.address} onChange={e => f('address', e.target.value)} /></div>
          <div><label className={labelCls}>CBU</label><input className={inputCls} value={form.cbu} onChange={e => f('cbu', e.target.value)} /></div>
          <div><label className={labelCls}>Alias CBU</label><input className={inputCls} value={form.alias_cbu} onChange={e => f('alias_cbu', e.target.value)} /></div>
          <div className="col-span-2"><label className={labelCls}>Notas</label><textarea className={`${inputCls} resize-none`} rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg disabled:opacity-50">{saving ? 'Guardando...' : editId ? 'Guardar' : 'Crear'}</button>
        </div>
      </Modal>

      <Modal open={!!histModal} onClose={() => setHistModal(null)} title={`Compras — ${histModal?.name}`} width="max-w-2xl">
        <div className="divide-y divide-border">
          {history.length === 0 ? <p className="text-center text-zinc-600 text-sm py-8">Sin compras</p>
            : history.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="text-zinc-400 text-xs mr-2">#{p.id}</span>
                  <span className="text-white">{p.invoice_number || 'Sin factura'}</span>
                  <span className="text-zinc-500 text-xs ml-2">{formatDate(p.created_at)}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', p.status === 'paid' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400')}>
                    {p.status === 'paid' ? 'Pagado' : 'Pendiente'}
                  </span>
                  <span className="text-white font-medium tabular-nums">{formatCurrency(p.total)}</span>
                </div>
              </div>
            ))}
        </div>
      </Modal>

      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Pago a ${payModal?.name}`} width="max-w-sm">
        <div className="space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm">
            <span className="text-zinc-400">Deuda: </span><span className="text-amber-400 font-bold">{formatCurrency(payModal?.balance)}</span>
          </div>
          <div><label className={labelCls}>Monto $</label><input type="number" min="0" step="0.01" className={inputCls} value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} autoFocus /></div>
          <div><label className={labelCls}>Método</label>
            <select className={inputCls} value={payForm.paymentMethod} onChange={e => setPayForm(p => ({ ...p, paymentMethod: e.target.value }))}>
              {['Transferencia','Efectivo','Cheque','Otro'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Notas</label><input className={inputCls} value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setPayModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={registerPayment} className="px-5 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg font-medium">Registrar pago</button>
        </div>
      </Modal>
    </motion.div>
  )
}
