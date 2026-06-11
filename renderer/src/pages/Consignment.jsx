import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  PackageCheck, RefreshCw, Plus, Printer, CheckCircle,
  Search, ChevronDown, FileText, Package,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'

const inputCls = 'w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none transition-colors'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

function printLiquidacionPDF(liq, bizName = 'DELPA') {
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const html = `<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><title>Liquidación ${liq.number}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px}
  h1{font-size:18px;font-weight:bold}
  h2{font-size:12px;font-weight:bold;margin:14px 0 6px;padding-bottom:3px;border-bottom:2px solid #333;text-transform:uppercase}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:10px;text-transform:uppercase;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}.total-row td{font-weight:bold;background:#f9f9f9}
  .footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:10px;text-align:center}
  .print-btn{margin-top:16px;padding:8px 20px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px}
  @media print{.print-btn{display:none}@page{size:A4;margin:15mm}}
</style></head>
<body>
<h1>${bizName}</h1>
<h2>Liquidación de Consignación N° ${liq.number}</h2>
<p style="margin:8px 0;color:#555">Proveedor: <strong>${liq.supplier_name}</strong></p>
<p style="margin:4px 0;color:#555">Fecha: ${new Date(liq.created_at).toLocaleDateString('es-AR')}</p>
${liq.notes ? `<p style="margin:4px 0;color:#555">Notas: ${liq.notes}</p>` : ''}

<h2>Detalle de ventas</h2>
<table>
  <thead><tr><th>Producto</th><th>Talle</th><th class="r">Cant.</th><th class="r">Costo unit.</th><th class="r">Total</th><th>Fecha venta</th></tr></thead>
  <tbody>
    ${(liq.items || []).map(item => `<tr>
      <td>${item.product_name}</td>
      <td>${item.size}</td>
      <td class="r">${item.quantity}</td>
      <td class="r">${fmt(item.cost_per_unit)}</td>
      <td class="r">${fmt(item.total_cost)}</td>
      <td>${item.sold_at ? new Date(item.sold_at).toLocaleDateString('es-AR') : '—'}</td>
    </tr>`).join('')}
    <tr class="total-row">
      <td colspan="2">TOTAL</td>
      <td class="r">${liq.total_units}</td>
      <td></td>
      <td class="r">${fmt(liq.total_amount)}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<button class="print-btn" onclick="window.print()">Imprimir</button>
<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body></html>`
  const w = window.open('', '_blank', 'width=900,height=650')
  if (w) { w.document.write(html); w.document.close(); w.focus() }
}

