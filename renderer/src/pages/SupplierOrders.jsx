import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ClipboardList, Plus, ChevronLeft, RefreshCw, Trash2, Search,
  Package, Printer, Send, CheckCircle, X, Truck,
  MessageCircle, PackagePlus, AlertTriangle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
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

function newCard() {
  return { _key: `${Date.now()}-${Math.random()}`, product_id: null, product_name: '', color: '', cost: 0, sizes: [] }
}

// ── Grilla de talles para pedido (referencia de stock, sin validación) ────────

function SizeGridOrder({ sizes, onChange }) {
  if (!sizes?.length) return null
  const cols = Math.min(sizes.length, 8)
  return (
    <div className="grid gap-2 pt-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(50px, 1fr))` }}>
      {sizes.map(({ size, stock, qty }) => (
        <div key={size} className="flex flex-col items-center gap-0.5">
          <span className="text-[11px] text-zinc-400 font-mono font-medium">T.{size}</span>
          {stock != null && (
            <span className={cn('text-[9px] tabular-nums leading-none',
              stock === 0 ? 'text-amber-500' : 'text-zinc-600')}>
              St:{stock}
            </span>
          )}
          <input
            type="number" min="0"
            value={qty || ''}
            onChange={e => onChange(size, Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-[#0a0a0a] border border-border rounded px-1 py-1.5 text-sm text-white text-center outline-none focus:border-accent transition-colors no-drag"
            placeholder="0"
          />
        </div>
      ))}
    </div>
  )
}

// ── Tarjeta de producto para pedido ──────────────────────────────────────────

function ProductCardOrder({ card, onUpdate, onRemove }) {
  const [search,  setSearch]  = useState(card.product_name || '')
  const [results, setResults] = useState([])
  const [open,    setOpen]    = useState(false)
  const dropRef = useRef(null)
  const timer   = useRef(null)

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
      const sizes = (full?.sizes || []).map(s => ({ size: s.size, stock: s.stock ?? 0, qty: 0 }))
      onUpdate({ ...card, product_id: p.id, product_name: p.name, color: p.color || '', cost: p.cost || 0, sizes })
    } catch {
      onUpdate({ ...card, product_id: p.id, product_name: p.name, color: p.color || '', cost: p.cost || 0, sizes: [] })
    }
  }

  const totalQty = card.sizes.reduce((s, sz) => s + (sz.qty || 0), 0)
  const subtotal = totalQty * (Number(card.cost) || 0)

  return (
    <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
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
            <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-[#111] border border-border rounded-xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto">
              {results.slice(0, 10).map(p => (
                <button key={p.id} type="button" onClick={() => pick(p)}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-white/[0.06] transition-colors border-b border-border/40 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white font-medium truncate">{p.name}</span>
                    <span className="text-zinc-500 shrink-0">{formatCurrency(p.cost || 0)}</span>
                  </div>
                  {p.color && <span className="text-zinc-500">{p.color}</span>}
                </button>
              ))}
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
          <SizeGridOrder
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
                value={card.cost || ''}
                onChange={e => onUpdate({ ...card, cost: Number(e.target.value) || 0 })}
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
  const [view, setView]         = useState('list')   // 'list' | 'form'
  const [editOrder, setEditOrder] = useState(null)

  // ── List state ──────────────────────────────────────────────────────────────
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage]       = useState(1)
  const [total, setTotal]     = useState(0)
  const [filterStatus, setFilterStatus]   = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [search, setSearch]   = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [biz, setBiz]         = useState({})

  // ── Form state ──────────────────────────────────────────────────────────────
  const [fSupplierId,   setFSupplierId]   = useState('')
  const [fSupplierName, setFSupplierName] = useState('')
  const [fSupplierEmail,setFSupplierEmail]= useState('')
  const [fSupplierPhone,setFSupplierPhone]= useState('')
  const [fNotes,        setFNotes]        = useState('')
  const [fCards,        setFCards]        = useState([newCard()])
  const [fSaving,       setFSaving]       = useState(false)
  const [loadingLow,    setLoadingLow]    = useState(false)

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
    setFNotes(''); setFCards([newCard()])
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
      setFNotes(order.notes || '')

      // Agrupar ítems guardados por product_id → una tarjeta por producto
      const grouped = {}
      for (const it of (order.items || [])) {
        if (!grouped[it.product_id]) {
          grouped[it.product_id] = {
            _key: `${it.product_id}-${Math.random()}`,
            product_id: it.product_id,
            product_name: it.product_name || '',
            color: it.color || '',
            cost: it.cost || 0,
            sizes: [],
          }
        }
        grouped[it.product_id].sizes.push({ size: it.size || '', stock: null, qty: it.qty || 0 })
      }

      // Enriquecer con stock actual por producto
      const cards = await Promise.all(Object.values(grouped).map(async (card) => {
        try {
          const full = await api.products.get(card.product_id)
          if (full?.sizes?.length) {
            // Construir grilla completa con todos los talles, mergeando cantidades guardadas
            const savedQties = Object.fromEntries(card.sizes.map(s => [s.size, s.qty]))
            card.sizes = full.sizes.map(s => ({
              size: s.size,
              stock: s.stock ?? 0,
              qty: savedQties[s.size] || 0,
            }))
          }
        } catch {}
        return card
      }))

      setFCards(cards.length ? cards : [newCard()])
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

      // Agrupar filas por product_id → una tarjeta por producto
      const grouped = {}
      for (const r of rows) {
        if (!grouped[r.product_id]) {
          grouped[r.product_id] = {
            _key: `${r.product_id}-${Math.random()}`,
            product_id: r.product_id,
            product_name: r.product_name || '',
            color: r.color || '',
            cost: r.cost || 0,
            sizes: [],
          }
        }
        grouped[r.product_id].sizes.push({
          size: r.size || 'N/A',
          stock: r.stock ?? 0,
          qty: Math.max(1, r.qty_needed || 1),
        })
      }

      const newCards = Object.values(grouped)
      setFCards(prev => {
        const existingIds = new Set(prev.filter(c => c.product_id).map(c => c.product_id))
        const toAdd = newCards.filter(c => !existingIds.has(c.product_id))
        const base  = prev.filter(c => c.product_id)
        return [...base, ...toAdd]
      })
      toast.success(`${newCards.length} productos bajo mínimo agregados`)
    } catch { toast.error('Error al cargar stock bajo') }
    finally { setLoadingLow(false) }
  }

  // Expandir tarjetas a lista plana de ítems (una entrada por talle con qty > 0)
  function expandCards(cards) {
    const items = []
    for (const card of cards) {
      if (!card.product_id) continue
      for (const sz of card.sizes) {
        if ((sz.qty || 0) > 0) {
          items.push({
            product_id:   card.product_id,
            product_name: card.product_name,
            color:        card.color || '',
            size:         sz.size,
            qty:          sz.qty,
            cost:         Number(card.cost) || 0,
          })
        }
      }
    }
    return items
  }

  const saveOrder = async (status = 'draft') => {
    const validItems = expandCards(fCards)
    if (!validItems.length) { toast.error('Agregá al menos un producto con cantidad'); return }
    setFSaving(true)
    try {
      const payload = {
        supplier_id: fSupplierId ? Number(fSupplierId) : null,
        supplier_name: fSupplierName, supplier_email: fSupplierEmail,
        supplier_phone: fSupplierPhone, notes: fNotes, items: validItems, status,
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
    const validItems = expandCards(fCards)
    if (!validItems.length) { toast.error('Agregá al menos un producto con cantidad'); return }
    setFSaving(true)
    try {
      const payload = {
        supplier_id: fSupplierId ? Number(fSupplierId) : null,
        supplier_name: fSupplierName, supplier_email: fSupplierEmail,
        supplier_phone: fSupplierPhone, notes: fNotes, items: validItems, status: 'sent',
      }
      let orderNumber
      if (editOrder) {
        await api.supplierOrders.update({ id: editOrder.id, ...payload })
        orderNumber = editOrder.order_number
      } else {
        const res = await api.supplierOrders.create(payload)
        orderNumber = res.order_number
      }
      printOrderPDF({ ...payload, order_number: orderNumber, created_at: new Date().toISOString() }, biz)
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
      await api.supplierOrders.convertToEntry(id)
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

  const fTotal = fCards.reduce((s, c) => {
    const qty = c.sizes.reduce((ss, sz) => ss + (sz.qty || 0), 0)
    return s + qty * (Number(c.cost) || 0)
  }, 0)
  const pages = Math.ceil(total / LIMIT)

  // ── FORM VIEW ─────────────────────────────────────────────────────────────────
  if (view === 'form') return (
    <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }} transition={{ duration:0.18 }}
      className="p-6 space-y-5 h-full overflow-auto">
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

      {/* Productos con grilla de talles */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider">
            Productos — distribuí cantidades por talle
          </p>
          <button onClick={addLowStock} disabled={loadingLow}
            className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-xs border border-amber-500/40 text-amber-400 rounded-lg hover:bg-amber-500/10 transition-colors disabled:opacity-50">
            <AlertTriangle size={11} className={loadingLow ? 'animate-pulse' : ''} />
            {loadingLow ? 'Cargando...' : 'Agregar desde stock mínimo'}
          </button>
        </div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {fCards.map(card => (
              <motion.div key={card._key}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.15 }}>
                <ProductCardOrder
                  card={card}
                  onUpdate={updated => setFCards(p => p.map(c => c._key === updated._key ? updated : c))}
                  onRemove={() => setFCards(p => p.filter(c => c._key !== card._key))}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <button type="button" onClick={() => setFCards(p => [...p, newCard()])}
          className="no-drag mt-2 flex items-center gap-2 px-4 py-2.5 w-full border border-dashed border-border rounded-xl text-zinc-500 hover:text-white hover:border-accent/50 transition-colors text-sm">
          <Plus size={14} /> Agregar producto
        </button>
      </div>

      {/* Notes */}
      <div>
        <label className={labelCls}>Observaciones (opcional)</label>
        <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2}
          placeholder="Indicaciones especiales, plazo de entrega esperado, etc."
          className={cn(inputCls, 'resize-none')} />
      </div>

      {/* Footer con total + acciones */}
      <div className="flex items-center gap-4 bg-card border border-border rounded-xl px-5 py-4">
        <div className="flex-1">
          <p className="text-xs text-zinc-500">Total del pedido</p>
          <p className="text-xl font-bold text-accent tabular-nums">{formatCurrency(fTotal)}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setView('list')} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
            Cancelar
          </button>
          <button onClick={() => saveOrder('draft')} disabled={fSaving}
            className="no-drag px-4 py-2 text-sm border border-border text-zinc-300 rounded-lg hover:border-zinc-500 transition-colors disabled:opacity-50">
            Guardar borrador
          </button>
          <button onClick={confirmAndPrint} disabled={fSaving}
            className="no-drag btn-primary flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg font-medium disabled:opacity-50">
            <Printer size={14} className={fSaving ? 'animate-spin' : ''} />
            {fSaving ? 'Guardando...' : 'Confirmar y generar PDF'}
          </button>
        </div>
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

      {/* Filtros */}
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

      {/* Tabla */}
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
                    <button onClick={async () => {
                      const full = await api.supplierOrders.get(o.id)
                      if (full) printOrderPDF(full, biz)
                    }} title="Imprimir PDF"
                      className="no-drag p-1.5 text-zinc-600 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                      <Printer size={13} />
                    </button>
                    {o.supplier_phone && (
                      <button onClick={async () => {
                        const full = await api.supplierOrders.get(o.id)
                        if (full) sendWhatsApp(full)
                      }} title="Enviar por WhatsApp"
                        className="no-drag p-1.5 text-zinc-600 hover:text-green-400 hover:bg-white/5 rounded-lg transition-colors">
                        <MessageCircle size={13} />
                      </button>
                    )}
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

      {/* Paginación */}
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
