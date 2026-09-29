import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Store, ArrowRightLeft, History, Plus, Pencil, Trash2, X, Search, RefreshCw, Network, Warehouse, Boxes, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, cn, debounce } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import PageHeader from '@/components/shared/PageHeader'
import EmptyState from '@/components/shared/EmptyState'
import SkeletonTable from '@/components/shared/SkeletonLoader'

const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

// ── Helpers de red de locales ──
const NODE_ICON = { deposito: Warehouse, sucursal: Store, ambos: Boxes }
const nodeLabel = (t) => t === 'deposito' ? 'Depósito' : t === 'ambos' ? 'Suc. + Depósito' : 'Sucursal'

// Estado de conexión de un nodo según su última actualización.
function nodeStatus(updatedAt) {
  if (!updatedAt) return { dot: 'bg-zinc-600', text: 'sin datos', tone: 'text-zinc-500' }
  const mins = (Date.now() - new Date(updatedAt).getTime()) / 60000
  if (mins < 25) return { dot: 'bg-emerald-500', text: 'online', tone: 'text-emerald-400' }
  if (mins < 60 * 24) return { dot: 'bg-amber-500', text: `hace ${mins < 60 ? Math.round(mins) + ' min' : Math.round(mins / 60) + ' h'}`, tone: 'text-amber-400' }
  return { dot: 'bg-red-500', text: 'sin conexión', tone: 'text-red-400' }
}

// Orden natural de talles (numéricos primero, luego alfabéticos).
function sizeSort(a, b) {
  const na = parseFloat(a), nb = parseFloat(b)
  const aNum = !isNaN(na) && String(na) === String(a).trim()
  const bNum = !isNaN(nb) && String(nb) === String(b).trim()
  if (aNum && bNum) return na - nb
  if (aNum) return -1
  if (bNum) return 1
  return String(a).localeCompare(String(b))
}

// Clave para identificar el mismo producto entre nodos: barcode si existe, si no nombre+color.
function productKey(p) {
  const bc = (p.b || '').trim()
  if (bc) return 'b:' + bc
  return 'n:' + (p.n || '').toLowerCase().trim() + '|' + (p.c || '').toLowerCase().trim()
}

