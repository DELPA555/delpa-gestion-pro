import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  Plus, Search, Edit2, Trash2, Package, ImagePlus, X, ChevronDown,
  Cloud, CloudOff, CheckSquare, Square, Download, Upload, FileText,
  Layers, Palette, Tag, Percent, Printer, RefreshCw, TrendingUp, TrendingDown,
  PackageCheck,
} from 'lucide-react'

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debouncedValue
}
import { api } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'
import LabelPrintModal, { buildBulkLabels, printA4, printBrother, useBarcodePreview } from '@/components/shared/LabelPrintModal'

const DEFAULT_JEANS_SIZES    = ['34','36','38','40','42','44','46','48','50']
const DEFAULT_CLOTHING_SIZES = ['XS','S','M','L','XL','XXL','XXXL']
const DEFAULT_AMERICAN_SIZES = ['28','30','32','34','36','38','40','42','44','46','48','50','52','54','56','58','60']
const DEFAULT_SHOE_SIZES     = ['25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48']
const DEFAULT_CATEGORIES     = ['Jeans','Camisas','Remeras','Buzos','Camperas','Pantalones','Shorts','Ropa interior','Accesorios','Calzado','Otros']

function sizesForGroup(group, jeansArr, clothingArr, americanArr = DEFAULT_AMERICAN_SIZES, shoeArr = DEFAULT_SHOE_SIZES) {
  if (group === 'numeric')  return jeansArr
  if (group === 'clothing') return clothingArr
  if (group === 'american') return americanArr
  if (group === 'shoe')     return shoeArr
  if (group === 'none')     return []
  return [...jeansArr, ...clothingArr]
}

function emptyForm(allSizes) {
  return {
    barcode: '', name: '', brand: '', category: 'Jeans', color: '',
    cost: '', price: '', min_stock: '5', image_data: '',
    tn_sync: 1,
    is_consignment: false, consignment_supplier_id: '', consignment_cost: '',
    sizes: allSizes.map(s => ({ size: s, stock: 0, min_stock: 0 })),
  }
}

