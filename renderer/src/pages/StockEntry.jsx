import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  PackagePlus, Plus, Trash2, X, ChevronLeft, ChevronRight,
  Tag, ChevronDown, ChevronUp, Search, ToggleLeft, ToggleRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import PageHeader from '@/components/shared/PageHeader'
import LabelPrintModal from '@/components/shared/LabelPrintModal'

const inputCls = 'w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors'

const CATEGORIES = ['Jeans','Camisas','Remeras','Buzos','Camperas','Pantalones','Shorts','Ropa interior','Accesorios','Calzado','Otros']
const SIZES_FOR = {
  Jeans:           ['34','36','38','40','42','44','46','48','50'],
  Pantalones:      ['34','36','38','40','42','44','46','48','50'],
  Shorts:          ['34','36','38','40','42','44','46','48','50'],
  Camisas:         ['XS','S','M','L','XL','XXL','XXXL'],
  Remeras:         ['XS','S','M','L','XL','XXL','XXXL'],
  Buzos:           ['XS','S','M','L','XL','XXL','XXXL'],
  Camperas:        ['XS','S','M','L','XL','XXL','XXXL'],
  'Ropa interior': ['XS','S','M','L','XL','XXL','XXXL'],
  Calzado:         ['35','36','37','38','39','40','41','42','43','44','45'],
  Accesorios:      ['Único'],
  Otros:           ['Único'],
}

function defaultSizesForCat(cat) {
  return (SIZES_FOR[cat] || ['XS','S','M','L','XL','XXL','XXXL']).map(s => ({ size: s, qty: 0, current_stock: null }))
}

function newCard() {
  return {
    _key: `${Date.now()}-${Math.random()}`,
    is_new: false,
    collapsed: false,
    product_id: null,
    product_name: '',
    product_price: 0,
    cost: '',
    sizes: [],
    new_product: { name: '', brand: '', category: 'Jeans', color: '', price: '', barcode: '' },
  }
}