// Une los snapshots de todos los nodos en una estructura de productos con stock por nodo y talle.
function mergeNetworkStock(nodes) {
  const products = new Map()
  for (const node of nodes) {
    const stock = Array.isArray(node.stock) ? node.stock : []
    for (const p of stock) {
      const key = productKey(p)
      let entry = products.get(key)
      if (!entry) {
        entry = { key, name: p.n || '(sin nombre)', color: p.c || '', category: p.cat || '', sizes: new Set(), perNode: {}, total: 0 }
        products.set(key, entry)
      }
      if (!entry.name || entry.name === '(sin nombre)') entry.name = p.n || entry.name
      if (!entry.color) entry.color = p.c || ''
      if (!entry.category) entry.category = p.cat || ''
      const nodeMap = entry.perNode[node.hwid] || (entry.perNode[node.hwid] = {})
      for (const [size, qty] of (p.s || [])) {
        const q = Number(qty) || 0
        entry.sizes.add(size)
        nodeMap[size] = (nodeMap[size] || 0) + q
        entry.total += q
      }
    }
  }
  return Array.from(products.values())
    .map(e => ({ ...e, sizeList: Array.from(e.sizes).sort(sizeSort) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

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

  // Stock de red (multi-nodo por CUIT)
  const [netStatus, setNetStatus] = useState(null)
  const [netData, setNetData] = useState(null)      // { nodes, thisHwid }
  const [netProducts, setNetProducts] = useState([])
  const [netLoading, setNetLoading] = useState(false)
  const [netError, setNetError] = useState(null)
  const [netSearch, setNetSearch] = useState('')
  const [netCategory, setNetCategory] = useState('')
  const [netExpanded, setNetExpanded] = useState(null)  // product key
  const [netSyncing, setNetSyncing] = useState(false)

  const loadNetwork = useCallback(async () => {
    setNetLoading(true); setNetError(null)
    try {
      const [status, data] = await Promise.all([
        api.network.status().catch(() => null),
        api.network.getStock(),
      ])
      setNetStatus(status)
      setNetData(data)
      setNetProducts(mergeNetworkStock(data.nodes || []))
    } catch (e) {
      setNetError(e.message || 'No se pudo cargar el stock de la red')
    } finally { setNetLoading(false) }
  }, [])

  useEffect(() => { if (tab === 'red' && !netData && !netError) loadNetwork() }, [tab, netData, netError, loadNetwork])

  const handleNetSync = async () => {
    setNetSyncing(true)
    try {
      await api.network.syncNow()
      toast.success('Stock enviado a la red. Puede tardar unos segundos en verse reflejado.')
      setTimeout(() => loadNetwork(), 2500)
    } catch (e) { toast.error(e.message) }
    finally { setNetSyncing(false) }
  }

  const netCategories = Array.from(new Set(netProducts.map(p => p.category).filter(Boolean))).sort()
  const netFiltered = netProducts.filter(p => {
    if (netCategory && p.category !== netCategory) return false
    if (!netSearch.trim()) return true
    const q = netSearch.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.color.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)
  })
  const netNodes = netData?.nodes || []

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
          { id: 'red', label: 'Stock de red', Icon: Network },
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

      {/* ── Stock de red tab ── */}
      {tab === 'red' && (
        <div className="space-y-5">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input value={netSearch} onChange={e => setNetSearch(e.target.value)}
                placeholder="Buscar producto en toda la red..." className={`${inputCls} pl-8`} />
            </div>
            {netCategories.length > 0 && (
              <select value={netCategory} onChange={e => setNetCategory(e.target.value)} className={`${inputCls} max-w-[200px]`}>
                <option value="">Todas las categorías</option>
                {netCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button onClick={loadNetwork} disabled={netLoading}
              className="no-drag flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border text-zinc-300 hover:text-white hover:bg-white/[0.05] disabled:opacity-50">
              <RefreshCw size={14} className={netLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button onClick={handleNetSync} disabled={netSyncing}
              className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg disabled:opacity-50">
              <Network size={14} /> {netSyncing ? 'Enviando...' : 'Subir mi stock'}
            </button>
          </div>

          {/* Nodos conectados */}
          {netNodes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {netNodes.map(n => {
                const st = nodeStatus(n.updatedAt)
                const Icon = NODE_ICON[n.branchType] || Store
                const isThis = n.hwid === netData?.thisHwid
                return (
                  <div key={n.hwid} className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm',
                    isThis ? 'border-accent/50 bg-accent/[0.06]' : 'border-border bg-card')}>
                    <span className={cn('w-2 h-2 rounded-full', st.dot)} />
                    <Icon size={13} className="text-zinc-400" />
                    <span className="text-white">{n.branchName || 'Sin nombre'}</span>
                    {isThis && <span className="text-[10px] text-accent uppercase tracking-wider">este</span>}
                    <span className={cn('text-xs', st.tone)}>· {st.text}</span>
                  </div>
                )
              })}
            </div>
          )}

          {netLoading ? <SkeletonTable rows={6} cols={5} />
          : netError ? (
            <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-300 flex items-start gap-3">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-200">No se pudo cargar el stock de la red</p>
                <p className="mt-1 text-amber-300/80">{netError}</p>
                {netStatus && !netStatus.cuit && (
                  <p className="mt-2 text-xs">Configurá el <span className="font-medium">CUIT</span> en Configuración → Negocio y el tipo de nodo en Configuración → Red de locales.</p>
                )}
              </div>
            </div>
          ) : netProducts.length === 0 ? (
            <EmptyState icon={Boxes} title="Sin stock en la red todavía"
              subtitle="Cuando las sucursales suban su stock (cada 15 min), vas a ver acá el inventario unificado. Tocá 'Subir mi stock' para enviar el de este nodo ahora." />
          ) : (
            <>
              <p className="text-xs text-zinc-500">
                {netFiltered.length} producto{netFiltered.length !== 1 ? 's' : ''} · {netNodes.length} nodo{netNodes.length !== 1 ? 's' : ''} en la red
                {netStatus?.lastSyncAt && <> · tu último envío: {formatDateTime(netStatus.lastSyncAt)}</>}
              </p>
              <div className="space-y-2">
                {netFiltered.map(p => {
                  const open = netExpanded === p.key
                  return (
                    <div key={p.key} className="bg-card border border-border rounded-xl overflow-hidden">
                      <button onClick={() => setNetExpanded(open ? null : p.key)}
                        className="no-drag w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] text-left">
                        <div className="min-w-0">
                          <span className="text-white">{p.name}</span>
                          {p.color && <span className="text-zinc-500 ml-2 text-xs">{p.color}</span>}
                          {p.category && <span className="text-zinc-600 ml-2 text-xs">· {p.category}</span>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-zinc-500">{p.sizeList.length} talle{p.sizeList.length !== 1 ? 's' : ''}</span>
                          <span className="text-accent font-semibold tabular-nums">{p.total}</span>
                        </div>
                      </button>
                      {open && (
                        <div className="border-t border-border overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-[11px] text-zinc-500 uppercase bg-surface">
                                <th className="text-left px-4 py-2 font-medium sticky left-0 bg-surface">Nodo</th>
                                {p.sizeList.map(s => <th key={s} className="px-3 py-2 text-center font-medium tabular-nums">{s}</th>)}
                                <th className="px-4 py-2 text-right font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {netNodes.map(n => {
                                const nodeMap = p.perNode[n.hwid] || {}
                                const rowTotal = p.sizeList.reduce((a, s) => a + (nodeMap[s] || 0), 0)
                                const Icon = NODE_ICON[n.branchType] || Store
                                return (
                                  <tr key={n.hwid} className="row-alt">
                                    <td className="px-4 py-2 sticky left-0 bg-card">
                                      <span className="flex items-center gap-2 text-zinc-300">
                                        <Icon size={12} className="text-zinc-500" />{n.branchName || 'Sin nombre'}
                                      </span>
                                    </td>
                                    {p.sizeList.map(s => {
                                      const q = nodeMap[s] || 0
                                      const tone = q === 0 ? 'text-red-400/70' : q <= 2 ? 'text-amber-400' : 'text-emerald-400'
                                      return <td key={s} className={cn('px-3 py-2 text-center tabular-nums', tone)}>{q}</td>
                                    })}
                                    <td className="px-4 py-2 text-right tabular-nums text-white font-medium">{rowTotal}</td>
                                  </tr>
                                )
                              })}
                              <tr className="bg-surface/60 font-semibold">
                                <td className="px-4 py-2 sticky left-0 bg-surface/60 text-zinc-300">TOTAL RED</td>
                                {p.sizeList.map(s => {
                                  const colTotal = netNodes.reduce((a, n) => a + ((p.perNode[n.hwid] || {})[s] || 0), 0)
                                  return <td key={s} className="px-3 py-2 text-center tabular-nums text-white">{colTotal}</td>
                                })}
                                <td className="px-4 py-2 text-right tabular-nums text-accent">{p.total}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
                {netFiltered.length === 0 && (
                  <EmptyState icon={Search} title="Sin resultados" subtitle="Probá con otro nombre o categoría" />
                )}
              </div>
            </>
          )}
        </div>
      )}

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