function SizeGrid({ sizes, onChange }) {
  const update = (size, field, val) =>
    onChange(sizes.map(s => s.size === size ? { ...s, [field]: Number(val) || 0 } : s))

  return (
    <div>
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Talles — Stock / Mínimo</p>
      <div className="grid grid-cols-3 gap-1.5">
        {sizes.map(({ size, stock, min_stock: ms }) => (
          <div key={size} className="flex items-center gap-1 bg-[#0a0a0a] border border-border rounded-lg px-2 py-1.5">
            <span className="text-xs font-mono text-zinc-400 w-8 shrink-0">{size}</span>
            <input
              type="number" min="0" value={stock}
              onChange={e => update(size, 'stock', e.target.value)}
              className="w-full text-xs text-center bg-transparent text-white outline-none no-drag"
              placeholder="0"
            />
            <span className="text-zinc-700 text-xs">/</span>
            <input
              type="number" min="0" value={ms}
              onChange={e => update(size, 'min_stock', e.target.value)}
              className="w-12 text-xs text-center bg-transparent text-zinc-500 outline-none no-drag"
              placeholder="2"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function genEAN13Client() {
  const ts = Date.now() % 1000000000
  const base = '779' + String(ts).padStart(9, '0')
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3)
  return base + (10 - sum % 10) % 10
}

function ProductForm({ form, setForm, categories, allSizes, jeansSizes, clothingSizes, americanSizes, shoeSizes, categorySizeGroups, isNew, suppliers }) {
  const fileRef = useRef()
  const field = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const barcodeRef = useBarcodePreview(form.barcode)

  const handleImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => field('image_data', ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleCategoryChange = (newCat) => {
    if (categorySizeGroups[newCat]) {
      const group = categorySizeGroups[newCat]
      const newSizes = sizesForGroup(group, jeansSizes, clothingSizes, americanSizes || DEFAULT_AMERICAN_SIZES, shoeSizes || DEFAULT_SHOE_SIZES)
      setForm(f => ({ ...f, category: newCat, sizes: newSizes.map(s => ({ size: s, stock: 0, min_stock: 0 })) }))
    } else {
      field('category', newCat)
    }
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div
          onClick={() => fileRef.current?.click()}
          className="w-24 h-24 rounded-xl border-2 border-dashed border-border hover:border-accent/50 flex items-center justify-center cursor-pointer shrink-0 bg-[#0a0a0a] transition-colors overflow-hidden"
        >
          {form.image_data ? (
            <img src={form.image_data} alt="producto" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-zinc-600">
              <ImagePlus size={20} />
              <span className="text-[10px]">Foto</span>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
        <div className="flex-1 space-y-3">
          <div>
            <label className={labelCls}>Código de barras</label>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={form.barcode}
                onChange={e => field('barcode', e.target.value)}
                placeholder="Escanear o escribir..."
              />
              <button
                type="button"
                onClick={() => field('barcode', genEAN13Client())}
                className="no-drag shrink-0 px-3 py-2 text-xs border border-border rounded-lg text-zinc-400 hover:text-accent hover:border-accent/50 transition-colors whitespace-nowrap"
              >
                Generar
              </button>
            </div>
            {form.barcode && (
              <div className="mt-2 bg-white rounded-lg p-2 flex justify-center overflow-hidden">
                <svg ref={barcodeRef} />
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>Nombre *</label>
            <input className={inputCls} value={form.name} onChange={e => field('name', e.target.value)} placeholder="Ej: Jean clásico" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Marca</label>
          <input className={inputCls} value={form.brand} onChange={e => field('brand', e.target.value)} placeholder="Ej: Levis" />
        </div>
        <div>
          <label className={labelCls}>Categoría</label>
          <select className={inputCls} value={form.category} onChange={e => handleCategoryChange(e.target.value)}>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Color</label>
          <input className={inputCls} value={form.color} onChange={e => field('color', e.target.value)} placeholder="Ej: Azul marino" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Costo $</label>
          <input type="number" min="0" step="0.01" className={inputCls} value={form.cost}
            onChange={e => field('cost', e.target.value)} placeholder="0,00" />
        </div>
        <div>
          <label className={labelCls}>Precio venta $</label>
          <input type="number" min="0" step="0.01" className={`${inputCls} border-accent/40`} value={form.price}
            onChange={e => field('price', e.target.value)} placeholder="0,00" />
        </div>
        <div>
          <label className={labelCls}>Stock mínimo global</label>
          <input type="number" min="0" className={inputCls} value={form.min_stock}
            onChange={e => field('min_stock', e.target.value)} placeholder="5" />
        </div>
      </div>

      {form.cost > 0 && form.price > 0 && (
        <div className="text-xs text-zinc-500 bg-[#0a0a0a] rounded-lg px-3 py-2">
          Margen: <span className="text-green-400 font-semibold">
            {(((Number(form.price) - Number(form.cost)) / Number(form.cost)) * 100).toFixed(1)}%
          </span>
          {' · '}Ganancia por unidad: <span className="text-green-400 font-semibold">{formatCurrency(Number(form.price) - Number(form.cost))}</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div
          onClick={() => field('tn_sync', form.tn_sync ? 0 : 1)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors no-drag cursor-pointer',
            form.tn_sync
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-border bg-surface text-zinc-500 hover:text-zinc-300'
          )}
        >
          {form.tn_sync ? <Cloud size={12} /> : <CloudOff size={12} />}
          {form.tn_sync ? 'Sync TN activo' : 'Sync TN desactivado'}
        </div>
        <div
          onClick={() => field('is_consignment', !form.is_consignment)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors no-drag cursor-pointer',
            form.is_consignment
              ? 'border-purple-500/40 bg-purple-500/10 text-purple-400'
              : 'border-border bg-surface text-zinc-500 hover:text-zinc-300'
          )}
        >
          <PackageCheck size={12} />
          {form.is_consignment ? 'Consignación activa' : 'Marcar como consignación'}
        </div>
      </div>

      {form.is_consignment && (
        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-purple-400">Configuración de consignación</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Proveedor propietario</label>
              <select className={inputCls} value={form.consignment_supplier_id}
                onChange={e => field('consignment_supplier_id', e.target.value)}>
                <option value="">Sin proveedor</option>
                {(suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Costo por unidad (lo que le debés) $</label>
              <input type="number" min="0" step="0.01" className={inputCls}
                value={form.consignment_cost}
                onChange={e => field('consignment_cost', e.target.value)}
                placeholder="0,00" />
            </div>
          </div>
          <p className="text-[10px] text-zinc-600">Al vender este producto, se registrará automáticamente la deuda con el proveedor.</p>
        </div>
      )}

      <SizeGrid sizes={form.sizes} onChange={sizes => setForm(f => ({ ...f, sizes }))} />
    </div>
  )
}

function VariantForm({ form, setForm, allSizes }) {
  const fileRef = useRef()
  const field = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => field('image_data', ev.target.result)
    reader.readAsDataURL(file)
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div
          onClick={() => fileRef.current?.click()}
          className="w-20 h-20 rounded-xl border-2 border-dashed border-border hover:border-accent/50 flex items-center justify-center cursor-pointer shrink-0 bg-[#0a0a0a] transition-colors overflow-hidden"
        >
          {form.image_data ? (
            <img src={form.image_data} alt="variante" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-zinc-600">
              <Palette size={18} />
              <span className="text-[10px]">Foto</span>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
        <div className="flex-1 space-y-3">
          <div>
            <label className={labelCls}>Color de la variante *</label>
            <input className={inputCls} value={form.color} onChange={e => field('color', e.target.value)} placeholder="Ej: Rojo, Negro, Blanco..." autoFocus />
          </div>
          <div>
            <label className={labelCls}>Barcode (opcional)</label>
            <input className={inputCls} value={form.barcode} onChange={e => field('barcode', e.target.value)} placeholder="Código de barras" />
          </div>
        </div>
      </div>
      <SizeGrid sizes={form.sizes} onChange={sizes => setForm(f => ({ ...f, sizes }))} />
    </div>
  )
}

// Bulk action: change category modal
function BulkCategoryModal({ open, onClose, categories, onApply }) {
  const [cat, setCat] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="Cambiar categoría en lote" width="max-w-sm">
      <select
        className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag"
        value={cat} onChange={e => setCat(e.target.value)}
      >
        <option value="">Seleccioná una categoría...</option>
        {categories.map(c => <option key={c}>{c}</option>)}
      </select>
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
        <button onClick={() => cat && onApply(cat)} className="btn-primary px-4 py-2 text-sm rounded-lg no-drag">Aplicar</button>
      </div>
    </Modal>
  )
}

// Bulk action: apply discount modal
function BulkDiscountModal({ open, onClose, onApply }) {
  const [pct, setPct] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="Aplicar descuento de precio" width="max-w-sm">
      <p className="text-xs text-zinc-500 mb-3">Reducir el precio de venta de los productos seleccionados por un porcentaje.</p>
      <div className="flex items-center gap-2">
        <input
          type="number" min="1" max="99" step="1"
          className="input-field flex-1 bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag"
          placeholder="Ej: 10"
          value={pct} onChange={e => setPct(e.target.value)}
        />
        <span className="text-zinc-400 text-sm">%</span>
      </div>
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
        <button
          onClick={() => { const n = Number(pct); if (n > 0 && n < 100) onApply(n) }}
          className="btn-primary px-4 py-2 text-sm rounded-lg no-drag"
        >
          Aplicar descuento
        </button>
      </div>
    </Modal>
  )
}

// Bulk label modal — 3 pasos: seleccionar productos → configurar cantidades → imprimir
function BulkLabelModal({ open, onClose, products: preSelected }) {
  const [step, setStep]               = useState(1)
  const [allProducts, setAllProducts] = useState([])
  const [loading, setLoading]         = useState(false)
  const [search, setSearch]           = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [sizes, setSizes]             = useState({}) // { [pid]: { [size]: { checked, qty } } }

  useEffect(() => {
    if (!open) return
    setStep(1); setSearch(''); setSizes({})
    setLoading(true)
    api.products.list({ page: 1, limit: 9999, search: '' })
      .then(res => {
        const prods = res?.products || []
        setAllProducts(prods)
        setSelectedIds(new Set((preSelected || []).map(p => p.id)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const filtered = allProducts.filter(p =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.brand || '').toLowerCase().includes(search.toLowerCase())
  )

  const toggleProduct = (id) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const goToStep2 = () => {
    if (!selectedIds.size) return
    const init = {}
    for (const p of allProducts) {
      if (!selectedIds.has(p.id)) continue
      init[p.id] = {}
      for (const s of (p.sizes || []))
        init[p.id][s.size] = { checked: true, qty: Math.max(0, Number(s.stock) || 0) }
    }
    setSizes(init); setStep(2)
  }

  const setSizeQty = (pid, size, qty) => setSizes(prev => ({
    ...prev, [pid]: { ...prev[pid], [size]: { ...prev[pid]?.[size], qty: Math.max(0, Number(qty) || 0) } }
  }))
  const toggleSz = (pid, size) => setSizes(prev => ({
    ...prev, [pid]: { ...prev[pid], [size]: { ...prev[pid]?.[size], checked: !prev[pid]?.[size]?.checked } }
  }))
  const setAllSz = (pid, checked) => setSizes(prev => {
    const next = {}
    for (const k of Object.keys(prev[pid] || {})) next[k] = { ...prev[pid][k], checked }
    return { ...prev, [pid]: next }
  })

  const buildLabels = () => {
    const labels = []
    for (const p of allProducts) {
      if (!selectedIds.has(p.id)) continue
      for (const s of (p.sizes || [])) {
        const cfg = sizes[p.id]?.[s.size]
        if (!cfg?.checked || !cfg.qty) continue
        const barcode = s.size_barcode || p.barcode || ''
        for (let i = 0; i < cfg.qty; i++)
          labels.push({ name: p.name, price: p.price, size: s.size, barcode, color: p.color || '' })
      }
    }
    return labels
  }

  const totalLabels = [...selectedIds].reduce((acc, pid) => {
    const pSizes = sizes[pid] || {}
    return acc + Object.values(pSizes).reduce((a, c) => a + (c.checked ? (c.qty || 0) : 0), 0)
  }, 0)

  const selectedProducts = allProducts.filter(p => selectedIds.has(p.id))
  const inputCls = 'bg-[#0a0a0a] border border-border rounded px-2 py-1 text-xs text-white focus:border-accent outline-none no-drag w-14 text-center'

  /* ── Paso 1: selección de productos ──────────────────────────────────────── */
  if (step === 1) return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-accent" />
            <h3 className="font-semibold text-white text-sm">Etiquetas — Paso 1: Seleccionar productos</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white no-drag"><X size={16} /></button>
        </div>

        <div className="px-5 pt-3 pb-2 shrink-0 space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              className="w-full bg-[#0a0a0a] border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-zinc-600 no-drag focus:border-accent outline-none"
              placeholder="Buscar producto..." value={search}
              onChange={e => setSearch(e.target.value)} autoFocus
            />
          </div>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{selectedIds.size} seleccionados de {allProducts.length}</span>
            <div className="flex gap-3">
              <button onClick={() => setSelectedIds(new Set(filtered.map(p => p.id)))} className="text-accent hover:text-accent/80 no-drag">Todos</button>
              <button onClick={() => setSelectedIds(new Set())} className="hover:text-zinc-300 no-drag">Ninguno</button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {loading ? (
            <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-8">Sin productos</p>
          ) : (
            <div className="space-y-1">
              {filtered.map(p => {
                const checked = selectedIds.has(p.id)
                const totalStock = (p.sizes || []).reduce((s, sz) => s + (sz.stock || 0), 0)
                return (
                  <button key={p.id} onClick={() => toggleProduct(p.id)}
                    className={`no-drag w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${checked ? 'bg-accent/5 border-accent/20' : 'border-border bg-surface/40 hover:bg-white/[0.03]'}`}>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-accent border-accent' : 'border-zinc-600'}`}>
                      {checked && <svg viewBox="0 0 10 8" className="w-2.5"><path d="M1 4l3 3 5-6" stroke="black" strokeWidth="1.5" fill="none"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{p.name}</p>
                      {p.brand && <p className="text-xs text-zinc-500">{p.brand}</p>}
                    </div>
                    <span className="text-xs text-zinc-500 shrink-0">{totalStock} u.</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 no-drag">Cancelar</button>
          <button onClick={goToStep2} disabled={!selectedIds.size}
            className="btn-primary no-drag px-5 py-2 text-sm rounded-lg disabled:opacity-40 flex items-center gap-2">
            Siguiente → Configurar cantidades
          </button>
        </div>
      </div>
    </div>
  )

  /* ── Paso 2: configurar cantidades + imprimir ────────────────────────────── */
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-accent" />
            <h3 className="font-semibold text-white text-sm">Etiquetas — Paso 2: Configurar cantidades</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white no-drag"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {selectedProducts.map(p => (
            <div key={p.id} className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
                <span className="flex-1 text-sm font-medium text-white truncate">{p.name}</span>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => setAllSz(p.id, true)} className="text-accent hover:text-accent/80 no-drag">Todos</button>
                  <button onClick={() => setAllSz(p.id, false)} className="text-zinc-500 hover:text-zinc-300 no-drag">Ninguno</button>
                </div>
              </div>
              <div className="divide-y divide-border/50">
                {(p.sizes || []).map(s => {
                  const cfg = sizes[p.id]?.[s.size] || { checked: false, qty: 0 }
                  return (
                    <div key={s.size} className={`flex items-center gap-3 px-3 py-1.5 ${cfg.checked ? '' : 'opacity-40'}`}>
                      <input type="checkbox" checked={!!cfg.checked} onChange={() => toggleSz(p.id, s.size)}
                        className="accent-[#00c853] w-3.5 h-3.5 shrink-0 no-drag cursor-pointer" />
                      <span className="text-sm text-zinc-300 w-12">T.{s.size}</span>
                      <span className="text-xs text-zinc-600 flex-1">stock: {s.stock}</span>
                      <input type="number" min="0" max="9999"
                        value={cfg.qty} onChange={e => setSizeQty(p.id, s.size, e.target.value)}
                        disabled={!cfg.checked} className={`${inputCls} disabled:opacity-30`} />
                      <span className="text-xs text-zinc-600 w-16">etiquetas</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setStep(1)} className="text-sm text-zinc-400 hover:text-white no-drag">← Volver</button>
            <span className="text-sm text-zinc-400">
              Total: <span className="text-white font-semibold">{totalLabels}</span> etiquetas
              {totalLabels > 65 && <span className="text-zinc-500"> · {Math.ceil(totalLabels / 65)} pág. A4</span>}
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { const l = buildLabels(); if (l.length) { printBrother(l); onClose() } }} disabled={!totalLabels}
              className="no-drag flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors disabled:opacity-40">
              <Printer size={15} /> Imprimir Brother QL-800
            </button>
            <button onClick={() => { const l = buildLabels(); if (l.length) { printA4(l); onClose() } }} disabled={!totalLabels}
              className="no-drag flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-zinc-300 text-sm hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40">
              <Printer size={15} /> Imprimir A4 (65 por hoja)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Import result modal
function ImportResultModal({ open, onClose, result }) {
  if (!result) return null
  return (
    <Modal open={open} onClose={onClose} title="Resultado de importación" width="max-w-md">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-green-400">{result.created || 0}</p>
            <p className="text-xs text-zinc-500 mt-1">Creados</p>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-blue-400">{result.updated || 0}</p>
            <p className="text-xs text-zinc-500 mt-1">Actualizados</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-red-400">{result.errors || 0}</p>
            <p className="text-xs text-zinc-500 mt-1">Errores</p>
          </div>
        </div>
        {result.errorList?.length > 0 && (
          <div className="bg-surface rounded-lg p-3 max-h-40 overflow-y-auto">
            <p className="text-xs text-zinc-500 mb-2">Detalle de errores:</p>
            {result.errorList.map((e, i) => (
              <p key={i} className="text-xs text-red-400 font-mono">{e}</p>
            ))}
          </div>
        )}
      </div>
      <div className="flex justify-end mt-4">
        <button onClick={onClose} className="btn-primary px-4 py-2 text-sm rounded-lg no-drag">Cerrar</button>
      </div>
    </Modal>
  )
}

const COLS = '28px 2fr 1fr 1fr 1fr 72px 44px auto'

// ── Historial de precios (dentro del modal de edición) ────────────────────────

function PriceHistoryInModal({ productId, isEdit }) {
  const [open,    setOpen]    = useState(false)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!productId) return
    setLoading(true)
    try { setHistory(await api.products.priceHistory(productId)) }
    finally { setLoading(false) }
  }, [productId])

  useEffect(() => {
    if (open && productId) load()
  }, [open, load, productId])

  if (!isEdit) return null

  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="no-drag flex items-center gap-2 text-xs text-zinc-500 hover:text-accent transition-colors py-1">
        <TrendingUp size={12}/> {open ? 'Ocultar' : 'Ver'} historial de precios
        {history.length > 0 && !open && <span className="text-accent font-medium">({history.length} cambios)</span>}
      </button>

      {open && (
        <div className="mt-2 bg-[#0a0a0a] border border-border rounded-xl overflow-hidden">
          {loading ? (
            <div className="py-4 flex justify-center"><div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"/></div>
          ) : history.length === 0 ? (
            <p className="text-xs text-zinc-600 py-4 text-center">Sin cambios de precio registrados</p>
          ) : (
            <>
              <div className="px-4 py-2">
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={[...history].reverse().map(r => ({
                    f: new Date(r.changed_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' }),
                    p: r.new_price,
                  }))}>
                    <XAxis dataKey="f" tick={{ fontSize: 9, fill: '#6b7280' }} />
                    <YAxis hide />
                    <Tooltip formatter={v => [formatCurrency(v), 'Precio']} contentStyle={{ background: '#111', border: '1px solid #333', fontSize: 11 }} />
                    <Line type="monotone" dataKey="p" stroke="#e91e8c" strokeWidth={1.5} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="divide-y divide-border/50 max-h-36 overflow-y-auto">
                {history.map(r => {
                  const diff = ((r.new_price - r.old_price) / r.old_price * 100).toFixed(1)
                  return (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                      <span className="text-zinc-600 w-28 shrink-0">{new Date(r.changed_at).toLocaleString('es-AR')}</span>
                      <span className="text-zinc-500 tabular-nums">{formatCurrency(r.old_price)}</span>
                      <span className="text-zinc-600">→</span>
                      <span className="text-white font-medium tabular-nums">{formatCurrency(r.new_price)}</span>
                      <span className={`ml-auto font-medium flex items-center gap-0.5 ${Number(diff) > 0 ? 'text-amber-400' : 'text-blue-400'}`}>
                        {Number(diff) > 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                        {Number(diff) > 0 ? '+' : ''}{diff}%
                      </span>
                      <span className="text-zinc-700 w-16 text-right truncate">{r.changed_by}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function Products() {
  const [data, setData] = useState({ products: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm([]))
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  // Variant state
  const [variantModal, setVariantModal] = useState(false)
  const [variantParentId, setVariantParentId] = useState(null)
  const [variantForm, setVariantForm] = useState({ color: '', barcode: '', image_data: '', sizes: [] })
  const [variantSaving, setVariantSaving] = useState(false)
  const [variantsMap, setVariantsMap] = useState({})

  // Bulk select state
  const [selected, setSelected] = useState(new Set())
  const [bulkModal, setBulkModal] = useState(null) // 'category' | 'discount' | 'labels'
  const [suppliers, setSuppliers] = useState([])
  const [consignmentIds, setConsignmentIds] = useState(new Set())

  // Import result
  const [importResult, setImportResult] = useState(null)
  const [importResultOpen, setImportResultOpen] = useState(false)

  // TN individual sync
  const [syncingId, setSyncingId] = useState(null)

  // Label print
  const [labelProduct, setLabelProduct] = useState(null)
  const [labelOpen, setLabelOpen] = useState(false)

  const [customSizes, setCustomSizes] = useState([])
  const [customCategories, setCustomCategories] = useState([])
  const [categorySizeGroups, setCategorySizeGroups] = useState({})

  const jeansSizes    = useMemo(() => DEFAULT_JEANS_SIZES, [])
  const clothingSizes = useMemo(() => DEFAULT_CLOTHING_SIZES, [])
  const americanSizes = useMemo(() => DEFAULT_AMERICAN_SIZES, [])
  const shoeSizes     = useMemo(() => DEFAULT_SHOE_SIZES, [])
  const allSizes      = useMemo(() => [...new Set([...DEFAULT_JEANS_SIZES, ...DEFAULT_CLOTHING_SIZES, ...DEFAULT_AMERICAN_SIZES, ...DEFAULT_SHOE_SIZES, ...customSizes])], [customSizes])
  const allCategories = useMemo(() => [...DEFAULT_CATEGORIES, ...customCategories], [customCategories])

  const debouncedSearch   = useDebounce(search, 300)
  const debouncedCategory = useDebounce(category, 300)

  useEffect(() => {
    api.settings.getAll().then(all => {
      try { setCustomSizes(JSON.parse(all.custom_sizes || '[]')) } catch {}
      try { setCustomCategories(JSON.parse(all.custom_categories || '[]')) } catch {}
      try { setCategorySizeGroups(JSON.parse(all.category_size_groups || '{}')) } catch {}
    }).catch(() => {})
    api.suppliers.list({ limit: 200 }).then(r => setSuppliers(r.suppliers || [])).catch(() => {})
    api.consignment.products.list().then(rows => {
      setConsignmentIds(new Set((rows || []).map(r => r.product_id)))
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.products.list({ page, search: debouncedSearch, category: debouncedCategory, limit: 25 })
      setData(res)
      setSelected(new Set())
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, debouncedCategory])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setForm(emptyForm(allSizes))
    setEditId(null)
    setModal('create')
  }

  const openEdit = async (id) => {
    const [p, cpRows] = await Promise.all([
      api.products.get(id),
      api.consignment.products.list().catch(() => []),
    ])
    if (!p) return
    const cp = (cpRows || []).find(r => r.product_id === id)
    const sizeMap = Object.fromEntries((p.sizes || []).map(s => [s.size, s]))
    setForm({
      barcode: p.barcode || '',
      name: p.name,
      brand: p.brand || '',
      category: p.category || 'Jeans',
      color: p.color || '',
      cost: p.cost,
      price: p.price,
      min_stock: p.min_stock,
      image_data: undefined,
      tn_sync: p.tn_sync ?? 1,
      is_consignment: !!cp,
      consignment_supplier_id: cp ? String(cp.supplier_id || '') : '',
      consignment_cost: cp ? String(cp.cost_per_unit || '') : '',
      sizes: allSizes.map(s => ({
        size: s,
        stock: sizeMap[s]?.stock ?? 0,
        min_stock: sizeMap[s]?.min_stock ?? 0,
      })),
    })
    setEditId(id)
    setModal('edit')
  }

  const save = async () => {
    if (!form.name.trim()) return toast.error('El nombre es requerido')
    if (!form.price || Number(form.price) <= 0) return toast.error('El precio es requerido')
    setSaving(true)
    try {
      const { is_consignment, consignment_supplier_id, consignment_cost, ...rest } = form
      const payload = {
        ...rest,
        cost: Number(form.cost) || 0,
        price: Number(form.price),
        min_stock: Number(form.min_stock) || 5,
        sizes: form.sizes.filter(s => s.stock > 0 || s.min_stock > 0),
      }
      let savedId = editId
      if (modal === 'create') {
        const res = await api.products.create(payload)
        savedId = res?.id || res
        toast.success('Producto creado')
      } else {
        if (form.image_data === undefined) delete payload.image_data
        await api.products.update(editId, payload)
        toast.success('Producto actualizado')
      }
      // Handle consignment
      if (savedId) {
        await api.consignment.products.set({
          product_id: savedId,
          supplier_id: consignment_supplier_id ? Number(consignment_supplier_id) : null,
          cost_per_unit: Number(consignment_cost) || 0,
          active: is_consignment ? 1 : 0,
        }).catch(() => {})
        setConsignmentIds(prev => {
          const next = new Set(prev)
          if (is_consignment) next.add(savedId)
          else next.delete(savedId)
          return next
        })
      }
      setModal(null)
      load()
    } catch (e) {
      toast.error(e.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id, name) => {
    if (!confirm(`¿Eliminar "${name}"?`)) return
    await api.products.delete(id)
    toast.success('Producto eliminado')
    load()
  }

  // TN individual product sync
  const syncProductToTN = async (e, p) => {
    e.stopPropagation()
    if (syncingId) return
    setSyncingId(p.id)
    try {
      const res = await api.tn.syncProduct(p.id)
      if (res?.ok) toast.success(`"${p.name}" sincronizado con Tienda Nube`)
      else toast.error(res?.error || 'Error al sincronizar')
    } catch (err) {
      toast.error(err.message || 'Error al sincronizar')
    } finally {
      setSyncingId(null)
    }
  }

  const openLabelModal = async (e, p) => {
    e.stopPropagation()
    const full = await api.products.get(p.id).catch(() => null)
    setLabelProduct(full || p)
    setLabelOpen(true)
  }

  // TN sync toggle
  const toggleTnSync = async (e, p) => {
    e.stopPropagation()
    const newVal = p.tn_sync ? 0 : 1
    await api.products.setTnSync(p.id, newVal)
    setData(d => ({
      ...d,
      products: d.products.map(x => x.id === p.id ? { ...x, tn_sync: newVal } : x),
    }))
  }

  // Bulk select
  const toggleSelect = (e, id) => {
    e.stopPropagation()
    setSelected(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const selectAll = () => {
    if (selected.size === data.products.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(data.products.map(p => p.id)))
    }
  }

  const bulkDelete = async () => {
    if (!confirm(`¿Eliminar ${selected.size} productos?`)) return
    await api.products.bulkAction({ action: 'delete', ids: [...selected] })
    toast.success(`${selected.size} productos eliminados`)
    load()
  }

  const bulkSetTnSync = async (value) => {
    await api.products.bulkAction({ action: 'setTnSync', ids: [...selected], value })
    toast.success(`Sync TN ${value ? 'activado' : 'desactivado'} para ${selected.size} productos`)
    load()
  }

  const bulkSetCategory = async (cat) => {
    await api.products.bulkAction({ action: 'setCategory', ids: [...selected], value: cat })
    toast.success(`Categoría actualizada para ${selected.size} productos`)
    setBulkModal(null)
    load()
  }

  const bulkApplyDiscount = async (pct) => {
    await api.products.bulkAction({ action: 'applyDiscount', ids: [...selected], value: pct })
    toast.success(`Descuento del ${pct}% aplicado a ${selected.size} productos`)
    setBulkModal(null)
    load()
  }

  // Variants
  const loadVariants = async (productId) => {
    try {
      const variants = await api.products.getVariants(productId)
      setVariantsMap(m => ({ ...m, [productId]: variants }))
    } catch {}
  }

  const openVariantModal = (parentId) => {
    setVariantParentId(parentId)
    setVariantForm({ color: '', barcode: '', image_data: '', sizes: allSizes.map(s => ({ size: s, stock: 0, min_stock: 0 })) })
    setVariantModal(true)
  }

  const saveVariant = async () => {
    if (!variantForm.color.trim()) return toast.error('El color es requerido')
    setVariantSaving(true)
    try {
      const parent = data.products.find(p => p.id === variantParentId)
      await api.products.createVariant({
        parentProductId: variantParentId,
        color: variantForm.color,
        barcode: variantForm.barcode,
        image_data: variantForm.image_data,
        sizes: variantForm.sizes.filter(s => s.stock > 0 || s.min_stock > 0),
        price: parent?.price || 0,
        cost: parent?.cost || 0,
      })
      toast.success('Variante creada')
      setVariantModal(false)
      await loadVariants(variantParentId)
    } catch (e) {
      toast.error(e.message || 'Error al crear variante')
    } finally {
      setVariantSaving(false)
    }
  }

  // Print stock
  const handlePrintStock = async () => {
    try {
      const all = await api.settings.getAll()
      const bizName = all.business_name || 'DELPA'
      const bizLogo = all.business_logo || ''
      const res = await api.products.list({ limit: 9999 })
      const products = res.products || []
      const low = products.filter(p => {
        const total = (p.sizes || []).reduce((s, x) => s + x.stock, 0)
        return total <= (p.min_stock || 5)
      })
      const totalUnits = products.reduce((s, p) => s + (p.sizes || []).reduce((ss, x) => ss + x.stock, 0), 0)
      const totalValue = products.reduce((s, p) => s + (p.sizes || []).reduce((ss, x) => ss + x.stock * p.price, 0), 0)

      const rows = products.map(p => {
        const sizes = (p.sizes || []).filter(s => s.stock > 0)
        const total = sizes.reduce((s, x) => s + x.stock, 0)
        const isLow = total <= (p.min_stock || 5)
        return `<tr style="background:${isLow ? '#fff0f0' : 'white'}">
          <td style="padding:4px 6px;border-bottom:1px solid #eee">${p.name}${p.color ? ` <span style="color:#888">${p.color}</span>` : ''}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;color:#777">${p.category || '—'}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;color:#555">${p.barcode || ''}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">$${Number(p.price).toFixed(2)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;font-size:11px">${sizes.map(s => `${s.size}:${s.stock}`).join(' | ')}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:${isLow ? '#dc2626' : '#166534'}">${total}</td>
        </tr>`
      }).join('')

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;padding:16px;color:#1a1a1a}
h1{font-size:18px;font-weight:bold;margin-bottom:2px}
.meta{color:#666;font-size:11px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#f0f0f0;padding:5px 6px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#555}
.total-row td{font-weight:bold;background:#f9f9f9;padding:6px;border-top:2px solid #333}
.summary{margin-top:16px;padding:12px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;font-size:12px}
.summary p{margin:3px 0}.low{color:#dc2626;font-weight:bold}
@media print{@page{size:A4;margin:12mm}}</style>
</head><body>
${bizLogo ? `<img src="${bizLogo}" style="height:36px;object-fit:contain;margin-bottom:6px" alt="logo">` : ''}
<h1>${bizName} — Reporte de Stock</h1>
<p class="meta">Generado: ${new Date().toLocaleString('es-AR')} · ${products.length} productos · ${totalUnits} unidades totales</p>
<table>
<thead><tr><th>Producto</th><th>Categoría</th><th>Código</th><th style="text-align:right">Precio</th><th>Stock por talle</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="summary">
  <p><strong>Total de productos:</strong> ${products.length}</p>
  <p><strong>Total de unidades:</strong> ${totalUnits.toLocaleString('es-AR')}</p>
  <p><strong>Valor total del inventario:</strong> $${Number(totalValue).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
  ${low.length > 0 ? `<p class="low">⚠ ${low.length} productos con stock bajo o sin stock</p>` : ''}
</div>
</body></html>`

      const w = window.open('', '_blank', 'width=900,height=700')
      w.document.write(html)
      w.document.close()
      w.onload = () => { w.print(); setTimeout(() => w.close(), 800) }

      // Send PDF by email in background
      api.email.sendStockReport().then(res => {
        if (res?.ok) toast.success(`PDF generado y enviado por email a ${res.email_to}`)
        else toast.error(`PDF generado, pero no se pudo enviar el email: ${res?.error || 'Error desconocido'}`)
      }).catch(e => toast.error(`PDF generado, pero no se pudo enviar el email: ${e.message}`))
    } catch (e) { toast.error(e.message || 'Error al generar reporte') }
  }

  // Import / Export
  const handleExportCSV = async () => {
    const res = await api.products.exportCSV()
    if (res?.ok === false) toast.error(res.error || 'Error al exportar')
    else toast.success('CSV exportado correctamente')
  }

  const handleImportCSV = async () => {
    const res = await api.products.importCSV()
    if (!res) return
    if (res.ok === false) { toast.error(res.error || 'Error al importar'); return }
    setImportResult(res)
    setImportResultOpen(true)
    load()
  }

  const handleTemplate = async () => {
    const res = await api.products.csvTemplate()
    if (res?.ok === false) toast.error(res.error || 'Error')
    else toast.success('Plantilla descargada')
  }

  const handleExpand = async (id) => {
    const isExpanded = expandedId === id
    setExpandedId(isExpanded ? null : id)
    if (!isExpanded && !variantsMap[id]) {
      await loadVariants(id)
    }
  }

  const allSelected = data.products.length > 0 && selected.size === data.products.length
  const someSelected = selected.size > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader
        title="Productos"
        subtitle={`${data.total} productos en catálogo`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={handlePrintStock}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-3 py-2 rounded-lg border border-border hover:bg-white/5 transition-colors no-drag">
              <Printer size={13} /> Imprimir Stock
            </button>
            <button onClick={handleTemplate}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-3 py-2 rounded-lg border border-border hover:bg-white/5 transition-colors no-drag">
              <FileText size={13} /> Plantilla
            </button>
            <button onClick={handleImportCSV}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-3 py-2 rounded-lg border border-border hover:bg-white/5 transition-colors no-drag">
              <Upload size={13} /> Importar CSV
            </button>
            <button onClick={handleExportCSV}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-3 py-2 rounded-lg border border-border hover:bg-white/5 transition-colors no-drag">
              <Download size={13} /> Exportar CSV
            </button>
            <button onClick={openCreate}
              className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
              <Plus size={15} /> Nuevo producto
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            className="input-field w-full bg-card border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
            placeholder="Buscar por nombre, código, marca..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select
          className="input-field bg-card border border-border rounded-lg px-3 py-2 text-sm text-white no-drag"
          value={category} onChange={e => { setCategory(e.target.value); setPage(1) }}
        >
          <option value="">Todas las categorías</option>
          {allCategories.map(c => <option key={c}>{c}</option>)}
        </select>
        {(search || category) && (
          <button onClick={() => { setSearch(''); setCategory(''); setPage(1) }}
            className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 px-2">
            <X size={13} /> Limpiar
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {someSelected && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 bg-accent/10 border border-accent/20 rounded-xl px-4 py-2.5 mb-4"
          >
            <span className="text-sm text-accent font-medium mr-2">{selected.size} seleccionados</span>
            <button onClick={bulkDelete}
              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 border border-red-500/20 transition-colors no-drag">
              <Trash2 size={12} /> Eliminar
            </button>
            <button onClick={() => bulkSetTnSync(1)}
              className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 px-2.5 py-1.5 rounded-lg hover:bg-accent/10 border border-accent/20 transition-colors no-drag">
              <Cloud size={12} /> Activar TN
            </button>
            <button onClick={() => bulkSetTnSync(0)}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1.5 rounded-lg hover:bg-white/5 border border-border transition-colors no-drag">
              <CloudOff size={12} /> Desactivar TN
            </button>
            <button onClick={() => setBulkModal('category')}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1.5 rounded-lg hover:bg-white/5 border border-border transition-colors no-drag">
              <Tag size={12} /> Categoría
            </button>
            <button onClick={() => setBulkModal('discount')}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1.5 rounded-lg hover:bg-white/5 border border-border transition-colors no-drag">
              <Percent size={12} /> Descuento
            </button>
            <button onClick={() => setBulkModal('labels')}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1.5 rounded-lg hover:bg-white/5 border border-border transition-colors no-drag">
              <Tag size={12} /> Etiquetas
            </button>
            <button onClick={() => setSelected(new Set())}
              className="ml-auto text-xs text-zinc-600 hover:text-zinc-300 no-drag">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase tracking-wider px-4 py-2.5 border-b border-border bg-surface items-center"
          style={{ gridTemplateColumns: COLS }}>
          <button onClick={selectAll} className="flex items-center no-drag">
            {allSelected
              ? <CheckSquare size={14} className="text-accent" />
              : <Square size={14} className="text-zinc-600" />
            }
          </button>
          <span>Producto</span>
          <span>Categoría</span>
          <span className="text-right">Precio</span>
          <span className="text-right">Margen</span>
          <span className="text-right">Stock</span>
          <span className="text-center">TN</span>
          <span />
        </div>

        {loading ? (
          <SkeletonTable rows={6} cols={7} />
        ) : data.products.length === 0 ? (
          <EmptyState icon={Package} title={search ? 'Sin coincidencias' : 'Sin productos en catálogo'} />
        ) : (
          <div className="divide-y divide-border">
            {data.products.map(p => {
              const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0
              const totalStock = p.total_stock
              const isExpanded = expandedId === p.id
              const variants = variantsMap[p.id] || p.variants || []
              const isSel = selected.has(p.id)

              return (
                <div key={p.id}>
                  <motion.div
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                    className={cn('grid items-center px-4 py-3 cursor-pointer', isSel && 'bg-accent/5')}
                    style={{ gridTemplateColumns: COLS }}
                    onClick={() => handleExpand(p.id)}
                  >
                    <button
                      onClick={e => toggleSelect(e, p.id)}
                      className="flex items-center no-drag"
                    >
                      {isSel
                        ? <CheckSquare size={14} className="text-accent" />
                        : <Square size={14} className="text-zinc-600" />
                      }
                    </button>

                    <div className="flex items-center gap-3 min-w-0">
                      {p.image_data ? (
                        <img src={p.image_data} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-surface flex items-center justify-center shrink-0">
                          <Package size={14} className="text-zinc-600" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm text-white font-medium truncate">{p.name}</p>
                          {variants.length > 0 && (
                            <span className="text-[10px] text-zinc-500 bg-surface px-1.5 py-0.5 rounded font-mono">{variants.length}v</span>
                          )}
                          {consignmentIds.has(p.id) && (
                            <span className="text-[9px] text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded font-medium">CONSIG</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 truncate">{[p.brand, p.color].filter(Boolean).join(' · ') || p.barcode || '—'}</p>
                      </div>
                    </div>

                    <span className="text-xs text-zinc-400">{p.category || '—'}</span>
                    <span className="text-sm text-white text-right font-medium tabular-nums">{formatCurrency(p.price)}</span>
                    <span className={`text-xs text-right font-medium ${margin >= 30 ? 'text-green-400' : margin >= 10 ? 'text-amber-400' : 'text-red-400'}`}>
                      {p.cost > 0 ? `${margin.toFixed(0)}%` : '—'}
                    </span>
                    <span className={`text-sm text-right font-bold tabular-nums ${totalStock === 0 ? 'text-red-400' : totalStock <= p.min_stock ? 'text-amber-400' : 'text-white'}`}>
                      {totalStock}
                    </span>

                    <button
                      onClick={e => toggleTnSync(e, p)}
                      className="flex items-center justify-center no-drag"
                      title={p.tn_sync ? 'Sincronizando con Tienda Nube (click para desactivar)' : 'Excluido de TN (click para activar)'}
                    >
                      {p.tn_sync
                        ? <Cloud size={14} className="text-accent" />
                        : <CloudOff size={14} className="text-zinc-600" />
                      }
                    </button>

                    <div className="flex items-center gap-1 pl-2">
                      {p.tn_sync ? (
                        <button onClick={e => syncProductToTN(e, p)} disabled={syncingId === p.id}
                          title="Sincronizar con Tienda Nube"
                          className="p-1.5 text-zinc-600 hover:text-accent rounded hover:bg-accent/10 transition-colors no-drag disabled:opacity-40">
                          <RefreshCw size={13} className={syncingId === p.id ? 'animate-spin' : ''} />
                        </button>
                      ) : null}
                      <button onClick={e => openLabelModal(e, p)}
                        title="Imprimir etiquetas"
                        className="p-1.5 text-zinc-600 hover:text-accent rounded hover:bg-accent/10 transition-colors no-drag">
                        <Tag size={13} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); openEdit(p.id) }}
                        className="p-1.5 text-zinc-600 hover:text-accent rounded hover:bg-accent/10 transition-colors no-drag">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); remove(p.id, p.name) }}
                        className="p-1.5 text-zinc-600 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors no-drag">
                        <Trash2 size={13} />
                      </button>
                      <ChevronDown size={13} className={`text-zinc-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </motion.div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden bg-surface/50 border-t border-border"
                      >
                        <div className="px-12 py-3 space-y-3">
                          {/* Stock by size */}
                          <div>
                            <p className="text-[11px] text-zinc-600 uppercase tracking-wider mb-2">Stock por talle</p>
                            {(p.sizes || []).filter(s => s.stock >= 0).length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {(p.sizes || []).filter(s => s.stock >= 0).map(s => (
                                  <div key={s.size}
                                    className={cn(
                                      'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border',
                                      s.stock === 0
                                        ? 'border-red-500/20 bg-red-500/5 text-red-400'
                                        : s.stock <= s.min_stock
                                        ? 'border-amber-500/20 bg-amber-500/5 text-amber-400'
                                        : 'border-border bg-card text-zinc-300'
                                    )}>
                                    <span className="font-mono font-medium">{s.size}</span>
                                    <span className="font-bold">{s.stock}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-zinc-600">Sin talles cargados</span>
                            )}
                          </div>

                          {/* Variants */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[11px] text-zinc-600 uppercase tracking-wider">Variantes de color</p>
                              <button
                                onClick={e => { e.stopPropagation(); openVariantModal(p.id) }}
                                className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 no-drag"
                              >
                                <Plus size={12} /> Agregar variante
                              </button>
                            </div>
                            {variants.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {variants.map(v => (
                                  <div key={v.id}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-xs">
                                    {v.image_data && (
                                      <img src={v.image_data} alt="" className="w-5 h-5 rounded object-cover" />
                                    )}
                                    <Palette size={11} className="text-zinc-500" />
                                    <span className="text-zinc-300">{v.color}</span>
                                    <span className="text-zinc-600">·</span>
                                    <span className="text-white font-medium">{v.total_stock || 0}</span>
                                    {v.tn_sync
                                      ? <Cloud size={10} className="text-accent" />
                                      : <CloudOff size={10} className="text-zinc-600" />
                                    }
                                    <button
                                      onClick={e => { e.stopPropagation(); openEdit(v.id) }}
                                      className="text-zinc-600 hover:text-accent no-drag"
                                    >
                                      <Edit2 size={11} />
                                    </button>
                                    <button
                                      onClick={e => { e.stopPropagation(); remove(v.id, `${p.name} - ${v.color}`) }}
                                      className="text-zinc-600 hover:text-red-400 no-drag"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-zinc-600">Sin variantes de color</span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}

        <Pagination page={page} pages={data.pages} total={data.total} limit={25} onChange={setPage} />
      </div>

      {/* Product modal */}
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'Nuevo producto' : 'Editar producto'}
        width="max-w-3xl"
      >
        <PriceHistoryInModal productId={editId} isEdit={modal === 'edit'} />
        <ProductForm
          form={form}
          setForm={setForm}
          categories={allCategories}
          allSizes={allSizes}
          jeansSizes={jeansSizes}
          clothingSizes={clothingSizes}
          americanSizes={americanSizes}
          shoeSizes={shoeSizes}
          categorySizeGroups={categorySizeGroups}
          isNew={modal === 'create'}
          suppliers={suppliers}
        />
        <div className="flex justify-between gap-3 mt-6 pt-4 border-t border-border">
          <div>
            {modal === 'edit' && (
              <button
                onClick={() => {
                  setLabelProduct({ name: form.name, price: form.price, brand: form.brand, sizes: form.sizes })
                  setLabelOpen(true)
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-400 hover:text-accent border border-border hover:border-accent/40 rounded-lg transition-colors no-drag">
                <Tag size={14} /> Imprimir etiquetas
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setModal(null)}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
              Cancelar
            </button>
            <button onClick={save} disabled={saving}
              className="btn-primary no-drag px-5 py-2 text-sm rounded-lg disabled:opacity-50">
              {saving ? 'Guardando...' : modal === 'create' ? 'Crear producto' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Variant modal */}
      <Modal open={variantModal} onClose={() => setVariantModal(false)} title="Nueva variante de color" width="max-w-2xl">
        <VariantForm form={variantForm} setForm={setVariantForm} allSizes={allSizes} />
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setVariantModal(false)}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-white/5">
            Cancelar
          </button>
          <button onClick={saveVariant} disabled={variantSaving}
            className="btn-primary no-drag px-5 py-2 text-sm rounded-lg disabled:opacity-50">
            {variantSaving ? 'Guardando...' : 'Crear variante'}
          </button>
        </div>
      </Modal>

      {/* Bulk modals */}
      <BulkCategoryModal
        open={bulkModal === 'category'}
        onClose={() => setBulkModal(null)}
        categories={allCategories}
        onApply={bulkSetCategory}
      />
      <BulkDiscountModal
        open={bulkModal === 'discount'}
        onClose={() => setBulkModal(null)}
        onApply={bulkApplyDiscount}
      />
      <BulkLabelModal
        open={bulkModal === 'labels'}
        onClose={() => setBulkModal(null)}
        products={data.products.filter(p => selected.has(p.id))}
      />

      {/* Import result modal */}
      <ImportResultModal
        open={importResultOpen}
        onClose={() => setImportResultOpen(false)}
        result={importResult}
      />

      {/* Label print modal */}
      <LabelPrintModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        product={labelProduct}
      />
    </motion.div>
  )
}
