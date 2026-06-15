import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Tag, Plus, Printer, Trash2, Search, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { bizContactFooterHtml } from '@/lib/printFooter'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'

const inputCls = 'w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

function voucherStatus(v) {
  if (v.used) return { label: 'Usado', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' }
  if (v.expires_at && v.expires_at !== '') {
    const exp = new Date(v.expires_at)
    if (!isNaN(exp.getTime()) && exp < new Date()) {
      return { label: 'Vencido', cls: 'bg-red-500/10 text-red-400 border-red-500/30' }
    }
  }
  return { label: 'Activo', cls: 'bg-green-500/10 text-green-400 border-green-500/30' }
}

function formatValue(v) {
  if (v.type === 'percent') return `${v.value}% OFF`
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v.value)
}

function printVoucherPDF(voucher, biz = {}) {
  const bizName = (typeof biz === 'string' ? biz : biz.business_name) || 'DELPA'
  if (typeof biz === 'string') biz = {}
  const fmt = (v) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v)
  const valueDisplay = voucher.type === 'percent' ? `${voucher.value}% DE DESCUENTO` : `${fmt(voucher.value)} DE DESCUENTO`
  const expDisplay = voucher.expires_at ? `Válido hasta: ${new Date(voucher.expires_at).toLocaleDateString('es-AR')}` : 'Sin fecha de vencimiento'

  const html = `<!DOCTYPE html><html lang="es">
<head>
<meta charset="UTF-8">
<title>Vale de Descuento ${voucher.code}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .voucher { background: white; border: 3px solid #1a1a1a; border-radius: 12px; width: 380px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
  .header { background: #1a1a1a; color: white; padding: 20px; text-align: center; }
  .biz-name { font-size: 22px; font-weight: bold; letter-spacing: 3px; }
  .tag { font-size: 11px; letter-spacing: 4px; color: #aaa; margin-top: 4px; }
  .body { padding: 24px; text-align: center; }
  .label { font-size: 11px; color: #888; letter-spacing: 2px; text-transform: uppercase; }
  .value { font-size: 36px; font-weight: 900; color: #1a1a1a; margin: 8px 0; line-height: 1.1; }
  .code-section { background: #f9f9f9; border: 2px dashed #ccc; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .code-label { font-size: 10px; color: #888; letter-spacing: 2px; }
  .code { font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1a1a1a; font-family: monospace; margin-top: 6px; }
  .barcode { font-family: 'Courier New', monospace; font-size: 40px; color: #1a1a1a; letter-spacing: 4px; margin: 4px 0; }
  .conditions { font-size: 11px; color: #888; padding: 0 16px; margin-bottom: 8px; }
  .footer { background: #f0f0f0; padding: 14px; text-align: center; border-top: 1px dashed #ccc; }
  .expiry { font-size: 12px; color: #666; }
  .client-info { font-size: 12px; color: #555; margin-top: 4px; }
  .print-btn { margin: 20px auto; display: block; padding: 10px 24px; background: #1a1a1a; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  @media print { .print-btn { display: none; } @page { size: 100mm 160mm; margin: 0; } }
</style>
</head>
<body>
<div>
  <div class="voucher">
    <div class="header">
      <div class="biz-name">${bizName.toUpperCase()}</div>
      <div class="tag">VALE DE DESCUENTO</div>
    </div>
    <div class="body">
      <div class="label">DESCUENTO</div>
      <div class="value">${valueDisplay}</div>
      <div class="code-section">
        <div class="code-label">CÓDIGO DE CANJE</div>
        <div class="code">${voucher.code}</div>
        <div class="barcode">${voucher.code.replace(/-/g, ' ')}</div>
      </div>
      ${voucher.conditions ? `<div class="conditions">Condiciones: ${voucher.conditions}</div>` : ''}
    </div>
    <div class="footer">
      <div class="expiry">${expDisplay}</div>
      ${voucher.client_name ? `<div class="client-info">Para: ${voucher.client_name}</div>` : ''}
      ${bizContactFooterHtml(biz, { marginTop: '8px' })}
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">🖨 Imprimir vale</button>
</div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=480,height=600')
  if (w) { w.document.write(html); w.document.close(); w.focus() }
}

export default function Vouchers() {
  const [vouchers, setVouchers] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [createModal, setCreateModal] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [biz, setBiz] = useState({})

  const [form, setForm] = useState({
    type: 'fixed',
    value: '',
    client_name: '',
    expires_at: '',
    conditions: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.vouchers.list({ page, limit: 30, filter })
      setVouchers(res.vouchers || [])
      setTotal(res.total || 0)
      setPages(res.pages || 1)
    } catch (e) {
      toast.error('Error al cargar vales')
    } finally { setLoading(false) }
  }, [page, filter])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.settings.getAll().then(a => setBiz(a || {})).catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!form.value || Number(form.value) <= 0) return toast.error('Ingresá un valor válido')
    setProcessing(true)
    try {
      const voucher = await api.vouchers.create({
        type: form.type,
        value: Number(form.value),
        client_name: form.client_name,
        expires_at: form.expires_at,
        conditions: form.conditions,
      })
      toast.success(`Vale ${voucher.code} creado`)
      setCreateModal(false)
      setForm({ type: 'fixed', value: '', client_name: '', expires_at: '', conditions: '' })
      load()
      // Auto-print
      setTimeout(() => printVoucherPDF(voucher, biz), 300)
    } catch (e) {
      toast.error(e.message || 'Error al crear vale')
    } finally { setProcessing(false) }
  }

  const handleDelete = async (v) => {
    if (!window.confirm(`¿Eliminar vale ${v.code}?`)) return
    try {
      await api.vouchers.delete(v.id)
      toast.success('Vale eliminado')
      load()
    } catch (e) { toast.error(e.message) }
  }

  const filtered = search
    ? vouchers.filter(v =>
        v.code.includes(search.toUpperCase()) ||
        (v.client_name || '').toLowerCase().includes(search.toLowerCase())
      )
    : vouchers

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6 space-y-5"
    >
      <PageHeader
        title="Vales de Descuento"
        subtitle={`${total} vales en total`}
        actions={
          <div className="flex gap-2">
            <button onClick={load} className="no-drag flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 border border-transparent hover:border-border transition-colors">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button onClick={() => setCreateModal(true)} className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
              <Plus size={14} /> Generar vale
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none"
            placeholder="Buscar por código o cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex border border-border rounded-lg overflow-hidden">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'active', label: 'Activos' },
            { id: 'used', label: 'Usados' },
            { id: 'expired', label: 'Vencidos' },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => { setFilter(id); setPage(1) }}
              className={cn('px-3 py-2 text-xs font-medium transition-colors',
                filter === id ? 'bg-accent text-black' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Voucher list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '180px 100px 110px 160px 1fr 80px 80px' }}>
          <span>Código</span>
          <span>Tipo</span>
          <span>Valor</span>
          <span>Cliente</span>
          <span>Vencimiento</span>
          <span>Estado</span>
          <span></span>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <div className="py-8 text-center text-zinc-600 text-sm">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Tag size={32} className="text-zinc-700 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">No hay vales</p>
              <p className="text-zinc-600 text-xs mt-1">Generá tu primer vale de descuento</p>
            </div>
          ) : filtered.map(v => {
            const status = voucherStatus(v)
            return (
              <div key={v.id} className="grid items-center px-4 py-3 text-sm hover:bg-white/[0.02] transition-colors"
                style={{ gridTemplateColumns: '180px 100px 110px 160px 1fr 80px 80px' }}>
                <span className="font-mono font-bold text-accent tracking-widest text-base">{v.code}</span>
                <span className="text-zinc-400 text-xs">{v.type === 'fixed' ? 'Fijo' : 'Porcentaje'}</span>
                <span className="font-semibold text-white">{formatValue(v)}</span>
                <span className="text-zinc-400 truncate">{v.client_name || <span className="text-zinc-600">—</span>}</span>
                <span className="text-zinc-500 text-xs">
                  {v.expires_at && v.expires_at !== '' ? new Date(v.expires_at).toLocaleDateString('es-AR') : <span className="text-zinc-700">Sin vto.</span>}
                </span>
                <span className={cn('text-[11px] px-2 py-0.5 rounded-full border font-medium text-center', status.cls)}>{status.label}</span>
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => printVoucherPDF(v, biz)} title="Reimprimir"
                    className="no-drag p-1.5 text-zinc-600 hover:text-zinc-200 rounded transition-colors">
                    <Printer size={13} />
                  </button>
                  {!v.used && (
                    <button onClick={() => handleDelete(v)} title="Eliminar"
                      className="no-drag p-1.5 text-zinc-700 hover:text-red-400 rounded transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Generar vale de descuento" width="max-w-md">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Tipo de descuento</label>
            <div className="flex gap-2">
              {[
                { id: 'fixed', label: 'Monto fijo ($)' },
                { id: 'percent', label: 'Porcentaje (%)' },
              ].map(({ id, label }) => (
                <button key={id} onClick={() => setForm(f => ({ ...f, type: id }))}
                  className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-colors',
                    form.type === id ? 'bg-accent/10 border-accent text-accent' : 'border-border text-zinc-500 hover:text-zinc-300')}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>
              {form.type === 'fixed' ? 'Valor en pesos ($)' : 'Porcentaje (%)'}
            </label>
            <input
              type="number" min="1" max={form.type === 'percent' ? '100' : undefined}
              className={inputCls}
              value={form.value}
              onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
              placeholder={form.type === 'fixed' ? 'Ej: 5000' : 'Ej: 15'}
            />
          </div>

          <div>
            <label className={labelCls}>Cliente (opcional)</label>
            <input
              type="text" className={inputCls}
              value={form.client_name}
              onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
              placeholder="Nombre del cliente"
            />
          </div>

          <div>
            <label className={labelCls}>Fecha de vencimiento (opcional)</label>
            <input
              type="date" className={inputCls}
              value={form.expires_at}
              onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>

          <div>
            <label className={labelCls}>Condiciones (opcional)</label>
            <input
              type="text" className={inputCls}
              value={form.conditions}
              onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))}
              placeholder="Ej: Válido para compras mayores a $10.000"
            />
          </div>

          {form.value > 0 && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-3 text-sm text-accent">
              Se generará un vale de <strong>{form.type === 'fixed' ? `$${form.value}` : `${form.value}%`}</strong> OFF
              {form.expires_at && ` válido hasta el ${new Date(form.expires_at).toLocaleDateString('es-AR')}`}.
              <br />
              <span className="text-xs text-zinc-500 mt-1 block">Se imprimirá automáticamente al crear.</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setCreateModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">
            Cancelar
          </button>
          <button onClick={handleCreate} disabled={processing}
            className="btn-primary no-drag flex items-center gap-2 px-5 py-2 text-sm rounded-lg">
            <Tag size={14} /> {processing ? 'Generando...' : 'Generar e imprimir'}
          </button>
        </div>
      </Modal>
    </motion.div>
  )
}
