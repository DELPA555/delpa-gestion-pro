import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { HandCoins, Plus, X, CheckCircle, Clock, XCircle, AlertTriangle, Printer, MessageSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { bizContactFooterHtml } from '@/lib/printFooter'
import { formatCurrency, cn, debounce } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'
import Pagination from '@/components/shared/Pagination'

const fmtMoney = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v || 0)

function printSenaTicket(seña, biz, pointsInfo = null) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('es-AR') + ' ' + now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const logoHtml = biz?.business_logo ? `<img src="${biz.business_logo}" style="max-width:50mm;max-height:18mm;margin-bottom:3pt" />` : ''
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${seña.senaNumber}</title>
<style>
@page{size:80mm auto;margin:4mm 5mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:9pt;width:70mm;color:#111}
.c{text-align:center}.b{font-weight:bold}
.div{border-top:1px dashed #aaa;margin:3mm 0}
.row{display:flex;justify-content:space-between;margin:1.5pt 0;font-size:9pt}
.hi{background:#f5f5f5;border:1px solid #ddd;padding:4pt 6pt;margin:3mm 0;border-radius:3pt}
.ft{font-size:7.5pt;color:#555;text-align:center;margin-top:5mm;line-height:1.5}
</style></head><body>
<div class="c">${logoHtml}<div class="b" style="font-size:13pt">${biz?.business_name || 'DELPA'}</div>
${biz?.business_address ? `<div style="font-size:8pt">${biz.business_address}</div>` : ''}
${biz?.business_phone ? `<div style="font-size:8pt">Tel: ${biz.business_phone}</div>` : ''}
${biz?.business_cuit ? `<div style="font-size:8pt">CUIT: ${biz.business_cuit}</div>` : ''}
</div>
<div class="div"></div>
<div class="c b" style="font-size:12pt">COMPROBANTE DE SEÑA</div>
<div class="c" style="font-size:10pt;color:#444">${seña.senaNumber}</div>
<div class="c" style="font-size:8pt;color:#777;margin-top:2pt">${dateStr}</div>
<div class="div"></div>
<div class="row"><span>Cliente:</span><span class="b">${seña.clientName}</span></div>
${seña.clientPhone ? `<div class="row"><span>Teléfono:</span><span>${seña.clientPhone}</span></div>` : ''}
<div class="div"></div>
<div class="row"><span>Producto:</span><span class="b">${seña.productName}</span></div>
${seña.size ? `<div class="row"><span>Talle:</span><span>${seña.size}</span></div>` : ''}
${seña.color ? `<div class="row"><span>Color:</span><span>${seña.color}</span></div>` : ''}
${seña.totalPrice > 0 ? `<div class="row"><span>Precio total:</span><span>${fmtMoney(seña.totalPrice)}</span></div>` : ''}
<div class="div"></div>
<div class="hi">
  <div class="row b"><span>Seña recibida:</span><span style="font-size:12pt">${fmtMoney(seña.advanceAmount)}</span></div>
  <div class="row"><span>Saldo al retirar:</span><span class="b">${fmtMoney(seña.remaining)}</span></div>
</div>
${seña.deadline ? `<div class="row"><span>Fecha límite de retiro:</span><span class="b">${seña.deadline}</span></div>` : ''}
${seña.notes ? `<div style="font-size:8pt;color:#555;margin:2mm 0">Obs: ${seña.notes}</div>` : ''}
${pointsInfo && pointsInfo.enabled && seña.clientName ? `
<div class="div"></div>
<div class="c b" style="font-size:10pt;letter-spacing:0.5px">PROGRAMA DE FIDELIZACIÓN</div>
<div class="c" style="margin:3pt 0">Puntos acumulados: <b style="font-size:12pt">${pointsInfo.total} pts</b></div>
${pointsInfo.total >= (pointsInfo.minRedeem || 5) ? `<div class="c" style="font-size:7.5pt;margin:2pt 0">Podés canjear ${pointsInfo.total} pts = ${fmtMoney(pointsInfo.total * (pointsInfo.value || 0))} de descuento</div>` : ''}` : ''}
<div class="div"></div>
<div class="ft">Conserve este ticket para retirar su mercadería.<br>Sin este comprobante no se realizará la entrega.</div>
${bizContactFooterHtml(biz)}
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),900)}<\/script>
</body></html>`
  const w = window.open('', '_blank', 'width=450,height=700')
  w.document.write(html)
  w.document.close()
}

function whatsappSena(seña) {
  const text = encodeURIComponent(
    `🛍️ *SEÑA REGISTRADA — ${seña.senaNumber}*\n\n` +
    `Hola ${seña.clientName}, te confirmamos tu reserva:\n\n` +
    `*Producto:* ${seña.productName}${seña.size ? ` T.${seña.size}` : ''}${seña.color ? ` ${seña.color}` : ''}\n` +
    `*Seña abonada:* ${fmtMoney(seña.advanceAmount)}\n` +
    `*Saldo al retirar:* ${fmtMoney(seña.remaining)}\n` +
    (seña.deadline ? `*Fecha límite:* ${seña.deadline}\n` : '') +
    `\nGuardá este número de seña para el retiro 🙏`
  )
  const phone = seña.clientPhone?.replace(/\D/g, '')
  const url = phone ? `https://wa.me/549${phone}?text=${text}` : `https://wa.me/?text=${text}`
  window.electron.invoke('shell:openExternal', url)
}

