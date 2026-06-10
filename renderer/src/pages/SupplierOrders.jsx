import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ClipboardList, Plus, ChevronLeft, RefreshCw, Trash2, Search,
  Package, Printer, Send, CheckCircle, X, Truck,
  MessageCircle, PackagePlus, AlertTriangle, ChevronDown,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, cn, debounce } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SkeletonTable from '@/components/shared/SkeletonLoader'

const STATUS = {
  draft:    { label: 'Borrador',         cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
  sent:     { label: 'Enviado',          cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  confirmed:{ label: 'Confirmado',       cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  partial:  { label: 'Recibido parcial', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  received: { label: 'Recibido',         cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
}

const inputCls = 'w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, cls: 'bg-zinc-800 text-zinc-400' }
  return <span className={cn('text-[11px] px-2 py-0.5 rounded-full border font-medium', s.cls)}>{s.label}</span>
}

function newItem() {
  return { _key: `${Date.now()}-${Math.random()}`, product_id: null, product_name: '', color: '', size: '', qty: 1, cost: 0 }
}

// ── Item row with product search ───────────────────────────────────────────────
function ItemRow({ item, onChange, onRemove, allSizes }) {
  const [query, setQuery]     = useState(item.product_name || '')
  const [results, setResults] = useState([])
  const [sizes, setSizes]     = useState([])
  const [searching, setSearching] = useState(false)

  const search = useCallback(debounce(async (q) => {
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    try { setResults(await api.products.search(q)) } catch {}
    finally { setSearching(false) }
  }, 280), [])

  useEffect(() => {
    if (!item.product_id) search(query)
  }, [query])

  const selectProduct = async (p) => {
    setQuery(p.name)
    setResults([])
    try {
      const full = await api.products.get(p.id)
      const productSizes = (full?.sizes || []).map(s => s.size)
      setSizes(productSizes)
      onChange({ ...item, product_id: p.id, product_name: p.name, cost: p.cost || 0, color: p.color || '', size: productSizes[0] || '' })
    } catch {
      onChange({ ...item, product_id: p.id, product_name: p.name, cost: p.cost || 0, color: p.color || '' })
    }
  }

  const handleBarcode = async (e) => {
    if (e.key !== 'Enter' || item.product_id) return
    e.preventDefault()
    const code = query.trim()
    if (code.length < 4) return
    try {
      const result = await api.products.searchByBarcode(code)
      if (result) {
        await selectProduct(result)
        if (result.matchedSize) onChange(prev => ({ ...prev, size: result.matchedSize }))
      } else { toast.error('Código no encontrado') }
    } catch {}
  }

  return (
    <div className="grid gap-2 items-center py-2 border-b border-border/50"
      style={{ gridTemplateColumns: '2.5fr 1fr 1fr 80px 100px 80px 32px' }}>
      {/* Product search */}
      <div className="relative">
        {item.product_id ? (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border border-accent/30 rounded-lg">
            <Package size={12} className="text-accent shrink-0" />
            <span className="text-xs text-white truncate">{item.product_name}</span>
            <button onClick={() => { onChange({ ...item, product_id: null, product_name: '', size: '', color: '' }); setQuery(''); setSizes([]) }}
              className="ml-auto text-zinc-600 hover:text-red-400 shrink-0 no-drag"><X size={11} /></button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleBarcode}
                placeholder="Buscar o escanear..." className={cn(inputCls, 'pl-7 text-xs py-1.5')} />
              {searching && <RefreshCw size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 animate-spin" />}
            </div>
            {results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-0.5 bg-card border border-border rounded-xl overflow-hidden z-20 shadow-xl max-h-40 overflow-y-auto">
                {results.slice(0, 8).map(p => (
                  <button key={p.id} onMouseDown={() => selectProduct(p)}
                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/5 text-left">
                    <span className="text-xs text-white truncate">{p.name}{p.color ? ` · ${p.color}` : ''}</span>
                    <span className="text-[10px] text-zinc-500 ml-2 shrink-0">{formatCurrency(p.cost || 0)}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Color */}
      <input value={item.color} onChange={e => onChange({ ...item, color: e.target.value })}
        placeholder="Color" className={cn(inputCls, 'text-xs py-1.5')} />

      {/* Size */}
      {sizes.length > 0 ? (
        <select value={item.size} onChange={e => onChange({ ...item, size: e.target.value })}
          className={cn(inputCls, 'text-xs py-1.5')}>
          <option value="">— Talle —</option>
          {sizes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : (
        <input value={item.size} onChange={e => onChange({ ...item, size: e.target.value })}
          placeholder="Talle" className={cn(inputCls, 'text-xs py-1.5')} />
      )}

      {/* Qty */}
      <input type="number" min="1" value={item.qty} onChange={e => onChange({ ...item, qty: Math.max(1, Number(e.target.value) || 1) })}
        className={cn(inputCls, 'text-xs py-1.5 text-center')} />

      {/* Cost */}
      <input type="number" min="0" step="0.01" value={item.cost} onChange={e => onChange({ ...item, cost: Number(e.target.value) || 0 })}
        className={cn(inputCls, 'text-xs py-1.5 text-right')} />

      {/* Subtotal */}
      <span className="text-xs text-zinc-300 tabular-nums text-right px-1">
        {formatCurrency((item.qty || 0) * (item.cost || 0))}
      </span>

      {/* Delete */}
      <button onClick={onRemove} className="no-drag text-zinc-600 hover:text-red-400 flex items-center justify-center">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

// ── PDF generator ──────────────────────────────────────────────────────────────
function printOrderPDF(order, biz = {}) {
  const bizName  = biz.business_name || 'DELPA'
  const bizAddr  = biz.business_address || ''
  const bizPhone = biz.business_phone || ''
  const logoHtml = biz.business_logo ? `<img src="${biz.business_logo}" style="height:44px;object-fit:contain;display:block;margin-bottom:4px">` : ''
  const total    = (order.items || []).reduce((s, it) => s + (it.qty||0)*(it.cost||0), 0)
  const rows = (order.items || []).map(it => `
    <tr>
      <td>${it.product_name || ''}</td>
      <td>${it.size || '—'}</td>
      <td>${it.color || '—'}</td>
      <td style="text-align:center">${it.qty || 0}</td>
      <td style="text-align:right">$${Number(it.cost||0).toLocaleString('es-AR',{minimumFractionDigits:2})}</td>
      <td style="text-align:right">$${((it.qty||0)*(it.cost||0)).toLocaleString('es-AR',{minimumFractionDigits:2})}</td>
    </tr>
  `).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:24px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #333}
.biz{flex:1}.biz h1{font-size:16px;font-weight:bold;margin-bottom:2px}.biz p{color:#555;font-size:10px}
.order-info{text-align:right}.order-info .num{font-size:20px;font-weight:bold;color:#111}.order-info p{color:#555;font-size:10px;margin-top:2px}
.supplier-box{background:#f9f9f9;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px}
.supplier-box h3{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px}
.supplier-box p{font-size:12px;font-weight:600}.supplier-box span{font-size:10px;color:#555}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{background:#f0f0f0;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.3px;border-bottom:2px solid #ccc;text-align:left}
td{padding:5px 8px;border-bottom:1px solid #eee;font-size:11px}
.total-section{text-align:right;border-top:2px solid #333;padding-top:10px}
.total-section .total{font-size:16px;font-weight:bold}
.notes-box{background:#fffde7;border:1px solid #f0e000;border-radius:4px;padding:10px;font-size:11px;margin-bottom:16px}
.signature{margin-top:40px;display:flex;gap:40px}
.sig-line{flex:1;border-top:1px solid #999;padding-top:6px;font-size:10px;color:#777;text-align:center}
.footer{margin-top:20px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:10px;text-align:center}
@media print{@page{size:A4;margin:14mm}body{padding:0}}
</style></head><body>
<div class="header">
  <div class="biz">
    ${logoHtml}
    <h1>${bizName}</h1>
    ${bizAddr ? `<p>${bizAddr}</p>` : ''}
    ${bizPhone ? `<p>Tel: ${bizPhone}</p>` : ''}
  </div>
  <div class="order-info">
    <div class="num">${order.order_number}</div>
    <p>Fecha: ${new Date(order.created_at || Date.now()).toLocaleDateString('es-AR')}</p>
    <p style="margin-top:4px;background:#f0f0f0;padding:3px 8px;border-radius:4px;display:inline-block">PEDIDO A PROVEEDOR</p>
  </div>
</div>

<div class="supplier-box">
  <h3>Proveedor</h3>
  <p>${order.supplier_name || '(Sin proveedor)'}</p>
  ${order.supplier_email ? `<span>📧 ${order.supplier_email}</span>` : ''}
  ${order.supplier_phone ? `<span style="margin-left:12px">📞 ${order.supplier_phone}</span>` : ''}
</div>

<table>
<thead><tr>
  <th>Producto</th><th>Talle</th><th>Color</th>
  <th style="text-align:center">Cantidad</th>
  <th style="text-align:right">P. Unitario</th>
  <th style="text-align:right">Subtotal</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>

<div class="total-section">
  <p class="total">TOTAL: $${total.toLocaleString('es-AR',{minimumFractionDigits:2})}</p>
</div>

${order.notes ? `<div class="notes-box" style="margin-top:16px"><strong>Observaciones:</strong> ${order.notes}</div>` : ''}

<div class="signature">
  <div class="sig-line">Firma proveedor / Confirmación</div>
  <div class="sig-line">Aclaración</div>
  <div class="sig-line">Fecha confirmación</div>
</div>

<div class="footer">Por favor confirmar disponibilidad de los productos. ${bizName} — ${new Date().toLocaleDateString('es-AR')}</div>

<script>window.onload=()=>{window.print();window.close()}<\/script>
</body></html>`
  const w = window.open('', '_blank', 'width=900,height=700')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SupplierOrders() {
  const [view, setView]       = useState('list')   // 'list' | 'form'
  const [editOrder, setEditOrder] = useState(null) // null = new, obj = editing

  // ── List state ──────────────────────────────────────────────────────────────
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage]       = useState(1)
  const [total, setTotal]     = useState(0)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [search, setSearch]   = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [biz, setBiz]         = useState({})

  // ── Form state ──────────────────────────────────────────────────────────────
  const [fSupplierId, setFSupplierId] = useState('')
  const [fSupplierName, setFSupplierName] = useState('')
  const [fSupplierEmail, setFSupplierEmail] = useState('')
  const [fSupplierPhone, setFSupplierPhone] = useState('')
  const [fDate, setFDate]     = useState(new Date().toISOString().split('T')[0])
  const [fNotes, setFNotes]   = useState('')
  const [fItems, setFItems]   = useState([newItem()])
  const [fSaving, setFSaving] = useState(false)
  const [loadingLow, setLoadingLow] = useState(false)

  const LIMIT = 20

  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.supplierOrders.list({
        page, limit: LIMIT,
        status: filterStatus || undefined,
        supplier_id: filterSupplier ? Number(filterSupplier) : undefined,
        search: search || undefined,
      })
      setOrders(res.orders || [])
      setTotal(res.total || 0)
    } catch { toast.error('Error al cargar pedidos') }
    finally { setLoading(false) }
  }, [page, filterStatus, filterSupplier, search])

  useEffect(() => { loadOrders() }, [loadOrders])
  useEffect(() => {
    api.suppliers.list({ limit: 999 }).then(r => setSuppliers(r.suppliers || [])).catch(() => {})
    api.settings.getAll().then(s => setBiz(s)).catch(() => {})
  }, [])

  const openNew = () => {
    setEditOrder(null)
    setFSupplierId(''); setFSupplierName(''); setFSupplierEmail(''); setFSupplierPhone('')
    setFDate(new Date().toISOString().split('T')[0])
    setFNotes(''); setFItems([newItem()])
    setView('form')
  }

  const openEdit = async (id) => {
    try {
      const order = await api.supplierOrders.get(id)
      if (!order) return
      setEditOrder(order)
      setFSupplierId(order.supplier_id ? String(order.supplier_id) : '')
      setFSupplierName(order.supplier_name || '')
      setFSupplierEmail(order.supplier_email || '')
      setFSupplierPhone(order.supplier_phone || '')
      setFDate(order.created_at?.split('T')[0] || new Date().toISOString().split('T')[0])
      setFNotes(order.notes || '')
      setFItems(order.items?.length ? order.items.map(it => ({ ...it, _key: `${it.product_id}-${it.size}-${Math.random()}` })) : [newItem()])
      setView('form')
    } catch { toast.error('Error al cargar pedido') }
  }

  const handleSupplierChange = (id) => {
    setFSupplierId(id)
    const sup = suppliers.find(s => String(s.id) === String(id))
    if (sup) { setFSupplierName(sup.name); setFSupplierEmail(sup.email || ''); setFSupplierPhone(sup.phone || '') }
    else if (!id) { setFSupplierName(''); setFSupplierEmail(''); setFSupplierPhone('') }
  }

  const addLowStock = async () => {
    setLoadingLow(true)
    try {
      const rows = await api.supplierOrders.lowStock()
      if (!rows?.length) { toast.info('No hay productos bajo el stock mínimo'); return }
      const newItems = rows.map(r => ({
        _key: `${r.product_id}-${r.size}-${Math.random()}`,
        product_id: r.product_id,
        product_name: r.product_name,
        color: r.color || '',
        size: r.size || 'N/A',
        qty: Math.max(1, r.qty_needed || 1),
        cost: r.cost || 0,
      }))
      setFItems(prev => {
        const existingKeys = new Set(prev.filter(i => i.product_id).map(i => `${i.product_id}-${i.size}`))
        const toAdd = newItems.filter(i => !existingKeys.has(`${i.product_id}-${i.size}`))
        const base = prev.filter(i => i.product_id)
        return [...base, ...toAdd]
      })
      toast.success(`${newItems.length} productos bajo mínimo agregados`)
    } catch { toast.error('Error al cargar stock bajo') }
    finally { setLoadingLow(false) }
  }

  const saveOrder = async (status = 'draft') => {
    const validItems = fItems.filter(it => it.product_id && it.qty > 0)
    if (validItems.length === 0) { toast.error('Agregá al menos un producto'); return }
    setFSaving(true)
    try {
      const payload = {
        supplier_id: fSupplierId ? Number(fSupplierId) : null,
        supplier_name: fSupplierName,
        supplier_email: fSupplierEmail,
        supplier_phone: fSupplierPhone,
        notes: fNotes,
        items: validItems,
        status,
      }
      if (editOrder) {
        await api.supplierOrders.update({ id: editOrder.id, ...payload })
        toast.success('Pedido actualizado')
      } else {
        const res = await api.supplierOrders.create(payload)
        toast.success(`Pedido ${res.order_number} creado`)
      }
      setView('list')
      loadOrders()
    } catch (e) { toast.error(e.message || 'Error al guardar') }
    finally { setFSaving(false) }
  }

  const confirmAndPrint = async () => {
    const validItems = fItems.filter(it => it.product_id && it.qty > 0)
    if (validItems.length === 0) { toast.error('Agregá al menos un producto'); return }
    setFSaving(true)
    try {
      const payload = {
        supplier_id: fSupplierId ? Number(fSupplierId) : null,
        supplier_name: fSupplierName, supplier_email: fSupplierEmail,
        supplier_phone: fSupplierPhone, notes: fNotes, items: validItems, status: 'sent',
      }
      let orderId, orderNumber
      if (editOrder) {
        await api.supplierOrders.update({ id: editOrder.id, ...payload })
        orderId = editOrder.id; orderNumber = editOrder.order_number
      } else {
        const res = await api.supplierOrders.create(payload)
        orderId = res.id; orderNumber = res.order_number
      }
      const total = validItems.reduce((s, it) => s + (it.qty||0)*(it.cost||0), 0)
      printOrderPDF({ ...payload, order_number: orderNumber, created_at: new Date().toISOString(), items: validItems }, biz)
      toast.success(`Pedido ${orderNumber} generado`)
      setView('list')
      loadOrders()
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setFSaving(false) }
  }

  const changeStatus = async (id, status) => {
    try {
      const order = await api.supplierOrders.get(id)
      if (!order) return
      await api.supplierOrders.update({ id, ...order, items: order.items, status })
      toast.success(`Estado actualizado: ${STATUS[status]?.label}`)
      loadOrders()
    } catch (e) { toast.error(e.message || 'Error') }
  }

  const deleteOrder = async (id) => {
    if (!confirm('¿Eliminar este pedido?')) return
    try {
      await api.supplierOrders.delete(id)
      toast.success('Pedido eliminado')
      loadOrders()
    } catch (e) { toast.error(e.message || 'Solo se pueden eliminar borradores') }
  }

  const convertToEntry = async (id) => {
    if (!confirm('Esto creará un Ingreso de Mercadería con los productos del pedido y actualizará el stock. ¿Continuar?')) return
    try {
      const res = await api.supplierOrders.convertToEntry(id)
      toast.success('Ingreso de mercadería creado exitosamente')
      loadOrders()
    } catch (e) { toast.error(e.message || 'Error al convertir') }
  }

  const sendWhatsApp = (order) => {
    const phone = order.supplier_phone?.replace(/\D/g, '')
    if (!phone) { toast.error('El proveedor no tiene teléfono registrado'); return }
    const total = (order.items || []).reduce((s, it) => s + (it.qty||0)*(it.cost||0), 0)
    const lines = (order.items || []).map(it => `• ${it.product_name} T.${it.size||'—'} ${it.color||''} × ${it.qty}`).join('\n')
    const msg = encodeURIComponent(`Hola! Te envío el pedido ${order.order_number}:\n\n${lines}\n\nTotal: $${total.toLocaleString('es-AR')}\n\nPor favor confirmar disponibilidad. Gracias!`)
    api.shell.openExternal(`https://wa.me/${phone}?text=${msg}`)
  }

  const fTotal = fItems.reduce((s, it) => s + (it.qty||0)*(it.cost||0), 0)
  const pages  = Math.ceil(total / LIMIT)

  // ── FORM VIEW ─────────────────────────────────────────────────────────────────
  if (view === 'form') return (
    <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }} transition={{ duration:0.18 }}
      className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => setView('list')} className="no-drag flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors">
          <ChevronLeft size={15} /> Volver
        </button>
        <div className="h-4 w-px bg-border" />
        <h1 className="text-lg font-semibold text-white">
          {editOrder ? `Editar ${editOrder.order_number}` : 'Nuevo pedido a proveedor'}
        </h1>
        {editOrder && <StatusBadge status={editOrder.status} />}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Supplier */}
        <div>
          <label className={labelCls}>Proveedor</label>
          <select value={fSupplierId} onChange={e => handleSupplierChange(e.target.value)} className={inputCls}>
            <option value="">— Seleccionar proveedor —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Nombre del proveedor</label>
          <input value={fSupplierName} onChange={e => setFSupplierName(e.target.value)} placeholder="Nombre..." className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input type="email" value={fSupplierEmail} onChange={e => setFSupplierEmail(e.target.value)} placeholder="email@proveedor.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Teléfono / WhatsApp</label>
          <input value={fSupplierPhone} onChange={e => setFSupplierPhone(e.target.value)} placeholder="+54 9 11..." className={inputCls} />
        </div>
      </div>

      {/* Items table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
          <p className="text-sm font-medium text-white">{fItems.filter(i=>i.product_id).length} productos</p>
          <div className="flex gap-2">
            <button onClick={addLowStock} disabled={loadingLow}
              className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-xs border border-amber-500/40 text-amber-400 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50">
              <AlertTriangle size={11} className={loadingLow ? 'animate-pulse' : ''} />
              {loadingLow ? 'Cargando...' : 'Agregar desde stock mínimo'}
            </button>
            <button onClick={() => setFItems(p => [...p, newItem()])}
              className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 border border-accent/30 text-accent rounded-lg hover:bg-accent/20 transition-colors">
              <Plus size={11} /> Agregar fila
            </button>
          </div>
        </div>

        <div className="px-4 pt-2">
          <div className="grid text-[10px] text-zinc-600 uppercase pb-1"
            style={{ gridTemplateColumns: '2.5fr 1fr 1fr 80px 100px 80px 32px' }}>
            <span>Producto</span><span>Color</span><span>Talle</span>
            <span className="text-center">Cantidad</span>
            <span className="text-right">P. costo</span>
            <span className="text-right">Subtotal</span>
            <span></span>
          </div>
          {fItems.map((item, idx) => (
            <ItemRow key={item._key} item={item}
              onChange={updated => setFItems(p => p.map(i => i._key === updated._key ? updated : i))}
              onRemove={() => setFItems(p => p.filter(i => i._key !== item._key))} />
          ))}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-surface">
          <span className="text-xs text-zinc-500">Total del pedido</span>
          <span className="text-lg font-bold text-white tabular-nums">{formatCurrency(fTotal)}</span>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}>Observaciones (opcional)</label>
        <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2}
          placeholder="Indicaciones especiales, plazo de entrega esperado, etc."
          className={cn(inputCls, 'resize-none')} />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        <button onClick={() => setView('list')} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
          Cancelar
        </button>
        <button onClick={() => saveOrder('draft')} disabled={fSaving}
          className="no-drag px-4 py-2 text-sm border border-border text-zinc-300 rounded-lg hover:border-zinc-500 transition-colors disabled:opacity-50">
          Guardar borrador
        </button>
        <button onClick={confirmAndPrint} disabled={fSaving}
          className="no-drag btn-primary flex items-center gap-2 px-5 py-2 text-sm rounded-lg font-medium disabled:opacity-50">
          <Printer size={14} className={fSaving ? 'animate-spin' : ''} />
          {fSaving ? 'Guardando...' : 'Confirmar y generar PDF'}
        </button>
      </div>
    </motion.div>
  )

  // ── LIST VIEW ─────────────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }} transition={{ duration:0.18 }}
      className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <PageHeader title="Pedidos a Proveedores" subtitle="Gestión de órdenes de reposición" />
        <button onClick={openNew}
          className="no-drag btn-primary flex items-center gap-2 px-4 py-2 text-sm rounded-lg font-medium">
          <Plus size={14} /> Nuevo pedido
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Buscar por número o proveedor..."
            className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none" />
        </div>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterSupplier} onChange={e => { setFilterSupplier(e.target.value); setPage(1) }}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none">
          <option value="">Todos los proveedores</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={loadOrders} disabled={loading}
          className="no-drag flex items-center gap-1.5 px-3 py-2 text-sm border border-border text-zinc-400 rounded-lg hover:text-white hover:border-zinc-500 transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-4"><SkeletonTable rows={6} cols={6} /></div>
        ) : orders.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Sin pedidos" subtitle="Creá el primer pedido a proveedor" />
        ) : (
          <>
            <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
              style={{ gridTemplateColumns: '140px 1.5fr 100px 1fr 90px 1fr' }}>
              <span>N° Pedido</span>
              <span>Proveedor</span>
              <span>Fecha</span>
              <span>Estado</span>
              <span className="text-right">Total</span>
              <span className="text-right">Acciones</span>
            </div>
            <div className="divide-y divide-border">
              {orders.map(o => (
                <div key={o.id} className="row-alt grid items-center px-4 py-3"
                  style={{ gridTemplateColumns: '140px 1.5fr 100px 1fr 90px 1fr' }}>
                  <button onClick={() => openEdit(o.id)}
                    className="text-left text-sm font-mono font-medium text-accent hover:underline no-drag">
                    {o.order_number}
                  </button>
                  <div className="flex items-center gap-1.5 text-sm">
                    <Truck size={12} className="text-zinc-600 shrink-0" />
                    <span className="text-white truncate">{o.supplier_name || '—'}</span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {new Date(o.created_at).toLocaleDateString('es-AR')}
                  </span>
                  <StatusBadge status={o.status} />
                  <span className="text-right text-sm tabular-nums font-medium text-white">{formatCurrency(o.total)}</span>
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Print */}
                    <button onClick={async () => {
                      const full = await api.supplierOrders.get(o.id)
                      if (full) printOrderPDF(full, biz)
                    }} title="Imprimir PDF"
                      className="no-drag p-1.5 text-zinc-600 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                      <Printer size={13} />
                    </button>
                    {/* WhatsApp */}
                    {o.supplier_phone && (
                      <button onClick={async () => {
                        const full = await api.supplierOrders.get(o.id)
                        if (full) sendWhatsApp(full)
                      }} title="Enviar por WhatsApp"
                        className="no-drag p-1.5 text-zinc-600 hover:text-green-400 hover:bg-white/5 rounded-lg transition-colors">
                        <MessageCircle size={13} />
                      </button>
                    )}
                    {/* Status transitions */}
                    {o.status === 'draft' && (
                      <button onClick={() => changeStatus(o.id, 'sent')} title="Marcar como enviado"
                        className="no-drag p-1.5 text-zinc-600 hover:text-blue-400 hover:bg-white/5 rounded-lg transition-colors">
                        <Send size={13} />
                      </button>
                    )}
                    {o.status === 'sent' && (
                      <button onClick={() => changeStatus(o.id, 'confirmed')} title="Marcar como confirmado"
                        className="no-drag p-1.5 text-zinc-600 hover:text-amber-400 hover:bg-white/5 rounded-lg transition-colors">
                        <CheckCircle size={13} />
                      </button>
                    )}
                    {o.status === 'confirmed' && (
                      <button onClick={() => changeStatus(o.id, 'partial')} title="Marcar recibido parcial"
                        className="no-drag p-1.5 text-zinc-600 hover:text-orange-400 hover:bg-white/5 rounded-lg transition-colors">
                        <Package size={13} />
                      </button>
                    )}
                    {(o.status === 'partial' || o.status === 'confirmed') && (
                      <button onClick={() => convertToEntry(o.id)} title="Convertir a Ingreso de Mercadería"
                        className="no-drag flex items-center gap-1 px-2 py-1 text-[11px] bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg hover:bg-green-500/20 transition-colors">
                        <PackagePlus size={11} /> Recibir
                      </button>
                    )}
                    {/* Delete (draft only) */}
                    {o.status === 'draft' && (
                      <button onClick={() => deleteOrder(o.id)} title="Eliminar"
                        className="no-drag p-1.5 text-zinc-700 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>{total} pedidos</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="no-drag px-3 py-1.5 border border-border rounded-lg hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40">
              Anterior
            </button>
            <span className="text-zinc-400">{page} / {pages}</span>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="no-drag px-3 py-1.5 border border-border rounded-lg hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40">
              Siguiente
            </button>
          </div>
        </div>
      )}
    </motion.div>
  )
}