export default function Consignment() {
  const [tab, setTab] = useState('pending')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState([])
  const [liquidations, setLiquidations] = useState([])
  const [consProducts, setConsProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [productSearch, setProductSearch] = useState('')
  const [bizName, setBizName] = useState('DELPA')

  // Liquidation modal
  const [liqModal, setLiqModal] = useState(null) // { supplier_id, supplier_name }
  const [liqSales, setLiqSales] = useState([])
  const [selectedSaleIds, setSelectedSaleIds] = useState([])
  const [liqNotes, setLiqNotes] = useState('')
  const [liqProcessing, setLiqProcessing] = useState(false)

  // Register sale modal
  const [recordModal, setRecordModal] = useState(false)
  const [recordForm, setRecordForm] = useState({ product_id: '', size: '', quantity: 1 })
  const [recordProductSearch, setRecordProductSearch] = useState('')
  const [recordProductResults, setRecordProductResults] = useState([])
  const [selectedRecordProduct, setSelectedRecordProduct] = useState(null)
  const [selectedRecordSize, setSelectedRecordSize] = useState('')
  const [recordCost, setRecordCost] = useState(null)
  const [recordProcessing, setRecordProcessing] = useState(false)

  // Config modal
  const [configModal, setConfigModal] = useState(null) // product
  const [configForm, setConfigForm] = useState({ supplier_id: '', cost_per_unit: '', active: true })
  const [configProcessing, setConfigProcessing] = useState(false)

  // Liquidation detail modal
  const [liqDetailModal, setLiqDetailModal] = useState(null)

  const loadPending = useCallback(async () => {
    setLoading(true)
    try { setPending(await api.consignment.pending()) }
    catch (e) { toast.error('Error al cargar consignaciones') }
    finally { setLoading(false) }
  }, [])

  const loadLiquidations = useCallback(async () => {
    setLoading(true)
    try { setLiquidations(await api.consignment.liquidations.list()) }
    catch (e) { toast.error('Error al cargar liquidaciones') }
    finally { setLoading(false) }
  }, [])

  const loadConsProducts = useCallback(async () => {
    setLoading(true)
    try { setConsProducts(await api.consignment.products.list()) }
    catch (e) { toast.error('Error al cargar productos') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    api.settings.get('business_name').then(v => { if (v) setBizName(v) }).catch(() => {})
    api.suppliers.list({ limit: 200 }).then(r => setSuppliers(r.suppliers || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'pending') loadPending()
    else if (tab === 'liquidations') loadLiquidations()
    else if (tab === 'config') loadConsProducts()
  }, [tab, loadPending, loadLiquidations, loadConsProducts])

  // Search products for config tab
  useEffect(() => {
    if (!productSearch.trim()) { setProducts([]); return }
    const t = setTimeout(async () => {
      try { const r = await api.products.search(productSearch); setProducts(r || []) } catch {}
    }, 300)
    return () => clearTimeout(t)
  }, [productSearch])

  // Search products for record tab
  useEffect(() => {
    if (!recordProductSearch.trim()) { setRecordProductResults([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await api.products.search(recordProductSearch)
        // Only show consignment products
        const cpIds = new Set(consProducts.filter(cp => cp.active).map(cp => cp.product_id))
        setRecordProductResults((r || []).filter(p => cpIds.has(p.id)))
      } catch {}
    }, 300)
    return () => clearTimeout(t)
  }, [recordProductSearch, consProducts])

  const openLiqModal = async (supplier) => {
    setLiqModal(supplier)
    setLiqNotes('')
    try {
      const res = await api.consignment.sales.list({ supplier_id: supplier.supplier_id, liquidated: false, limit: 200 })
      setLiqSales(res.sales || [])
      setSelectedSaleIds((res.sales || []).map(s => s.id))
    } catch (e) { toast.error('Error al cargar ventas') }
  }

  const handleLiquidate = async () => {
    if (selectedSaleIds.length === 0) return toast.error('Seleccioná al menos una venta')
    setLiqProcessing(true)
    try {
      const result = await api.consignment.liquidate({
        supplier_id: liqModal.supplier_id,
        sale_ids: selectedSaleIds,
        notes: liqNotes,
      })
      toast.success(`Liquidación ${result.number} creada — ${formatCurrency(result.total_amount)}`)
      // Auto-print
      const detail = await api.consignment.liquidations.get(result.liquidation_id)
      if (detail) printLiquidacionPDF(detail, bizName)
      setLiqModal(null)
      loadPending()
    } catch (e) { toast.error(e.message) }
    finally { setLiqProcessing(false) }
  }

  const handleRecordSale = async () => {
    if (!selectedRecordProduct) return toast.error('Seleccioná un producto')
    if (!selectedRecordSize) return toast.error('Seleccioná un talle')
    if (!recordForm.quantity || recordForm.quantity < 1) return toast.error('Cantidad inválida')
    setRecordProcessing(true)
    try {
      await api.consignment.sales.record({
        product_id: selectedRecordProduct.id,
        product_name: selectedRecordProduct.name,
        size: selectedRecordSize,
        quantity: Number(recordForm.quantity),
        sold_at: new Date().toISOString(),
      })
      toast.success('Venta de consignación registrada')
      setRecordModal(false)
      setRecordProductSearch('')
      setSelectedRecordProduct(null)
      setSelectedRecordSize('')
      setRecordForm({ product_id: '', size: '', quantity: 1 })
      setRecordCost(null)
      if (tab === 'pending') loadPending()
    } catch (e) { toast.error(e.message) }
    finally { setRecordProcessing(false) }
  }

  const handleConfigSave = async () => {
    if (!configForm.supplier_id) return toast.error('Seleccioná un proveedor')
    if (!configForm.cost_per_unit || Number(configForm.cost_per_unit) < 0) return toast.error('Costo inválido')
    setConfigProcessing(true)
    try {
      await api.consignment.products.set({
        product_id: configModal.id,
        supplier_id: Number(configForm.supplier_id),
        cost_per_unit: Number(configForm.cost_per_unit),
        active: configForm.active,
      })
      toast.success('Configuración guardada')
      setConfigModal(null)
      loadConsProducts()
    } catch (e) { toast.error(e.message) }
    finally { setConfigProcessing(false) }
  }

  const openConfigModal = (product) => {
    const existing = consProducts.find(cp => cp.product_id === product.id)
    setConfigForm({
      supplier_id: existing?.supplier_id || '',
      cost_per_unit: existing?.cost_per_unit || '',
      active: existing ? existing.active === 1 : true,
    })
    setConfigModal(product)
  }

  const tabs = [
    { id: 'pending', label: 'Deudas pendientes' },
    { id: 'record', label: 'Registrar venta' },
    { id: 'liquidations', label: 'Liquidaciones' },
    { id: 'config', label: 'Configurar productos' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6 space-y-5"
    >
      <PageHeader
        title="Consignación"
        subtitle="Gestión de productos en consignación y liquidaciones a proveedores"
        actions={
          tab === 'record' ? (
            <button onClick={() => { setRecordModal(true); loadConsProducts() }}
              className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
              <Plus size={14} /> Registrar venta
            </button>
          ) : null
        }
      />

      <div className="flex border-b border-border">
        {tabs.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            {label}
          </button>
        ))}
      </div>

      {/* TAB: DEUDAS PENDIENTES */}
      {tab === 'pending' && (
        <div className="space-y-3">
          {loading ? (
            <div className="py-8 text-center text-zinc-600">Cargando...</div>
          ) : pending.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle size={40} className="text-green-400 mx-auto mb-3" />
              <p className="text-zinc-300 text-base font-medium">Sin deudas pendientes</p>
              <p className="text-zinc-600 text-sm mt-1">No hay ventas de consignación sin liquidar</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Total adeudado</p>
                  <p className="text-xl font-bold text-white tabular-nums">{formatCurrency(pending.reduce((s, p) => s + (p.total_debt || 0), 0))}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Proveedores</p>
                  <p className="text-xl font-bold text-white">{pending.length}</p>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Unidades vendidas</p>
                  <p className="text-xl font-bold text-white">{pending.reduce((s, p) => s + (p.units || 0), 0)}</p>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                  style={{ gridTemplateColumns: '1fr 100px 100px 120px' }}>
                  <span>Proveedor</span>
                  <span className="text-right">Unidades</span>
                  <span className="text-right">Total</span>
                  <span></span>
                </div>
                <div className="divide-y divide-border">
                  {pending.map(p => (
                    <div key={p.supplier_id} className="grid items-center px-4 py-4 text-sm"
                      style={{ gridTemplateColumns: '1fr 100px 100px 120px' }}>
                      <div>
                        <p className="font-semibold text-white">{p.supplier_name}</p>
                      </div>
                      <span className="text-right text-zinc-300 tabular-nums">{p.units} u.</span>
                      <span className="text-right font-bold text-amber-400 tabular-nums">{formatCurrency(p.total_debt)}</span>
                      <div className="flex justify-end">
                        <button onClick={() => openLiqModal(p)}
                          className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 rounded-lg transition-colors">
                          <FileText size={12} /> Liquidar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB: REGISTRAR VENTA */}
      {tab === 'record' && (
        <div className="py-8 text-center">
          <Package size={40} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Usá el botón "Registrar venta" para registrar una venta de consignación manualmente.</p>
          <p className="text-zinc-600 text-xs mt-2">Los productos deben estar configurados en la pestaña "Configurar productos".</p>
        </div>
      )}

      {/* TAB: LIQUIDACIONES */}
      {tab === 'liquidations' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
            style={{ gridTemplateColumns: '160px 1fr 80px 120px 80px 44px' }}>
            <span>Número</span>
            <span>Proveedor</span>
            <span className="text-right">Unidades</span>
            <span className="text-right">Total</span>
            <span>Fecha</span>
            <span></span>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="py-8 text-center text-zinc-600">Cargando...</div>
            ) : liquidations.length === 0 ? (
              <div className="py-12 text-center text-zinc-600 text-sm">Sin liquidaciones</div>
            ) : liquidations.map(l => (
              <div key={l.id} className="grid items-center px-4 py-3 text-sm"
                style={{ gridTemplateColumns: '160px 1fr 80px 120px 80px 44px' }}>
                <span className="font-mono text-accent text-xs">{l.number}</span>
                <span className="text-zinc-200">{l.supplier_name}</span>
                <span className="text-right text-zinc-400 tabular-nums">{l.total_units}</span>
                <span className="text-right font-semibold text-white tabular-nums">{formatCurrency(l.total_amount)}</span>
                <span className="text-zinc-500 text-xs">{new Date(l.created_at).toLocaleDateString('es-AR')}</span>
                <button onClick={async () => {
                  const detail = await api.consignment.liquidations.get(l.id).catch(() => null)
                  if (detail) setLiqDetailModal(detail)
                }} title="Ver / imprimir"
                  className="no-drag flex items-center justify-center text-zinc-600 hover:text-zinc-300 transition-colors">
                  <Printer size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: CONFIGURAR PRODUCTOS */}
      {tab === 'config' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-accent outline-none"
                placeholder="Buscar producto para configurar..."
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Search results for adding */}
          {products.length > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <p className="text-xs text-zinc-500 uppercase tracking-wider px-4 py-2 border-b border-border">Resultados</p>
              {products.slice(0, 8).map(p => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3 border-b border-border last:border-0 hover:bg-white/[0.02]">
                  <div>
                    <p className="text-sm text-white">{p.name}</p>
                    <p className="text-xs text-zinc-600">{p.color} · {p.category}</p>
                  </div>
                  <button onClick={() => openConfigModal(p)}
                    className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border text-zinc-400 hover:text-white hover:border-zinc-500 rounded-lg transition-colors">
                    <Plus size={12} /> Configurar
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Existing consignment products */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <PackageCheck size={14} className="text-accent" />
              <h3 className="text-sm font-medium text-white">Productos en consignación ({consProducts.length})</h3>
            </div>
            {consProducts.length === 0 ? (
              <div className="py-8 text-center text-zinc-600 text-sm">Buscá y configurá productos arriba</div>
            ) : (
              <div className="divide-y divide-border">
                <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2 bg-surface"
                  style={{ gridTemplateColumns: '1fr 1fr 100px 80px 60px' }}>
                  <span>Producto</span><span>Proveedor</span><span className="text-right">Costo</span><span>Estado</span><span></span>
                </div>
                {consProducts.map(cp => (
                  <div key={cp.id} className="grid items-center px-4 py-3 text-sm"
                    style={{ gridTemplateColumns: '1fr 1fr 100px 80px 60px' }}>
                    <div>
                      <p className="text-white">{cp.product_name}</p>
                      <p className="text-xs text-zinc-600">{cp.color}</p>
                    </div>
                    <span className="text-zinc-400">{cp.supplier_name}</span>
                    <span className="text-right tabular-nums text-zinc-300">{formatCurrency(cp.cost_per_unit)}</span>
                    <span className={cn('text-[11px] px-2 py-0.5 rounded-full border font-medium text-center',
                      cp.active ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-zinc-800 text-zinc-500 border-zinc-700')}>
                      {cp.active ? 'Activo' : 'Inactivo'}
                    </span>
                    <button onClick={async () => {
                      const p = await api.products.get(cp.product_id).catch(() => ({ id: cp.product_id, name: cp.product_name, color: cp.color }))
                      openConfigModal(p)
                    }} className="no-drag text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Editar</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Liquidar */}
      <Modal open={!!liqModal} onClose={() => setLiqModal(null)} title={`Liquidar — ${liqModal?.supplier_name}`} width="max-w-2xl">
        {liqModal && (
          <div className="space-y-4">
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-300">
              Se liquidarán las ventas seleccionadas y se generará un comprobante imprimible.
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              <div className="grid text-[11px] text-zinc-500 uppercase px-3 py-2 border-b border-border bg-surface sticky top-0"
                style={{ gridTemplateColumns: '24px 1fr 60px 80px 100px' }}>
                <span></span><span>Producto / Talle</span><span className="text-right">Cant.</span><span className="text-right">Costo</span><span className="text-right">Total</span>
              </div>
              {liqSales.map(s => (
                <div key={s.id} className="grid items-center px-3 py-2.5 text-sm border-b border-border last:border-0"
                  style={{ gridTemplateColumns: '24px 1fr 60px 80px 100px' }}>
                  <input type="checkbox"
                    checked={selectedSaleIds.includes(s.id)}
                    onChange={e => setSelectedSaleIds(ids =>
                      e.target.checked ? [...ids, s.id] : ids.filter(i => i !== s.id)
                    )}
                    className="w-4 h-4 accent-accent"
                  />
                  <div>
                    <p className="text-zinc-200">{s.product_name}</p>
                    <p className="text-xs text-zinc-600">T.{s.size} · {s.sold_at ? new Date(s.sold_at).toLocaleDateString('es-AR') : ''}</p>
                  </div>
                  <span className="text-right text-zinc-400 tabular-nums">{s.quantity}</span>
                  <span className="text-right text-zinc-400 tabular-nums">{formatCurrency(s.cost_per_unit)}</span>
                  <span className="text-right font-semibold text-white tabular-nums">{formatCurrency(s.total_cost)}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between text-sm font-bold border-t border-border pt-3">
              <span className="text-zinc-300">Total a liquidar ({selectedSaleIds.length} ventas)</span>
              <span className="text-accent text-base tabular-nums">
                {formatCurrency(liqSales.filter(s => selectedSaleIds.includes(s.id)).reduce((sum, s) => sum + s.total_cost, 0))}
              </span>
            </div>

            <div>
              <label className={labelCls}>Notas (opcional)</label>
              <input type="text" className={inputCls} value={liqNotes} onChange={e => setLiqNotes(e.target.value)}
                placeholder="Observaciones de la liquidación" />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <button onClick={() => setLiqModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">
                Cancelar
              </button>
              <button onClick={handleLiquidate} disabled={liqProcessing || selectedSaleIds.length === 0}
                className="btn-primary no-drag flex items-center gap-2 px-5 py-2 text-sm rounded-lg">
                <CheckCircle size={14} /> {liqProcessing ? 'Liquidando...' : 'Confirmar liquidación'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL: Registrar venta */}
      <Modal open={recordModal} onClose={() => setRecordModal(false)} title="Registrar venta de consignación" width="max-w-md">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Producto (consignación activa)</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                className={inputCls + ' pl-9'}
                placeholder="Buscar producto..."
                value={recordProductSearch}
                onChange={e => { setRecordProductSearch(e.target.value); setSelectedRecordProduct(null) }}
              />
            </div>
            {recordProductResults.length > 0 && !selectedRecordProduct && (
              <div className="mt-1 border border-border rounded-lg overflow-hidden">
                {recordProductResults.slice(0, 5).map(p => (
                  <button key={p.id} onClick={() => { setSelectedRecordProduct(p); setRecordProductSearch(p.name); setRecordProductResults([]) }}
                    className="no-drag w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 border-b border-border last:border-0">
                    {p.name} <span className="text-zinc-600">{p.color}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedRecordProduct && (
              <div className="mt-1 text-xs text-green-400 flex items-center gap-1">
                <CheckCircle size={12} /> {selectedRecordProduct.name}
                {(() => {
                  const cp = consProducts.find(c => c.product_id === selectedRecordProduct.id)
                  return cp ? ` — costo: ${formatCurrency(cp.cost_per_unit)} · Prov: ${cp.supplier_name}` : ''
                })()}
              </div>
            )}
          </div>

          {selectedRecordProduct && (
            <div>
              <label className={labelCls}>Talle</label>
              <select className={inputCls} value={selectedRecordSize} onChange={e => setSelectedRecordSize(e.target.value)}>
                <option value="">Seleccioná talle</option>
                {(selectedRecordProduct.sizes || []).map(s => (
                  <option key={s.size} value={s.size}>{s.size} (stock: {s.stock})</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Cantidad</label>
            <input type="number" min="1" className={inputCls}
              value={recordForm.quantity}
              onChange={e => setRecordForm(f => ({ ...f, quantity: e.target.value }))}
            />
          </div>

          {selectedRecordProduct && selectedRecordSize && (() => {
            const cp = consProducts.find(c => c.product_id === selectedRecordProduct.id)
            if (!cp) return null
            const total = cp.cost_per_unit * Number(recordForm.quantity || 1)
            return (
              <div className="bg-accent/5 border border-accent/20 rounded-lg px-4 py-3 text-sm">
                <p className="text-zinc-400">Costo por unidad: <span className="text-white font-semibold">{formatCurrency(cp.cost_per_unit)}</span></p>
                <p className="text-zinc-400">Total a registrar: <span className="text-accent font-bold">{formatCurrency(total)}</span></p>
              </div>
            )
          })()}
        </div>

        <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-border">
          <button onClick={() => setRecordModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleRecordSale} disabled={recordProcessing}
            className="btn-primary no-drag flex items-center gap-2 px-5 py-2 text-sm rounded-lg">
            {recordProcessing ? 'Registrando...' : 'Registrar venta'}
          </button>
        </div>
      </Modal>

      {/* MODAL: Config producto */}
      <Modal open={!!configModal} onClose={() => setConfigModal(null)} title={`Configurar consignación — ${configModal?.name}`} width="max-w-sm">
        {configModal && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Proveedor</label>
              <select className={inputCls} value={configForm.supplier_id} onChange={e => setConfigForm(f => ({ ...f, supplier_id: e.target.value }))}>
                <option value="">Seleccioná proveedor</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Costo por unidad ($)</label>
              <input type="number" min="0" step="0.01" className={inputCls}
                value={configForm.cost_per_unit}
                onChange={e => setConfigForm(f => ({ ...f, cost_per_unit: e.target.value }))}
                placeholder="Costo que se le paga al proveedor"
              />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="cons-active" checked={configForm.active}
                onChange={e => setConfigForm(f => ({ ...f, active: e.target.checked }))}
                className="w-4 h-4 accent-accent" />
              <label htmlFor="cons-active" className="text-sm text-zinc-300">Consignación activa</label>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-5 pt-4 border-t border-border">
          <button onClick={() => setConfigModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleConfigSave} disabled={configProcessing}
            className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">
            {configProcessing ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </Modal>

      {/* MODAL: Liquidation detail */}
      <Modal open={!!liqDetailModal} onClose={() => setLiqDetailModal(null)} title={`Liquidación ${liqDetailModal?.number}`} width="max-w-2xl">
        {liqDetailModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface rounded-lg p-3 border border-border">
                <p className="text-xs text-zinc-500 mb-1">Proveedor</p>
                <p className="text-sm font-semibold text-white">{liqDetailModal.supplier_name}</p>
              </div>
              <div className="bg-surface rounded-lg p-3 border border-border">
                <p className="text-xs text-zinc-500 mb-1">Total</p>
                <p className="text-sm font-bold text-accent tabular-nums">{formatCurrency(liqDetailModal.total_amount)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3 border border-border">
                <p className="text-xs text-zinc-500 mb-1">Unidades</p>
                <p className="text-sm font-semibold text-white">{liqDetailModal.total_units}</p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto">
              <div className="grid text-[11px] text-zinc-500 uppercase px-3 py-2 bg-surface border-b border-border"
                style={{ gridTemplateColumns: '1fr 60px 80px 100px 100px' }}>
                <span>Producto / Talle</span><span className="text-right">Cant.</span><span className="text-right">Costo</span><span className="text-right">Total</span><span>Fecha</span>
              </div>
              {(liqDetailModal.items || []).map((item, i) => (
                <div key={i} className="grid items-center px-3 py-2.5 text-sm border-b border-border last:border-0"
                  style={{ gridTemplateColumns: '1fr 60px 80px 100px 100px' }}>
                  <div>
                    <p className="text-zinc-200">{item.product_name}</p>
                    <p className="text-xs text-zinc-600">T.{item.size}</p>
                  </div>
                  <span className="text-right text-zinc-400 tabular-nums">{item.quantity}</span>
                  <span className="text-right text-zinc-400 tabular-nums">{formatCurrency(item.cost_per_unit)}</span>
                  <span className="text-right font-semibold text-white tabular-nums">{formatCurrency(item.total_cost)}</span>
                  <span className="text-xs text-zinc-500">{item.sold_at ? new Date(item.sold_at).toLocaleDateString('es-AR') : '—'}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <button onClick={() => setLiqDetailModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cerrar</button>
              <button onClick={() => printLiquidacionPDF(liqDetailModal, bizName)}
                className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
                <Printer size={14} /> Imprimir
              </button>
            </div>
          </div>
        )}
      </Modal>
    </motion.div>
  )
}
