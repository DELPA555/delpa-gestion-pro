import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Store, ArrowRightLeft, History, Plus, Pencil, Trash2, X, Search, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, cn, debounce } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SkeletonTable from '@/components/shared/SkeletonLoader'

const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

export default function Sucursales() {
  const [tab, setTab] = useState('sucursales')
  const [sucursales, setSucursales] = useState([])
  const [loading, setLoading] = useState(true)
  const [transfers, setTransfers] = useState([])
  const [tLoading, setTLoading] = useState(false)
  const [editModal, setEditModal] = useState(null) // null | { id?, name, address, phone }
  const [delConfirm, setDelConfirm] = useState(null)
  const [processing, setProcessing] = useState(false)

  // Transfer form
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedSize, setSelectedSize] = useState('')
  const [transferForm, setTransferForm] = useState({ quantity: '1', fromId: '', toId: '', notes: '' })
  const [searching, setSearching] = useState(false)

  const loadSucursales = useCallback(async () => {
    setLoading(true)
    try { setSucursales(await api.sucursales.list()) }
    finally { setLoading(false) }
  }, [])

  const loadTransfers = useCallback(async () => {
    setTLoading(true)
    try { setTransfers(await api.sucursales.transfers()) }
    finally { setTLoading(false) }
  }, [])

  useEffect(() => { loadSucursales() }, [loadSucursales])
  useEffect(() => { if (tab === 'transferencias') loadTransfers() }, [tab, loadTransfers])

  const searchProducts = useRef(
    debounce(async (q) => {
      if (!q.trim()) { setProductResults([]); setSearching(false); return }
      setSearching(true)
      try { setProductResults(await api.products.search(q)) }
      finally { setSearching(false) }
    }, 300)
  ).current

  useEffect(() => { searchProducts(productSearch) }, [productSearch, searchProducts])

  const selectProduct = (p) => {
    setSelectedProduct(p)
    setProductSearch(p.name)
    setProductResults([])
    setSelectedSize('')
  }

  const handleSave = async () => {
    if (!editModal.name?.trim()) return toast.error('El nombre es requerido')
    setProcessing(true)
    try {
      if (editModal.id) {
        await api.sucursales.update(editModal.id, { name: editModal.name, address: editModal.address, phone: editModal.phone })
      } else {
        await api.sucursales.create({ name: editModal.name, address: editModal.address, phone: editModal.phone })
      }
      toast.success(editModal.id ? 'Sucursal actualizada' : 'Sucursal creada')
      setEditModal(null)
      loadSucursales()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const handleDelete = async (id) => {
    setProcessing(true)
    try {
      await api.sucursales.delete(id)
      toast.success('Sucursal eliminada')
      setDelConfirm(null)
      loadSucursales()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const handleTransfer = async () => {
    if (!selectedProduct) return toast.error('Seleccioná un producto')
    if (!selectedSize) return toast.error('Seleccioná un talle')
    if (!transferForm.quantity || Number(transferForm.quantity) <= 0) return toast.error('Cantidad inválida')
    if (!transferForm.fromId) return toast.error('Seleccioná sucursal origen')
    if (!transferForm.toId) return toast.error('Seleccioná sucursal destino')
    if (transferForm.fromId === transferForm.toId) return toast.error('Las sucursales deben ser distintas')
    setProcessing(true)
    try {
      await api.sucursales.transfer({
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        size: selectedSize,
        quantity: Number(transferForm.quantity),
        fromId: Number(transferForm.fromId),
        toId: Number(transferForm.toId),
        notes: transferForm.notes,
      })
      toast.success('Transferencia registrada')
      setSelectedProduct(null)
      setSelectedSize('')
      setProductSearch('')
      setTransferForm({ quantity: '1', fromId: '', toId: '', notes: '' })
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const sizes = selectedProduct?.sizes?.map(s => s.size).filter(Boolean) || []

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Sucursales" subtitle="Gestión de locales y transferencias de stock"
        actions={
          tab === 'sucursales' && (
            <button onClick={() => setEditModal({ name: '', address: '', phone: '' })}
              className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
              <Plus size={14} /> Nueva sucursal
            </button>
          )
        }
      />

      <div className="flex border-b border-border mb-5">
        {[
          { id: 'sucursales', label: 'Sucursales', Icon: Store },
          { id: 'transferir', label: 'Transferir stock', Icon: ArrowRightLeft },
          { id: 'transferencias', label: 'Historial', Icon: History },
        ].map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* ── Sucursales tab ── */}
      {tab === 'sucursales' && (
        loading ? <SkeletonTable rows={4} cols={3} />
        : sucursales.length === 0 ? (
          <EmptyState icon={Store} title="Sin sucursales" subtitle="Creá tu primer local para gestionar el stock por sucursal" />
        ) : (
          <div className="grid grid-cols-1 gap-3 max-w-2xl">
            {sucursales.map(s => (
              <div key={s.id} className="bg-card border border-border rounded-xl px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">{s.name}</p>
                  {s.address && <p className="text-xs text-zinc-500 mt-0.5">{s.address}</p>}
                  {s.phone && <p className="text-xs text-zinc-600">{s.phone}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditModal({ id: s.id, name: s.name, address: s.address || '', phone: s.phone || '' })}
                    className="no-drag p-2 text-zinc-500 hover:text-white hover:bg-white/[0.05] rounded-lg transition-colors">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => setDelConfirm(s)}
                    className="no-drag p-2 text-zinc-500 hover:text-red-400 hover:bg-red-500/[0.08] rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Transferir tab ── */}
      {tab === 'transferir' && (
        <div className="max-w-lg space-y-5">
          {sucursales.length < 2 && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-400">
              Necesitás al menos 2 sucursales para transferir stock. Creá más en la pestaña Sucursales.
            </div>
          )}

          {/* Product search */}
          <div>
            <label className={labelCls}>Producto</label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); if (!e.target.value) setSelectedProduct(null) }}
                placeholder="Buscar producto..."
                className={`${inputCls} pl-8`}
              />
              {searching && <RefreshCw size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 animate-spin" />}
              {selectedProduct && (
                <button onClick={() => { setSelectedProduct(null); setProductSearch(''); setSelectedSize('') }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white no-drag">
                  <X size={13} />
                </button>
              )}
            </div>
            {productResults.length > 0 && !selectedProduct && (
              <div className="mt-1 bg-card border border-border rounded-lg shadow-xl max-h-52 overflow-y-auto z-10 relative">
                {productResults.map(p => (
                  <button key={p.id} onClick={() => selectProduct(p)}
                    className="no-drag w-full text-left px-3 py-2.5 text-sm hover:bg-white/[0.05] text-zinc-300 border-b border-border last:border-0">
                    <span className="text-white">{p.name}</span>
                    {p.color && <span className="text-zinc-500 ml-2 text-xs">{p.color}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Size selector */}
          {selectedProduct && (
            <div>
              <label className={labelCls}>Talle</label>
              <div className="flex flex-wrap gap-2">
                {sizes.map(sz => (
                  <button key={sz} onClick={() => setSelectedSize(sz)}
                    className={cn('no-drag px-3 py-1.5 rounded-lg text-sm border transition-colors',
                      selectedSize === sz
                        ? 'border-accent bg-accent/15 text-accent font-medium'
                        : 'border-border text-zinc-400 hover:border-zinc-500 hover:text-white')}>
                    {sz}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>Cantidad</label>
            <input type="number" min="1" className={inputCls} value={transferForm.quantity}
              onChange={e => setTransferForm(p => ({ ...p, quantity: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Origen</label>
              <select className={inputCls} value={transferForm.fromId} onChange={e => setTransferForm(p => ({ ...p, fromId: e.target.value }))}>
                <option value="">Seleccioná sucursal</option>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Destino</label>
              <select className={inputCls} value={transferForm.toId} onChange={e => setTransferForm(p => ({ ...p, toId: e.target.value }))}>
                <option value="">Seleccioná sucursal</option>
                {sucursales.filter(s => String(s.id) !== transferForm.fromId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Notas (opcional)</label>
            <input className={inputCls} value={transferForm.notes} onChange={e => setTransferForm(p => ({ ...p, notes: e.target.value }))} placeholder="Motivo del traslado..." />
          </div>

          <button onClick={handleTransfer} disabled={processing || sucursales.length < 2}
            className="btn-primary no-drag px-5 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50">
            <ArrowRightLeft size={14} /> {processing ? 'Registrando...' : 'Registrar transferencia'}
          </button>
        </div>
      )}

      {/* ── Historial tab ── */}
      {tab === 'transferencias' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {tLoading ? <SkeletonTable rows={6} cols={5} />
          : transfers.length === 0 ? (
            <EmptyState icon={History} title="Sin transferencias" subtitle="Las transferencias de stock aparecerán aquí" />
          ) : (
            <>
              <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px' }}>
                <span>Producto</span><span>Talle</span><span>Origen</span><span>Destino</span><span>Fecha</span><span className="text-right">Cant.</span>
              </div>
              <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
                {transfers.map(t => (
                  <div key={t.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px' }}>
                    <div>
                      <span className="text-white">{t.product_name || '—'}</span>
                      {t.notes && <span className="text-zinc-600 text-xs block truncate max-w-[200px]">{t.notes}</span>}
                    </div>
                    <span className="text-zinc-400 text-xs font-mono">{t.size}</span>
                    <span className="text-zinc-400">{t.from_name || '—'}</span>
                    <span className="text-zinc-300">{t.to_name || '—'}</span>
                    <span className="text-zinc-500 text-xs">{formatDateTime(t.created_at)}</span>
                    <span className="text-right text-accent font-medium tabular-nums">{t.quantity}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Edit/Create modal */}
      {editModal && (
        <Modal open title={editModal.id ? 'Editar sucursal' : 'Nueva sucursal'} onClose={() => setEditModal(null)} width="max-w-sm">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Nombre *</label>
              <input className={inputCls} value={editModal.name} autoFocus
                onChange={e => setEditModal(p => ({ ...p, name: e.target.value }))} placeholder="Ej: Local Centro" />
            </div>
            <div>
              <label className={labelCls}>Dirección</label>
              <input className={inputCls} value={editModal.address}
                onChange={e => setEditModal(p => ({ ...p, address: e.target.value }))} placeholder="Av. Siempre Viva 123" />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input className={inputCls} value={editModal.phone}
                onChange={e => setEditModal(p => ({ ...p, phone: e.target.value }))} placeholder="+54 9 11 ..." />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <button onClick={() => setEditModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
            <button onClick={handleSave} disabled={processing} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">{processing ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </Modal>
      )}

      {/* Delete confirm modal */}
      {delConfirm && (
        <Modal open title="Eliminar sucursal" onClose={() => setDelConfirm(null)} width="max-w-sm">
          <p className="text-sm text-zinc-400">¿Eliminás la sucursal <span className="text-white font-medium">{delConfirm.name}</span>? Esta acción no se puede deshacer.</p>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
            <button onClick={() => handleDelete(delConfirm.id)} disabled={processing}
              className="no-drag px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg font-medium disabled:opacity-50">
              {processing ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}
    </motion.div>
  )
}
