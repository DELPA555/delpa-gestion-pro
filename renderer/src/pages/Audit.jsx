import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Shield, X } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, cn } from '@/lib/utils'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

const MODULES = ['', 'products', 'sales', 'clients', 'suppliers', 'purchases', 'cashbox', 'expenses', 'invoices']

const ACTION_COLOR = {
  CREATE: 'text-green-400 bg-green-500/10',
  UPDATE: 'text-blue-400 bg-blue-500/10',
  DELETE: 'text-red-400 bg-red-500/10',
  VOID: 'text-orange-400 bg-orange-500/10',
  CLOSE: 'text-purple-400 bg-purple-500/10',
  OPEN: 'text-cyan-400 bg-cyan-500/10',
  PAYMENT: 'text-amber-400 bg-amber-500/10',
}

export default function Audit() {
  const [data, setData] = useState({ logs: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [module, setModule] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.audit.list({ page, limit: 50, module: module || undefined })) }
    finally { setLoading(false) }
  }, [page, module])

  useEffect(() => { load() }, [load])

  const inputCls = 'input-field bg-card border border-border rounded-lg px-3 py-2 text-sm text-white no-drag'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Auditoría" subtitle={`${data.total} movimientos registrados`} />

      <div className="flex gap-3 mb-4">
        <select value={module} onChange={e => { setModule(e.target.value); setPage(1) }} className={inputCls}>
          <option value="">Todos los módulos</option>
          {MODULES.filter(Boolean).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {module && <button onClick={() => { setModule(''); setPage(1) }} className="text-zinc-500 hover:text-white p-2"><X size={14} /></button>}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '1fr 1fr 80px 3fr' }}>
          <span>Fecha</span><span>Módulo</span><span>Acción</span><span>Descripción</span>
        </div>
        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={8} cols={4} />
            : data.logs.length === 0 ? (
              <EmptyState icon={Shield} title="Sin registros de auditoría" />
            ) : data.logs.map(log => (
              <div key={log.id} className="row-alt grid items-start px-4 py-2.5 text-sm" style={{ gridTemplateColumns: '1fr 1fr 80px 3fr' }}>
                <span className="text-zinc-400 text-xs">{formatDateTime(log.created_at)}</span>
                <span className="text-zinc-300 capitalize">{log.module}</span>
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium w-fit', ACTION_COLOR[log.action] || 'text-zinc-400 bg-zinc-500/10')}>
                  {log.action}
                </span>
                <span className="text-zinc-400">{log.description}</span>
              </div>
            ))}
        </div>
        <Pagination page={page} pages={data.pages} total={data.total} limit={50} onChange={setPage} />
      </div>
    </motion.div>
  )
}