function SizeQtyGrid({ sizes, onChange }) {
  if (!sizes || sizes.length === 0) return null
  const update = (size, val) =>
    onChange(sizes.map(s => s.size === size ? { ...s, qty: Math.max(0, Number(val) || 0) } : s))
  const cols = Math.min(sizes.length, 6)
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(52px, 1fr))` }}>
      {sizes.map(({ size, qty, current_stock }) => (
        <div key={size} className="flex flex-col items-center gap-0.5">
          <span className="text-[11px] text-zinc-400 font-mono font-medium">{size}</span>
          {current_stock !== null && (
            <span className="text-[9px] text-zinc-600">({current_stock})</span>
          )}
          <input
            type="number" min="0" max="9999"
            value={qty || ''}
            onChange={e => update(size, e.target.value)}
            className="w-full bg-[#0a0a0a] border border-border rounded px-1 py-1.5 text-sm text-white text-center outline-none focus:border-accent transition-colors no-drag"
            placeholder="0"
          />
        </div>
      ))}
    </div>
  )
}

function ProductCard({ card, onUpdate, onRemove, showRemove }) {
  const [search, setSearch] = useState(card.product_name || '')
  const [results, setResults] = useState([])
  const searchTimer = useRef(null)

  useEffect(() => {
    if (!card.is_new) setSearch(card.product_name || '')
  }, [card.is_new, card.product_id])

  const update = (patch) => onUpdate({ ...card, ...patch })
  const updateNP = (patch) => onUpdate({ ...card, new_product: { ...card.new_product, ...patch } })

  const handleSearchChange = (q) => {
    setSearch(q)
    update({ product_id: null, product_name: q, sizes: [] })
    clearTimeout(searchTimer.current)
    if (q.length < 2) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      try { setResults(await api.products.search(q) || []) } catch {}
    }, 200)
  }

  const selectProduct = async (product) => {
    setSearch(product.name)
    setResults([])
    let sizes = []
    try {
      const full = await api.products.get(product.id)
      if (full?.sizes?.length) {
        sizes = full.sizes.map(s => ({ size: s.size, qty: 0, current_stock: s.stock }))
      }
    } catch {}
    if (!sizes.length) {
      sizes = defaultSizesForCat(product.category || 'Jeans')
    }
    onUpdate({
      ...card,
      product_id: product.id,
      product_name: product.name,
      product_price: Number(product.price) || 0,
      cost: product.cost ? String(product.cost) : '',
      sizes,
    })
  }

  const handleCategoryChange = (cat) => {
    onUpdate({ ...card, new_product: { ...card.new_product, category: cat }, sizes: defaultSizesForCat(cat) })
  }

  const totalQty = card.sizes.reduce((s, sz) => s + (Number(sz.qty) || 0), 0)
  const subtotal = totalQty * (Number(card.cost) || 0)
  const displayName = card.is_new ? card.new_product.name : card.product_name

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface/50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface">
        <button
          onClick={() => {
            const newIsNew = !card.is_new
            onUpdate({ ...card, is_new: newIsNew, product_id: null, product_name: '', sizes: newIsNew ? defaultSizesForCat(card.new_product.category) : [] })
          }}
          title={card.is_new ? 'Buscar producto existente' : 'Crear producto nuevo'}
          className="shrink-0 flex items-center gap-1 text-[10px] no-drag transition-colors"
          style={{ color: card.is_new ? '#00c853' : '#71717a' }}
        >
          {card.is_new ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          {card.is_new ? 'Nuevo' : 'Existente'}
        </button>

        <div className="flex-1 text-sm font-medium text-white truncate">
          {displayName || <span className="text-zinc-600 italic font-normal">{card.is_new ? 'Nuevo producto...' : 'Seleccionar producto...'}</span>}
        </div>

        {totalQty > 0 && (
          <span className="text-xs text-zinc-500 shrink-0 tabular-nums">
            {totalQty} u.{Number(card.cost) > 0 ? ` · $${subtotal.toLocaleString('es-AR')}` : ''}
          </span>
        )}

        <button onClick={() => update({ collapsed: !card.collapsed })} className="p-1 text-zinc-500 hover:text-white no-drag transition-colors">
          {card.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>

        {showRemove && (
          <button onClick={onRemove} className="p-1 text-zinc-600 hover:text-red-400 no-drag transition-colors">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Body */}
      {!card.collapsed && (
        <div className="px-4 pb-4 pt-3 space-y-4 border-t border-border/50">
          {/* Product selector or new product form */}
          {!card.is_new ? (
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input
                className="w-full bg-[#0a0a0a] border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag"
                placeholder="Buscar producto por nombre, código de barras..."
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
              />
              {results.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 bg-card border border-border rounded-lg shadow-xl mt-0.5 max-h-48 overflow-y-auto">
                  {results.map(p => (
                    <button key={p.id} onMouseDown={() => selectProduct(p)}
                      className="w-full px-3 py-2.5 text-left text-sm text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-colors no-drag flex items-center gap-2">
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.brand && <span className="text-zinc-600 text-xs shrink-0">{p.brand}</span>}
                      {p.category && <span className="text-zinc-700 text-[10px] bg-surface px-1.5 py-0.5 rounded shrink-0">{p.category}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Nombre *</label>
                <input
                  className="w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag"
                  placeholder="Nombre del producto"
                  value={card.new_product.name}
                  onChange={e => updateNP({ name: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Marca</label>
                <input className="w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag"
                  placeholder="Ej: Levis" value={card.new_product.brand} onChange={e => updateNP({ brand: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Categoría</label>
                <select className="w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none transition-colors no-drag"
                  value={card.new_product.category} onChange={e => handleCategoryChange(e.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Color</label>
                <input className="w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag"
                  placeholder="Ej: Azul marino" value={card.new_product.color} onChange={e => updateNP({ color: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Precio de venta $</label>
                <input type="number" min="0" step="0.01"
                  className="w-full bg-[#0a0a0a] border border-accent/30 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag"
                  placeholder="0" value={card.new_product.price} onChange={e => updateNP({ price: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">Código de barras</label>
                <input className="w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag"
                  placeholder="Opcional" value={card.new_product.barcode} onChange={e => updateNP({ barcode: e.target.value })} />
              </div>
            </div>
          )}

          {/* Size qty grid */}
          {card.sizes.length > 0 ? (
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2.5">
                Cantidades a ingresar por talle
                {card.sizes.some(s => s.current_stock !== null) && (
                  <span className="ml-1 normal-case text-zinc-700">· stock actual en paréntesis</span>
                )}
              </p>
              <SizeQtyGrid sizes={card.sizes} onChange={sizes => update({ sizes })} />
            </div>
          ) : !card.is_new && !card.product_id ? (
            <p className="text-xs text-zinc-600 italic">Seleccioná un producto para ver la grilla de talles</p>
          ) : null}

          {/* Cost + subtotal */}
          <div className="flex items-center gap-6 pt-1">
            <div className="flex items-center gap-2.5">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0">Costo / unidad $</label>
              <input
                type="number" min="0" step="0.01"
                className="w-28 bg-[#0a0a0a] border border-border rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors no-drag"
                placeholder="0,00"
                value={card.cost}
                onChange={e => update({ cost: e.target.value })}
              />
            </div>
            {totalQty > 0 && Number(card.cost) > 0 && (
              <p className="text-xs text-zinc-500">
                {totalQty} u. × ${Number(card.cost).toLocaleString('es-AR')} = <span className="text-white font-semibold">${subtotal.toLocaleString('es-AR')}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EntryModal({ onClose, onSaved }) {
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState({
    supplier_id: '',
    supplier_name: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
  })
  const [cards, setCards] = useState([{ ...newCard(), collapsed: false }])
  const [saving, setSaving] = useState(false)
  const [savedCards, setSavedCards] = useState(null)
  const [labelOpen, setLabelOpen] = useState(false)
  const [labelProduct, setLabelProduct] = useState(null)

  useEffect(() => {
    api.suppliers.list({ limit: 200 }).then(r => setSuppliers(r.suppliers || [])).catch(() => {})
  }, [])

  const updateCard = (key, updated) => setCards(cs => cs.map(c => c._key === key ? updated : c))
  const addCard = () => setCards(cs => [...cs, newCard()])
  const removeCard = (key) => setCards(cs => cs.filter(c => c._key !== key))

  const totalUnits = cards.reduce((s, c) => s + c.sizes.reduce((ss, sz) => ss + (Number(sz.qty) || 0), 0), 0)
  const totalCost = cards.reduce((s, c) => {
    const qty = c.sizes.reduce((ss, sz) => ss + (Number(sz.qty) || 0), 0)
    return s + qty * (Number(c.cost) || 0)
  }, 0)

  const handleSave = async () => {
    const validCards = cards.filter(c => {
      const hasQty = c.sizes.some(sz => Number(sz.qty) > 0)
      if (c.is_new) return c.new_product.name.trim() && hasQty
      return c.product_id && hasQty
    })
    if (validCards.length === 0) return toast.error('Agregá al menos un producto con cantidad mayor a 0')

    setSaving(true)
    try {
      const items = validCards.map(c => ({
        product_id: c.is_new ? null : c.product_id,
        product_name: c.is_new ? c.new_product.name : c.product_name,
        cost: Number(c.cost) || 0,
        sizes: c.sizes.filter(sz => Number(sz.qty) > 0).map(sz => ({ size: sz.size, qty: Number(sz.qty) })),
        new_product: c.is_new ? {
          name: c.new_product.name.trim(),
          brand: c.new_product.brand,
          category: c.new_product.category,
          color: c.new_product.color,
          price: Number(c.new_product.price) || 0,
          cost: Number(c.cost) || 0,
          barcode: c.new_product.barcode || null,
        } : undefined,
      }))

      const totalUnitsCalc = items.reduce((s, i) => s + i.sizes.reduce((ss, sz) => ss + sz.qty, 0), 0)

      const res = await api.stockentry.create({
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        supplier_name: form.supplier_name,
        date: form.date,
        notes: form.notes,
        total: totalCost,
        items,
      })

      if (res.ok) {
        toast.success(`Ingreso confirmado: ${totalUnitsCalc} unidades de ${validCards.length} producto${validCards.length !== 1 ? 's' : ''}`)
        setSavedCards(validCards)
      } else {
        toast.error(res.error || 'Error al guardar')
      }
    } catch (e) {
      toast.error(e.message || 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 pt-6 overflow-y-auto">
      <div className="bg-card border border-border rounded-xl w-full max-w-4xl mb-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <PackagePlus size={18} className="text-accent" />
            <h2 className="font-semibold text-white">Nuevo ingreso de mercadería</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white no-drag transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Header fields */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Proveedor</label>
              <select className={inputCls + ' no-drag'} value={form.supplier_id}
                onChange={e => {
                  const sup = suppliers.find(s => String(s.id) === e.target.value)
                  setForm(f => ({ ...f, supplier_id: e.target.value, supplier_name: sup?.name || '' }))
                }}>
                <option value="">Sin proveedor</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Fecha</label>
              <input type="date" className={inputCls + ' no-drag'} value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Observaciones</label>
              <input className={inputCls + ' no-drag'} placeholder="Notas opcionales..."
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          {/* Product cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">Productos a ingresar</h3>
              <button onClick={addCard}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 no-drag transition-colors">
                <Plus size={13} /> Agregar producto
              </button>
            </div>

            {cards.map(card => (
              <ProductCard
                key={card._key}
                card={card}
                onUpdate={updated => updateCard(card._key, updated)}
                onRemove={() => removeCard(card._key)}
                showRemove={cards.length > 1}
              />
            ))}
          </div>

          {/* Summary */}
          {totalUnits > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3">Resumen del ingreso</p>
              <div className="space-y-1.5">
                {cards.map(c => {
                  const qty = c.sizes.reduce((s, sz) => s + (Number(sz.qty) || 0), 0)
                  if (qty === 0) return null
                  const sub = qty * (Number(c.cost) || 0)
                  const name = c.is_new ? c.new_product.name : c.product_name
                  return (
                    <div key={c._key} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300 truncate mr-2">{name || <span className="text-zinc-600 italic">Sin nombre</span>}</span>
                      <span className="text-zinc-500 text-xs shrink-0 tabular-nums">
                        {qty} u. × ${Number(c.cost || 0).toLocaleString('es-AR')} ={' '}
                        <span className="text-white font-medium">${sub.toLocaleString('es-AR')}</span>
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                <span className="text-sm text-zinc-400">{totalUnits} unidades totales</span>
                <span className="text-white font-bold text-lg tabular-nums">${totalCost.toLocaleString('es-AR')}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {savedCards ? (
          <div className="px-5 py-4 border-t border-border space-y-3">
            <p className="text-sm font-medium text-accent">¡Ingreso confirmado correctamente!</p>
            <p className="text-xs text-zinc-500">¿Querés imprimir etiquetas de los productos ingresados?</p>
            <div className="flex flex-wrap gap-2">
              {savedCards.map((card, i) => {
                const name = card.is_new ? card.new_product.name : card.product_name
                const totalQty = card.sizes.reduce((s, sz) => s + (Number(sz.qty) || 0), 0)
                return (
                  <button key={i}
                    onClick={async () => {
                      let product = {
                        name,
                        price: card.is_new ? (Number(card.new_product.price) || 0) : (card.product_price || 0),
                        brand: card.is_new ? (card.new_product.brand || '') : '',
                        sizes: card.sizes.filter(sz => Number(sz.qty) > 0).map(sz => ({ size: sz.size, stock: Number(sz.qty) })),
                      }
                      if (!card.is_new && card.product_id) {
                        try { const full = await api.products.get(card.product_id); if (full) product = full } catch {}
                      }
                      setLabelProduct(product)
                      setLabelOpen(true)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/30 bg-accent/5 text-accent text-xs hover:bg-accent/10 transition-colors no-drag">
                    <Tag size={12} />
                    {name}
                    <span className="text-zinc-500 ml-0.5">({totalQty} u.)</span>
                  </button>
                )
              })}
            </div>
            <div className="flex justify-end">
              <button onClick={onSaved} className="btn-primary px-5 py-2 rounded-lg text-sm no-drag">
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-5 py-4 border-t border-border">
            <p className="text-xs text-zinc-600">El stock se actualizará automáticamente al confirmar</p>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-zinc-400 hover:text-white transition-colors no-drag">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving}
                className="btn-primary px-5 py-2 rounded-lg text-sm no-drag flex items-center gap-2 disabled:opacity-60">
                <PackagePlus size={14} />
                {saving ? 'Guardando...' : 'Confirmar ingreso'}
              </button>
            </div>
          </div>
        )}
      </div>

      <LabelPrintModal open={labelOpen} onClose={() => setLabelOpen(false)} product={labelProduct} />
    </div>
  )
}

export default function StockEntry() {
  const [entries, setEntries] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [page, setPage] = useState(1)
  const LIMIT = 30

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.stockentry.list({ page, limit: LIMIT })
      setEntries(res.entries || [])
      setTotalCount(res.total || 0)
    } catch { toast.error('Error al cargar ingresos') }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { load() }, [load])

  const pages = Math.ceil(totalCount / LIMIT)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader
        title="Ingreso de Mercadería"
        subtitle={`${totalCount} ingreso${totalCount !== 1 ? 's' : ''} registrado${totalCount !== 1 ? 's' : ''}`}
        actions={
          <button onClick={() => setModal(true)}
            className="btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm no-drag">
            <PackagePlus size={15} /> Nuevo ingreso
          </button>
        }
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-4 py-3 text-left text-xs text-zinc-500 font-medium">#</th>
              <th className="px-4 py-3 text-left text-xs text-zinc-500 font-medium">Fecha</th>
              <th className="px-4 py-3 text-left text-xs text-zinc-500 font-medium">Proveedor</th>
              <th className="px-4 py-3 text-center text-xs text-zinc-500 font-medium">Productos</th>
              <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">Total</th>
              <th className="px-4 py-3 text-left text-xs text-zinc-500 font-medium">Notas</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-600 text-sm">Cargando...</td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <PackagePlus size={32} className="text-zinc-700" />
                    <p className="text-zinc-500 text-sm">Sin ingresos registrados</p>
                    <p className="text-zinc-700 text-xs">Hacé clic en "Nuevo ingreso" para empezar</p>
                  </div>
                </td>
              </tr>
            ) : entries.map((e, idx) => (
              <tr key={e.id} className={`border-b border-border/50 ${idx % 2 === 1 ? 'bg-white/[0.018]' : ''} hover:bg-accent/[0.035] transition-colors`}>
                <td className="px-4 py-3 text-zinc-600 text-xs">#{e.id}</td>
                <td className="px-4 py-3 text-zinc-300">{e.date}</td>
                <td className="px-4 py-3 text-zinc-300">{e.supplier_name || <span className="text-zinc-600">—</span>}</td>
                <td className="px-4 py-3 text-center text-zinc-400">{e.item_count}</td>
                <td className="px-4 py-3 text-right text-white font-medium tabular-nums">
                  ${Number(e.total).toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs">{e.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-zinc-600">Mostrando {entries.length} de {totalCount}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded-lg border border-border text-zinc-400 hover:text-white disabled:opacity-30 no-drag transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-zinc-400">Pág. {page} de {pages}</span>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="p-1.5 rounded-lg border border-border text-zinc-400 hover:text-white disabled:opacity-30 no-drag transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {modal && <EntryModal onClose={() => setModal(false)} onSaved={() => { setModal(false); load() }} />}
    </motion.div>
  )
}
