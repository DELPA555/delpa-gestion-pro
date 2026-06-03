import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { CreditCard, Eye, DollarSign } from 'lucide-react'
import { PhoneLink } from '@/components/shared/ContactLinks'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

export default function Accounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [movModal, setMovModal] = useState(null)
  const [movements, setMovements] = useState([])
  const [payModal, setPayModal] = useState(null)
  const [payAmt, setPayAmt] = useState('')

  const load = async () => {
    setLoading(true)
    try { setAccounts(await api.accounts.list()) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openMovements = async (c) => {
    const mvs = await api.accounts.movements(c.id)
    setMovements(mvs)
    setMovModal(c)
  }

  const registerPayment = async () => {
    if (!payAmt || Number(payAmt) <= 0) return toast.error('Monto inválido')
    await api.clients.addPayment({ clientId: payModal.id, amount: Number(payAmt) })
    toast.success('Pago registrado')
    setPayModal(null)
    load()
  }

  const totalDebt = accounts.reduce((s, a) => s + (a.balance || 0), 0)
  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Cuentas Corrientes" subtitle={`Total en deuda: ${formatCurrency(totalDebt)}`} />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase tracking-wider px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
          <span>Cliente</span><span>Teléfono</span><span>DNI</span><span className="text-right">Saldo</span><span />
        </div>
        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={5} cols={4} />
            : accounts.length === 0 ? (
              <EmptyState icon={CreditCard} title="Sin cuentas corrientes activas" />
            ) : accounts.map(a => (
              <div key={a.id} className="row-alt grid items-center px-4 py-3" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr auto' }}>
                <div>
                  <p className="text-sm text-white font-medium">{a.name}</p>
                  <p className="text-xs text-zinc-500">{a.ventas_cc} compras en CC</p>
                </div>
                <PhoneLink phone={a.phone} />
                <span className="text-sm text-zinc-300">{a.dni || '—'}</span>
                <span className={cn('text-right font-bold tabular-nums text-sm', a.balance > 0 ? 'text-amber-400' : 'text-green-400')}>
                  {formatCurrency(Math.abs(a.balance))}
                </span>
                <div className="flex gap-1">
                  {a.balance > 0 && (
                    <button onClick={() => { setPayModal(a); setPayAmt('') }} className="p-1.5 text-zinc-600 hover:text-green-400 rounded" title="Registrar pago">
                      <DollarSign size={13} />
                    </button>
                  )}
                  <button onClick={() => openMovements(a)} className="p-1.5 text-zinc-600 hover:text-accent rounded" title="Ver movimientos">
                    <Eye size={13} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>

      <Modal open={!!movModal} onClose={() => setMovModal(null)} title={`Movimientos — ${movModal?.name}`} width="max-w-2xl">
        <div className="divide-y divide-border">
          {movements.length === 0 ? <p className="text-center text-zinc-600 text-sm py-8">Sin movimientos</p>
            : movements.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className={cn('font-medium mr-2', m.type === 'debt' ? 'text-amber-400' : 'text-green-400')}>
                    {m.type === 'debt' ? 'Deuda' : 'Pago'}
                  </span>
                  <span className="text-zinc-400 text-xs">{formatDateTime(m.created_at)}</span>
                  {m.notes && <p className="text-xs text-zinc-600 mt-0.5">{m.notes}</p>}
                </div>
                <span className={cn('font-bold tabular-nums', m.type === 'debt' ? 'text-amber-400' : 'text-green-400')}>
                  {m.type === 'debt' ? '+' : '-'}{formatCurrency(m.amount)}
                </span>
              </div>
            ))}
        </div>
      </Modal>

      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Pago — ${payModal?.name}`} width="max-w-sm">
        <div className="space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm">
            <span className="text-zinc-400">Saldo: </span><span className="text-amber-400 font-bold">{formatCurrency(payModal?.balance)}</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Monto $</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={payAmt} onChange={e => setPayAmt(e.target.value)} autoFocus />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setPayModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={registerPayment} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">Registrar pago</button>
        </div>
      </Modal>
    </motion.div>
  )
}