const STATUS_CONFIG = {
  pendiente: { label: 'Pendiente',  color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/20',  Icon: Clock },
  retirada:  { label: 'Retirada',   color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/20',  Icon: CheckCircle },
  vencida:   { label: 'Vencida',    color: 'text-red-400',    bg: 'bg-red-400/10 border-red-400/20',      Icon: AlertTriangle },
  cancelada: { label: 'Cancelada',  color: 'text-zinc-500',   bg: 'bg-zinc-500/10 border-zinc-500/20',   Icon: XCircle },
}

const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

const EMPTY_FORM = {
  clientName: '', clientPhone: '', clientId: null,
  productName: '', productId: null, size: '', color: '',
  totalPrice: '', advanceAmount: '', deadline: '', notes: '',
}

export default function Senas() {
  const [senas, setSenas] = useState({ senas: [], total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Product search
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState([])
  const [showProductResults, setShowProductResults] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)

  // Client search
  const [clientQuery, setClientQuery] = useState('')
  const [clientResults, setClientResults] = useState([])

  // Ticket + biz
  const [biz, setBiz] = useState(null)
  const [ticketData, setTicketData] = useState(null)

  // Action modals
  const [withdrawModal, setWithdrawModal] = useState(null)
  const [withdrawPayment, setWithdrawPayment] = useState('Efectivo')
  const [cancelModal, setCancelModal] = useState(null)
  const [refundAdvance, setRefundAdvance] = useState(false)
  const [actioning, setActioning] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await api.senas.checkExpired()
      const res = await api.senas.list({ page, limit: 25, status: statusFilter })
      setSenas(res && Array.isArray(res.senas) ? res : { senas: [], total: 0, pages: 1 })
    } catch { setSenas({ senas: [], total: 0, pages: 1 }) }
    finally { setLoading(false) }
  }, [page, statusFilter])

  useEffect(() => { load() }, [load])
  useEffect(() => { api.settings.getAll().then(setBiz).catch(() => {}) }, [])

  const searchProducts = useCallback(debounce(async (q) => {
    if (q.length < 2) { setProductResults([]); return }
    const res = await api.products.search(q)
    setProductResults(res || [])
    setShowProductResults(true)
  }, 280), [])

  const searchClients = useCallback(debounce(async (q) => {
    if (q.length < 2) { setClientResults([]); return }
    const res = await api.clients.list({ search: q, limit: 6 })
    setClientResults(res.clients || [])
  }, 280), [])

  useEffect(() => { searchProducts(productQuery) }, [productQuery, searchProducts])
  useEffect(() => { searchClients(clientQuery) }, [clientQuery, searchClients])

  const selectProduct = (p) => {
    setSelectedProduct(p)
    setProductQuery(p.name)
    setShowProductResults(false)
    setForm(f => ({ ...f, productId: p.id, productName: p.name, color: p.color || '', size: '' }))
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSave = async () => {
    if (!form.clientName.trim()) return toast.error('Ingresá el nombre del cliente')
    if (!form.productName.trim()) return toast.error('Buscá y seleccioná un producto')
    if (!form.size) return toast.error('Seleccioná el talle')
    if (!form.advanceAmount || Number(form.advanceAmount) <= 0) return toast.error('Ingresá el monto de la seña')
    setSaving(true)
    try {
      const res = await api.senas.create({
        clientId: form.clientId || null,
        clientName: form.clientName,
        clientPhone: form.clientPhone,
        productId: form.productId || null,
        productName: form.productName,
        size: form.size,
        color: form.color,
        totalPrice: Number(form.totalPrice) || 0,
        advanceAmount: Number(form.advanceAmount) || 0,
        deadline: form.deadline,
        notes: form.notes,
      })
      if (!res.ok) throw new Error(res.error || 'Error al guardar')
      toast.success(`Seña ${res.senaNumber} registrada ✓`)
      setModal(false)
      setForm(EMPTY_FORM)
      setProductQuery('')
      setSelectedProduct(null)
      setTicketData({ ...res, clientId: form.clientId, biz })
      load()
    } catch (e) { toast.error(e.message || 'Error al guardar') }
    finally { setSaving(false) }
  }

  const handleWithdraw = async () => {
    if (!withdrawModal) return
    setActioning(true)
    try {
      const res = await api.senas.withdraw({ id: withdrawModal.id, paymentMethod: withdrawPayment })
      if (!res.ok) throw new Error(res.error || 'Error')
      toast.success(`Seña retirada · Venta ${res.saleNumber} generada`)
      setWithdrawModal(null)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setActioning(false) }
  }

  const handleCancel = async () => {
    if (!cancelModal) return
    setActioning(true)
    try {
      const res = await api.senas.cancel({ id: cancelModal.id, refundAdvance })
      if (!res.ok) throw new Error(res.error || 'Error')
      toast.success(`Seña cancelada${refundAdvance ? ' · Seña devuelta al cliente' : ''}`)
      setCancelModal(null)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setActioning(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader
        title="Señas"
        subtitle="Mercadería reservada con seña"
        actions={
          <button onClick={() => { setModal(true); setForm(EMPTY_FORM); setProductQuery(''); setSelectedProduct(null) }}
            className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
            <Plus size={14} /> Nueva seña
          </button>
        }
      />

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {[{ id: '', label: 'Todas' }, ...Object.entries(STATUS_CONFIG).map(([id, { label }]) => ({ id, label }))].map(({ id, label }) => (
          <button key={id} onClick={() => { setStatusFilter(id); setPage(1) }}
            className={cn('px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              statusFilter === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '60px 1fr 1.2fr 120px 90px 90px 100px auto' }}>
          <span>#</span><span>Cliente</span><span>Producto</span>
          <span>Vencimiento</span><span className="text-right">Seña</span>
          <span className="text-right">Saldo</span><span>Estado</span><span />
        </div>

        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={6} cols={8} /> :
           senas.senas.length === 0 ? <EmptyState icon={HandCoins} title="Sin señas" subtitle="Registrá una seña para reservar mercadería" /> :
           senas.senas.map(s => {
             const sc = STATUS_CONFIG[s.status] || STATUS_CONFIG.pendiente
             const isOverdue = s.status === 'vencida'
             return (
               <div key={s.id} className="row-alt grid items-center px-4 py-3 text-sm gap-2"
                 style={{ gridTemplateColumns: '60px 1fr 1.2fr 120px 90px 90px 100px auto' }}>
                 <span className="text-zinc-600 font-mono">#{s.id}</span>
                 <div>
                   <p className="text-white font-medium">{s.client_name}</p>
                   {s.client_phone && <p className="text-xs text-zinc-500">{s.client_phone}</p>}
                 </div>
                 <div>
                   <p className="text-zinc-200 text-xs">{s.product_name}</p>
                   <p className="text-xs text-zinc-500">T.{s.size}{s.color ? ` · ${s.color}` : ''}</p>
                 </div>
                 <span className={cn('text-xs', isOverdue ? 'text-red-400 font-semibold' : 'text-zinc-400')}>
                   {s.deadline || '—'}
                 </span>
                 <span className="text-right tabular-nums text-zinc-300">{formatCurrency(s.advance_amount)}</span>
                 <span className="text-right tabular-nums text-accent font-medium">{formatCurrency(s.remaining)}</span>
                 <span className={cn('inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border', sc.bg, sc.color)}>
                   <sc.Icon size={10} />{sc.label}
                 </span>
                 <div className="flex gap-1">
                   {s.status === 'pendiente' && <>
                     <button onClick={() => { setWithdrawModal(s); setWithdrawPayment('Efectivo') }}
                       title="Retirar mercadería"
                       className="p-1.5 text-zinc-600 hover:text-green-400 rounded">
                       <CheckCircle size={13} />
                     </button>
                     <button onClick={() => { setCancelModal(s); setRefundAdvance(false) }}
                       title="Cancelar seña"
                       className="p-1.5 text-zinc-600 hover:text-red-400 rounded">
                       <X size={13} />
                     </button>
                   </>}
                 </div>
               </div>
             )
           })
          }
        </div>
        <Pagination page={page} pages={senas.pages} total={senas.total} limit={25} onChange={setPage} />
      </div>

      {/* New Seña Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Nueva seña" width="max-w-lg">
        <div className="space-y-4">
          {/* Client */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className={labelCls}>Cliente *</label>
              <input className={inputCls} value={form.clientId ? form.clientName : clientQuery}
                onChange={e => {
                  setClientQuery(e.target.value)
                  f('clientName', e.target.value)
                  f('clientId', null)
                }}
                placeholder="Nombre del cliente" />
              {clientResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl z-20 shadow-xl overflow-hidden">
                  {clientResults.map(c => (
                    <button key={c.id} onMouseDown={() => { f('clientId', c.id); f('clientName', c.name); f('clientPhone', c.phone || ''); setClientQuery(c.name); setClientResults([]) }}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 text-left text-sm">
                      <span className="text-white">{c.name}</span>
                      <span className="text-xs text-zinc-500">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input className={inputCls} value={form.clientPhone} onChange={e => f('clientPhone', e.target.value)} placeholder="+54 9 11..." />
            </div>
          </div>

          {/* Product */}
          <div className="relative">
            <label className={labelCls}>Producto *</label>
            <input className={inputCls} value={productQuery}
              onChange={e => { setProductQuery(e.target.value); f('productId', null); f('productName', e.target.value); setSelectedProduct(null) }}
              onFocus={() => productResults.length > 0 && setShowProductResults(true)}
              onBlur={() => setTimeout(() => setShowProductResults(false), 150)}
              placeholder="Buscar producto..." />
            {showProductResults && productResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl z-20 shadow-xl overflow-hidden">
                {productResults.map(p => (
                  <button key={p.id} onMouseDown={() => selectProduct(p)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 text-left">
                    <span className="text-sm text-white">{p.name}</span>
                    <span className="text-xs text-zinc-500">{formatCurrency(p.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Size + Color */}
          {selectedProduct && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Talle *</label>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProduct.sizes?.map(s => (
                    <button key={s.size} onClick={() => f('size', s.size)}
                      disabled={s.stock === 0}
                      className={cn('px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors',
                        s.stock === 0 ? 'border-border text-zinc-700 cursor-not-allowed' :
                        form.size === s.size ? 'border-accent bg-accent/10 text-accent' :
                        'border-border text-zinc-300 hover:border-zinc-500')}>
                      {s.size} ({s.stock})
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Color</label>
                <input className={inputCls} value={form.color} onChange={e => f('color', e.target.value)} placeholder="Ej: Azul" />
              </div>
            </div>
          )}

          {/* Prices */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Precio total $</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.totalPrice} onChange={e => f('totalPrice', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>Seña recibida $</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.advanceAmount} onChange={e => f('advanceAmount', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>Saldo a pagar $</label>
              <div className={`${inputCls} text-accent font-semibold`}>
                {formatCurrency(Math.max(0, (Number(form.totalPrice) || 0) - (Number(form.advanceAmount) || 0)))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fecha límite de retiro</label>
              <input type="date" className={inputCls} value={form.deadline} onChange={e => f('deadline', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Notas</label>
              <input className={inputCls} value={form.notes} onChange={e => f('notes', e.target.value)} placeholder="Observaciones..." />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">
            {saving ? 'Guardando...' : 'Registrar seña'}
          </button>
        </div>
      </Modal>

      {/* Withdraw Modal */}
      <Modal open={!!withdrawModal} onClose={() => !actioning && setWithdrawModal(null)} title="Retirar mercadería" width="max-w-sm">
        {withdrawModal && (
          <div className="space-y-4">
            <div className="bg-surface rounded-lg p-4 space-y-2 text-sm">
              <p className="text-white font-medium">{withdrawModal.product_name} T.{withdrawModal.size}</p>
              <p className="text-zinc-400">Cliente: <span className="text-white">{withdrawModal.client_name}</span></p>
              <div className="flex justify-between pt-2 border-t border-border">
                <span className="text-zinc-500">Saldo a cobrar:</span>
                <span className="text-accent font-bold text-base">{formatCurrency(withdrawModal.remaining)}</span>
              </div>
            </div>
            <div>
              <label className={labelCls}>Medio de pago del saldo</label>
              <select value={withdrawPayment} onChange={e => setWithdrawPayment(e.target.value)} className={inputCls}>
                {['Efectivo','Transferencia','Mercado Pago','Tarjeta Débito','Tarjeta Crédito','Cuenta Corriente'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <button onClick={() => setWithdrawModal(null)} disabled={actioning} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg">Cancelar</button>
              <button onClick={handleWithdraw} disabled={actioning} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">
                {actioning ? 'Procesando...' : 'Confirmar retiro'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Ticket Modal */}
      <Modal open={!!ticketData} onClose={() => setTicketData(null)} title="Seña registrada" width="max-w-sm">
        {ticketData && (
          <div className="space-y-4">
            <div className="bg-surface rounded-lg p-4 space-y-2 text-sm">
              <p className="text-zinc-400 text-xs uppercase tracking-wider">{ticketData.senaNumber}</p>
              <p className="text-white font-semibold text-base">{ticketData.productName}{ticketData.size ? ` · T.${ticketData.size}` : ''}</p>
              <p className="text-zinc-400">Cliente: <span className="text-white">{ticketData.clientName}</span></p>
              <div className="flex justify-between pt-2 border-t border-border">
                <span className="text-zinc-500">Seña recibida:</span>
                <span className="text-green-400 font-bold">{fmtMoney(ticketData.advanceAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Saldo pendiente:</span>
                <span className="text-accent font-bold">{fmtMoney(ticketData.remaining)}</span>
              </div>
              {ticketData.deadline && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Fecha límite:</span>
                  <span className="text-zinc-300">{ticketData.deadline}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={async () => {
                let pointsInfo = null
                if (ticketData.clientId) {
                  try {
                    const [client, settings] = await Promise.all([
                      api.clients.get(ticketData.clientId),
                      api.settings.getAll(),
                    ])
                    if (settings.points_enabled === '1') {
                      pointsInfo = {
                        enabled: true,
                        total: client?.points ?? 0,
                        value: Number(settings.point_value) || 100,
                        minRedeem: Number(settings.points_min_redeem) || 5,
                      }
                    }
                  } catch {}
                }
                printSenaTicket(ticketData, ticketData.biz, pointsInfo)
              }}
                className="btn-primary no-drag flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm">
                <Printer size={14} /> Imprimir ticket
              </button>
              {ticketData.clientPhone && (
                <button onClick={() => whatsappSena(ticketData)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm bg-green-500/15 border border-green-500/25 text-green-400 hover:bg-green-500/25 transition-colors no-drag">
                  <MessageSquare size={14} /> Enviar por WhatsApp
                </button>
              )}
              <button onClick={() => setTicketData(null)}
                className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-white/5">
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel Modal */}
      <Modal open={!!cancelModal} onClose={() => !actioning && setCancelModal(null)} title="Cancelar seña" width="max-w-sm">
        {cancelModal && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">¿Cancelar la seña de <strong className="text-white">{cancelModal.client_name}</strong> por <strong className="text-white">{cancelModal.product_name}</strong>?</p>
            <p className="text-sm text-zinc-500">El stock reservado volverá a estar disponible.</p>
            <div>
              <label className={cn('flex items-center gap-3 cursor-pointer p-3 rounded-lg border transition-colors', refundAdvance ? 'border-accent/40 bg-accent/10' : 'border-border hover:border-zinc-600')}>
                <input type="checkbox" checked={refundAdvance} onChange={e => setRefundAdvance(e.target.checked)} className="no-drag" />
                <div>
                  <p className="text-sm text-white">Devolver la seña al cliente</p>
                  <p className="text-xs text-zinc-500">Seña recibida: {formatCurrency(cancelModal.advance_amount)}</p>
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <button onClick={() => setCancelModal(null)} disabled={actioning} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg">Volver</button>
              <button onClick={handleCancel} disabled={actioning} className="px-5 py-2 text-sm rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 no-drag">
                {actioning ? 'Procesando...' : 'Confirmar cancelación'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  )
}
