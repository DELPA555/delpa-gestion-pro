import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Plus, Search, ShoppingBag, Trash2, X } from 'lucide-react'
import { PhoneLink } from '@/components/shared/ContactLinks'
import { api } from '@/lib/api'
import { formatCurrency, formatDate, debounce, cn } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

const DEFAULT_JEANS_SIZES    = ['34','36','38','40','42','44','46','48','50']
const DEFAULT_CLOTHING_SIZES = ['XS','S','M','L','XL','XXL']

export default function Purchases() {
  const [jeansSizes, setJeansSizes]       = useState(DEFAULT_JEANS_SIZES)
  const [clothingSizes, setClothingSizes] = useState(DEFAULT_CLOTHING_SIZES)
  const [customSizes, setCustomSizes]     = useState([])
  const [data, setData] = useState({ purchases: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNum, setInvoiceNum] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [paid, setPaid] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [itemSize, setItemSize] = useState('')
  const [itemQty, setItemQty] = useState(1)
  const [itemCost, setItemCost] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.purchases.list({ page, limit: 25 })) }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.settings.getAll().then(all => {
      try { setCustomSizes(JSON.parse(all.custom_sizes || '[]')) } catch {}
    }).catch(() => {})
  }, [])

  const loadSuppliers = async () => {
    const res = await api.suppliers.list({ limit: 100 })
    setSuppliers(res.suppliers || [])
  }

  const openModal = async () => {
    await loadSuppliers()
    setSupplierId(''); setInvoiceNum(''); setDueDate(''); setPaid(''); setNotes(''); setItems([])
    setModal(true)
  }

  const searchProducts = useCallback(debounce(async (q) => {
    if (q.length < 2) { setProductResults([]); return }
    const res = await api.products.search(q)
    setProductResults(res)
  }, 280), [])

  useEffect(() => { searchProducts(productSearch) }, [productSearch, searchProducts])

  const addItem = () => {
    if (!selectedProduct || !itemSize || !itemQty || !itemCost) return toast.error('Completá todos los campos del artículo')
    setItems(it => [...it, {
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      size: itemSize,
      quantity: Number(itemQty),
      unitCost: Number(itemCost),
    }])
    setSelectedProduct(null); setProductSearch(''); setProductResults([])
    setItemSize(''); setItemQty(1); setItemCost('')
  }

  const total = items.reduce((s, it) => s + it.quantity * it.unitCost, 0)

  const save = async () => {
    if (items.length === 0) return toast.error('Agregá al menos un artículo')
    setSaving(true)
    try {
      await api.purchases.create({ supplierId: supplierId || null, invoiceNumber: invoiceNum, items, total, paid: Number(paid) || 0, dueDate, notes })
      toast.success('Compra registrada — stock actualizado')
      setModal(false); load()
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setSaving(false) }
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Compras" subtitle={`${data.total} compras registradas`}
        actions={<button onClick={openModal} className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg"><Plus size={15} /> Nueva compra</button>} />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '60px 2fr 1fr 1fr 1fr 1fr' }}>
          <span>#</span><span>Proveedor</span><span>Factura</span><span>Fecha</span><span className="text-right">Total</span><span className="text-center">Estado</span>
        </div>
        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={5} cols={6} />
            : data.purchases.length === 0 ? (
              <EmptyState icon={ShoppingBag} title="Sin compras registradas" />
            ) : data.purchases.map(p => (
              <div key={p.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '60px 2fr 1fr 1fr 1fr 1fr' }}>
                <span className="text-zinc-600 font-mono">#{p.id}</span>
                <div>
                  <p className="text-white">{p.supplier_name || 'Sin proveedor'}</p>
                  {p.supplier_phone && <PhoneLink phone={p.supplier_phone} />}
                </div>
                <span className="text-zinc-400">{p.invoice_number || '—'}</span>
                <span className="text-zinc-400">{formatDate(p.created_at)}</span>
                <span className="text-white text-right font-medium tabular-nums">{formatCurrency(p.total)}</span>
                <div className="flex justify-center">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', p.status === 'paid' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400')}>
                    {p.status === 'paid' ? 'Pagado' : `Debe ${formatCurrency(p.total - p.paid)}`}
                  </span>
                </div>
              </div>
            ))}
        </div>
        <Pagination page={page} pages={data.pages} total={data.total} limit={25} onChange={setPage} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Nueva compra" width="max-w-3xl">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Proveedor</label>
              <select className={inputCls} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">Sin proveedor</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>N° Factura</label><input className={inputCls} value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} /></div>
            <div><label className={labelCls}>Vencimiento</label><input type="date" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
            <div><label className={labelCls}>Pagado $</label><input type="number" min="0" step="0.01" className={inputCls} value={paid} onChange={e => setPaid(e.target.value)} placeholder="0,00" /></div>
          </div>

          {/* Add product to purchase */}
          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Agregar artículo</p>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input className={`${inputCls} pl-8`} placeholder="Buscar producto..." value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                onBlur={() => setTimeout(() => setProductResults([]), 150)} />
              {productResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl overflow-hidden z-20 shadow-xl">
                  {productResults.map(p => (
                    <button key={p.id} onMouseDown={() => { setSelectedProduct(p); setProductSearch(p.name); setProductResults([]); setItemCost(p.cost || '') }}
                      className="w-full flex justify-between px-4 py-2.5 hover:bg-white/5 text-left text-sm">
                      <span className="text-white">{p.name}</span>
                      <span className="text-zinc-500">{formatCurrency(p.cost)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selectedProduct && (
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className={labelCls}>Talle</label>
                  <select className={inputCls} value={itemSize} onChange={e => setItemSize(e.target.value)}>
                    <option value="">—</option>
                    <optgroup label="Talles numéricos">{jeansSizes.map(s => <option key={s}>{s}</option>)}</optgroup>
                    <optgroup label="Talles de ropa">{clothingSizes.map(s => <option key={s}>{s}</option>)}</optgroup>
                    {customSizes.length > 0 && <optgroup label="Personalizados">{customSizes.map(s => <option key={s}>{s}</option>)}</optgroup>}
                  </select>
                </div>
                <div><label className={labelCls}>Cantidad</label><input type="number" min="1" className={inputCls} value={itemQty} onChange={e => setItemQty(e.target.value)} /></div>
                <div><label className={labelCls}>Costo unit. $</label><input type="number" min="0" step="0.01" className={inputCls} value={itemCost} onChange={e => setItemCost(e.target.value)} /></div>
                <div className="flex items-end">
                  <button onClick={addItem} className="btn-primary no-drag w-full py-2 text-sm rounded-lg">Agregar</button>
                </div>
              </div>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="divide-y divide-border">
                {items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div><span className="text-white">{it.productName}</span><span className="text-zinc-500 ml-2">T.{it.size}</span></div>
                    <div className="flex items-center gap-4">
                      <span className="text-zinc-400">{it.quantity} ud. × {formatCurrency(it.unitCost)}</span>
                      <span className="text-white font-medium tabular-nums">{formatCurrency(it.quantity * it.unitCost)}</span>
                      <button onClick={() => setItems(it2 => it2.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-red-400"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between px-4 py-3 border-t border-border bg-surface text-sm font-bold">
                <span className="text-zinc-400">Total</span>
                <span className="text-white tabular-nums">{formatCurrency(total)}</span>
              </div>
            </div>
          )}

          <div><label className={labelCls}>Notas</label><input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg disabled:opacity-50">{saving ? 'Guardando...' : 'Registrar compra'}</button>
        </div>
      </Modal>
    </motion.div>
  )
}
