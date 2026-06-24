import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Plus, Trash2, Receipt, X } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'
import { useAuth } from '@/context/AuthContext'

const CATEGORIES = ['Alquiler','Servicios','Sueldos','Flete','Bolsas/Empaques','Marketing','Impuestos','Limpieza','Mantenimiento','General','Otro']
const METHODS = ['Efectivo','Transferencia','Mercado Pago','Tarjeta','Otro']

export default function Expenses() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [data, setData] = useState({ expenses: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ concept: '', category: 'General', amount: '', paymentMethod: 'Efectivo', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.expenses.list({ page, limit: 25, from: from || undefined, to: to || undefined })) }
    finally { setLoading(false) }
  }, [page, from, to])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!form.concept.trim()) return toast.error('El concepto es requerido')
    if (!form.amount || Number(form.amount) <= 0) return toast.error('El monto debe ser mayor a 0')
    setSaving(true)
    try {
      await api.expenses.create({ ...form, amount: Number(form.amount) })
      toast.success('Gasto registrado')
      setModal(false)
      setForm({ concept: '', category: 'General', amount: '', paymentMethod: 'Efectivo', notes: '' })
      load()
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setSaving(false) }
  }

  const remove = async (id, concept) => {
    if (!confirm(`¿Eliminar gasto "${concept}"?`)) return
    await api.expenses.delete(id); toast.success('Gasto eliminado'); load()
  }

  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0)
  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title={isAdmin ? 'Gastos' : 'Gastos de hoy'} subtitle={data.total > 0 ? `Total: ${formatCurrency(totalExpenses)}` : `${data.total} gastos`}
        actions={<button onClick={() => setModal(true)} className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg"><Plus size={15} /> Nuevo gasto</button>} />

      {isAdmin && (
        <div className="flex gap-3 mb-4">
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none no-drag" />
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none no-drag" />
          {(from || to) && <button onClick={() => { setFrom(''); setTo(''); setPage(1) }} className="text-zinc-500 hover:text-white p-2"><X size={14} /></button>}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
          <span>Concepto</span><span>Categoría</span><span>Método</span><span className="text-right">Monto</span><span />
        </div>
        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={5} cols={5} />
            : data.expenses.length === 0 ? (
              <EmptyState icon={Receipt} title={`Sin gastos${from || to ? ' en el período' : ''}`} />
            ) : data.expenses.map(e => (
              <div key={e.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
                <div><p className="text-white">{e.concept}</p><p className="text-xs text-zinc-500">{formatDateTime(e.created_at)}</p></div>
                <span className="text-zinc-400">{e.category}</span>
                <span className="text-zinc-400">{e.payment_method}</span>
                <span className="text-right text-white font-medium tabular-nums">{formatCurrency(e.amount)}</span>
                {isAdmin
                  ? <button onClick={() => remove(e.id, e.concept)} className="p-1.5 text-zinc-600 hover:text-red-400 rounded ml-2"><Trash2 size={13} /></button>
                  : <span className="ml-2" />}
              </div>
            ))}
        </div>
        <Pagination page={page} pages={data.pages} total={data.total} limit={25} onChange={setPage} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Nuevo gasto" width="max-w-md">
        <div className="space-y-4">
          <div><label className={labelCls}>Concepto *</label><input className={inputCls} value={form.concept} onChange={e => f('concept', e.target.value)} placeholder="Ej: Alquiler del local" autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Categoría</label>
              <select className={inputCls} value={form.category} onChange={e => f('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Monto $</label><input type="number" min="0" step="0.01" className={inputCls} value={form.amount} onChange={e => f('amount', e.target.value)} placeholder="0,00" /></div>
          </div>
          <div>
            <label className={labelCls}>Medio de pago</label>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map(m => (
                <button key={m} onClick={() => f('paymentMethod', m)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${form.paymentMethod === m ? 'border-accent bg-accent/10 text-white' : 'border-border text-zinc-500 hover:text-zinc-200'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div><label className={labelCls}>Notas</label><input className={inputCls} value={form.notes} onChange={e => f('notes', e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg font-medium disabled:opacity-50">{saving ? 'Guardando...' : 'Registrar gasto'}</button>
        </div>
      </Modal>
    </motion.div>
  )
}
