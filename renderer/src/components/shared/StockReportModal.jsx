import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import {
  X, Printer, Mail, Search, Package, CheckSquare, Square, Tag, Truck, Layers,
} from 'lucide-react'
import { api } from '@/lib/api'

function useDebounce(value, delay) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

// Toggle simple estilo pill
function Toggle({ checked, onChange, label, hint }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="no-drag w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface/40 hover:bg-white/[0.03] transition-colors text-left">
      <div className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${checked ? 'bg-accent' : 'bg-zinc-700'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-white">{label}</p>
        {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
      </div>
    </button>
  )
}

export default function StockReportModal({ open, onClose, isAdmin }) {
  const [loading, setLoading]     = useState(false)
  const [categories, setCategories] = useState([])
  const [suppliers, setSuppliers]   = useState([])

  // Filtros
  const [selCats, setSelCats]           = useState(new Set())
  const [selSuppliers, setSelSuppliers] = useState(new Set())
  const [selProducts, setSelProducts]   = useState([]) // [{id,name,category}]

  // Autocomplete de productos
  const [prodQuery, setProdQuery] = useState('')
  const [prodResults, setProdResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debQuery = useDebounce(prodQuery, 250)

  // Opciones
  const [onlyWithStock, setOnlyWithStock] = useState(true)
  const [showPrice, setShowPrice] = useState(true)
  const [showCost, setShowCost]   = useState(false)
  const [showValue, setShowValue] = useState(false)
  const [sortBy, setSortBy]       = useState('name')

  const [sending, setSending] = useState(false)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!open) return
    // reset
    setSelCats(new Set()); setSelSuppliers(new Set()); setSelProducts([])
    setProdQuery(''); setProdResults([])
    setOnlyWithStock(true); setShowPrice(true); setShowCost(false); setShowValue(false); setSortBy('name')
    setLoading(true)
    api.stockReport.options()
      .then(res => {
        setCategories(res?.categories || [])
        setSuppliers(res?.suppliers || [])
      })
      .catch(() => toast.error('No se pudieron cargar las opciones'))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!debQuery || debQuery.length < 2) { setProdResults([]); return }
    setSearching(true)
    api.products.search(debQuery)
      .then(rows => setProdResults(rows || []))
      .catch(() => setProdResults([]))
      .finally(() => setSearching(false))
  }, [debQuery])

  if (!open) return null

  const toggleCat = (c) => setSelCats(prev => {
    const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n
  })
  const toggleSupplier = (id) => setSelSuppliers(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const addProduct = (p) => {
    setSelProducts(prev => prev.some(x => x.id === p.id) ? prev : [...prev, { id: p.id, name: p.name, category: p.category }])
    setProdQuery(''); setProdResults([])
  }
  const removeProduct = (id) => setSelProducts(prev => prev.filter(p => p.id !== id))

  const allCatsSelected = categories.length > 0 && selCats.size === categories.length
  const toggleAllCats = () => setSelCats(allCatsSelected ? new Set() : new Set(categories))

  const buildFilters = () => ({
    categories: [...selCats],
    supplierIds: [...selSuppliers],
    productIds: selProducts.map(p => p.id),
    onlyWithStock,
    showPrice,
    showCost: isAdmin && showCost,
    showValue: isAdmin && showValue,
    sortBy,
  })

  const filterSummary = () => {
    const parts = []
    if (selCats.size) parts.push(`Categoría: ${[...selCats].join(', ')}`)
    if (selSuppliers.size) {
      const names = [...selSuppliers].map(id => suppliers.find(s => s.id === id)?.name).filter(Boolean)
      parts.push(`Proveedor: ${names.join(', ')}`)
    }
    if (selProducts.length) parts.push(`Productos seleccionados (${selProducts.length})`)
    return parts.length ? parts.join(' + ') : 'General (todo el stock)'
  }

  const doPrint = async () => {
    setPrinting(true)
    try {
      const res = await api.stockReport.html(buildFilters())
      if (!res?.ok) { toast.error('No se pudo generar el reporte'); return }
      if (!res.count) { toast.warning('No hay stock que coincida con el filtro'); return }
      const w = window.open('', '_blank', 'width=1000,height=750')
      if (!w) { toast.error('El navegador bloqueó la ventana de impresión'); return }
      w.document.write(res.html)
      w.document.close()
      w.onload = () => { w.print(); setTimeout(() => { try { w.close() } catch {} }, 800) }
    } catch (e) {
      toast.error(e.message || 'Error al generar el reporte')
    } finally {
      setPrinting(false)
    }
  }

  const doEmail = async () => {
    setSending(true)
    try {
      const res = await api.stockReport.email(buildFilters())
      if (res?.ok) toast.success(`Reporte enviado por email a ${res.email}`)
      else toast.error(res?.error || 'No se pudo enviar el email')
    } catch (e) {
      toast.error(e.message || 'Error al enviar el email')
    } finally {
      setSending(false)
    }
  }

  const busy = sending || printing

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-accent" />
            <h3 className="font-semibold text-white text-sm">Imprimir stock — filtros flexibles</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white no-drag"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Categorías */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-wider">
                    <Tag size={13} className="text-accent" /> Categorías
                  </div>
                  {categories.length > 0 && (
                    <button onClick={toggleAllCats} className="text-xs text-accent hover:text-accent/80 no-drag">
                      {allCatsSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
                    </button>
                  )}
                </div>
                {categories.length === 0 ? (
                  <p className="text-xs text-zinc-600">Sin categorías</p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {categories.map(c => {
                      const on = selCats.has(c)
                      return (
                        <button key={c} onClick={() => toggleCat(c)}
                          className={`no-drag flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-xs transition-colors ${on ? 'bg-accent/5 border-accent/30 text-white' : 'border-border bg-surface/40 text-zinc-400 hover:bg-white/[0.03]'}`}>
                          {on ? <CheckSquare size={13} className="text-accent shrink-0" /> : <Square size={13} className="text-zinc-600 shrink-0" />}
                          <span className="truncate">{c}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Proveedores */}
              <section>
                <div className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-wider mb-2">
                  <Truck size={13} className="text-accent" /> Proveedores
                </div>
                {suppliers.length === 0 ? (
                  <p className="text-xs text-zinc-600">Sin proveedores</p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {suppliers.map(s => {
                      const on = selSuppliers.has(s.id)
                      return (
                        <button key={s.id} onClick={() => toggleSupplier(s.id)}
                          className={`no-drag flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left text-xs transition-colors ${on ? 'bg-accent/5 border-accent/30 text-white' : 'border-border bg-surface/40 text-zinc-400 hover:bg-white/[0.03]'}`}>
                          {on ? <CheckSquare size={13} className="text-accent shrink-0" /> : <Square size={13} className="text-zinc-600 shrink-0" />}
                          <span className="truncate flex-1">{s.name}</span>
                          <span className="text-[10px] text-zinc-600 shrink-0">{s.product_count}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Productos puntuales */}
              <section>
                <div className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-wider mb-2">
                  <Package size={13} className="text-accent" /> Productos puntuales
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    className="w-full bg-[#0a0a0a] border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-zinc-600 no-drag focus:border-accent outline-none"
                    placeholder="Buscar producto por nombre o código..."
                    value={prodQuery} onChange={e => setProdQuery(e.target.value)}
                  />
                  {(prodResults.length > 0 || searching) && (
                    <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-lg shadow-xl max-h-52 overflow-y-auto">
                      {searching ? (
                        <div className="px-3 py-3 text-xs text-zinc-500">Buscando…</div>
                      ) : (
                        prodResults.map(p => (
                          <button key={p.id} onClick={() => addProduct(p)}
                            className="no-drag w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors border-b border-border/40 last:border-0">
                            <span className="text-sm text-white truncate flex-1">{p.name}</span>
                            {p.color && <span className="text-[11px] text-zinc-500 shrink-0">{p.color}</span>}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {selProducts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {selProducts.map(p => (
                      <span key={p.id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-accent/10 border border-accent/20 text-xs text-white">
                        {p.name}
                        <button onClick={() => removeProduct(p.id)} className="text-zinc-400 hover:text-white no-drag">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* Resumen del filtro */}
              <div className="bg-surface/60 border border-border rounded-lg px-3 py-2 text-xs">
                <span className="text-zinc-500">Filtro aplicado: </span>
                <span className="text-accent font-medium">{filterSummary()}</span>
              </div>

              {/* Opciones */}
              <section>
                <div className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-wider mb-2">
                  <Layers size={13} className="text-accent" /> Opciones del reporte
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Toggle checked={onlyWithStock} onChange={setOnlyWithStock} label="Solo con stock > 0" />
                  <Toggle checked={showPrice} onChange={setShowPrice} label="Mostrar precio de venta" />
                  {isAdmin && <Toggle checked={showCost} onChange={setShowCost} label="Mostrar precio de costo" />}
                  {isAdmin && <Toggle checked={showValue} onChange={setShowValue} label="Mostrar valor del stock" hint="stock × costo" />}
                </div>
                <div className="mt-2">
                  <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Ordenar por</label>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                    className="w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag focus:border-accent outline-none">
                    <option value="name">Nombre</option>
                    <option value="category">Categoría (agrupa + subtotales)</option>
                    <option value="supplier">Proveedor (agrupa + subtotales)</option>
                    <option value="stock">Stock (mayor a menor)</option>
                  </select>
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-border shrink-0 flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 no-drag">
                Cancelar
              </button>
              <div className="flex-1" />
              <button onClick={doEmail} disabled={busy}
                className="no-drag flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-zinc-300 text-sm hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40">
                <Mail size={15} /> {sending ? 'Enviando…' : 'Enviar por email'}
              </button>
              <button onClick={doPrint} disabled={busy}
                className="no-drag flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors disabled:opacity-40">
                <Printer size={15} /> {printing ? 'Generando…' : 'Imprimir'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
