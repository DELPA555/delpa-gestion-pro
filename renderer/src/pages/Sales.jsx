import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Search, Plus, Minus, Trash2, ShoppingCart, User, Printer,
  CheckCircle, X, CreditCard, Banknote, Smartphone, Receipt, ChevronDown,
  AlertTriangle, Wallet, Eye, Gift, ShieldCheck, FileText, Mail, MessageCircle, Store, Download, RefreshCw,
  ArrowLeftRight, RotateCcw, QrCode, Clock, Loader2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime, debounce, cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import Pagination from '@/components/shared/Pagination'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'
import Modal from '@/components/shared/Modal'

const BASE_PAYMENT_METHODS = [
  { id: 'Efectivo',           icon: Banknote,    color: 'text-green-400' },
  { id: 'Transferencia',      icon: CreditCard,  color: 'text-blue-400' },
  { id: 'Mercado Pago',       icon: Smartphone,  color: 'text-indigo-400' },
  { id: 'Mercado Pago QR',    icon: QrCode,      color: 'text-blue-400' },
  { id: 'Tarjeta Crédito',    icon: CreditCard,  color: 'text-amber-400' },
  { id: 'Tarjeta Débito',     icon: CreditCard,  color: 'text-orange-400' },
  { id: 'Cuenta Corriente',   icon: Receipt,     color: 'text-purple-400' },
]

function playBeep(type = 'success') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    if (type === 'error') {
      osc.type = 'square'; osc.frequency.value = 220
      gain.gain.setValueAtTime(0.25, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5)
    } else {
      osc.type = 'sine'; osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2)
    }
  } catch {}
}

const INSTALLMENT_OPTIONS = [1, 3, 6, 12, 18, 24]
const VOUCHER_TYPES_RI = [
  { id: 'ticket',    label: 'Ticket' },
  { id: 'factura_a', label: 'Factura A' },
  { id: 'factura_b', label: 'Factura B' },
]
const VOUCHER_TYPES_MONO = [
  { id: 'ticket',    label: 'Ticket' },
  { id: 'factura_c', label: 'Factura C' },
]

const DEFAULT_SURCHARGES = {
  'Tarjeta Débito': 0,
  'Tarjeta Crédito 1 cuota': 0,
  'Tarjeta Crédito 3 cuotas': 10,
  'Tarjeta Crédito 6 cuotas': 18,
  'Tarjeta Crédito 12 cuotas': 30,
  'Tarjeta Crédito 18 cuotas': 45,
  'Tarjeta Crédito 24 cuotas': 60,
}

function getSurchargeKey(paymentMethod, installments) {
  if (paymentMethod === 'Tarjeta Crédito') return `Tarjeta Crédito ${installments} cuota${installments > 1 ? 's' : ''}`
  return paymentMethod
}

function printTicket(sale, biz = {}, pointsInfo = null) {
  const bizName = biz.business_name || 'DELPA'
  const logoHtml = biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin:0 auto 4px" alt="logo">` : ''
  const saleNum = sale.sale_number || `#${sale.id}`
  const installLine = (sale.installments > 1)
    ? `<div class="row"><span>${sale.installments} cuotas de:</span><span>${formatCurrency(sale.total / sale.installments)} c/u</span></div>`
    : ''
  const tipoLabel = sale.tipo_cbte === 1 ? 'FACTURA A' : sale.tipo_cbte === 6 ? 'FACTURA B' : sale.tipo_cbte === 11 ? 'FACTURA C' : 'TICKET'
  const cbteNum = sale.cae && sale.pto_venta
    ? `${String(sale.pto_venta).padStart(4,'0')}-${String(sale.cbte_nro).padStart(8,'0')}`
    : ''
  const caeFmtVto = sale.cae_fch_vto
    ? String(sale.cae_fch_vto).replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1')
    : ''
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { font-family:monospace; font-size:12px; width:80mm; padding:4mm }
  h1 { font-size:16px; text-align:center; margin-bottom:4px }
  .center { text-align:center }
  .divider { border-top:1px dashed #000; margin:6px 0 }
  .row { display:flex; justify-content:space-between; margin:2px 0 }
  .bold { font-weight:bold }
  .total { font-size:16px }
  .tipo { text-align:center; font-size:13px; font-weight:bold; border:1px solid #000; padding:2px 8px; display:inline-block; margin:2px auto }
  @media print { @page { size:80mm auto; margin:0 } }
</style></head><body>
${logoHtml}<h1>${bizName}</h1>
${biz.business_address ? `<p class="center">${biz.business_address}</p>` : ''}${biz.business_phone ? `<p class="center">Tel: ${biz.business_phone}</p>` : ''}${biz.business_cuit ? `<p class="center">CUIT: ${biz.business_cuit}</p>` : ''}
<p class="center" style="margin:3px 0"><span class="tipo">${tipoLabel}</span></p>
${cbteNum ? `<p class="center" style="font-size:11px">N° ${cbteNum}</p>` : ''}
<div class="divider"></div>
<div class="row"><span>Fecha:</span><span>${formatDateTime(sale.created_at)}</span></div>
<div class="row"><span>Venta N°:</span><span>${saleNum}</span></div>
${sale.client_name ? `<div class="row"><span>Cliente:</span><span>${sale.client_name}</span></div>` : ''}
${sale.seller_name ? `<div class="row"><span>Vendedora:</span><span>${sale.seller_name}</span></div>` : ''}
<div class="divider"></div>
${(sale.items || []).map(it => `
<div class="row"><span>${it.product_name} T.${it.size}</span><span>x${it.quantity}</span></div>
<div class="row" style="padding-left:8px"><span>@ ${formatCurrency(it.unit_price)}</span><span>${formatCurrency(it.unit_price * it.quantity)}</span></div>
`).join('')}
<div class="divider"></div>
${sale.discount > 0 ? `<div class="row"><span>Subtotal:</span><span>${formatCurrency(sale.subtotal)}</span></div>
<div class="row"><span>Descuento:</span><span>-${formatCurrency(sale.discount)}</span></div>` : ''}
${sale.surcharge_rate > 0 ? `<div class="row"><span>Recargo ${sale.surcharge_rate}%:</span><span>+${formatCurrency(sale.total - (sale.subtotal - (sale.discount||0)))}</span></div>` : ''}
<div class="row bold total"><span>TOTAL:</span><span>${formatCurrency(sale.total)}</span></div>
${sale.payments && sale.payments.length > 0
  ? sale.payments.map(p =>
    `<div class="row"><span>${p.payment_method}${p.installments > 1 ? ` (${p.installments}c)` : ''}${p.surcharge_rate > 0 ? ` +${p.surcharge_rate}%` : ''}:</span><span>${formatCurrency(p.final_amount)}</span></div>`
  ).join('')
  : `<div class="row"><span>Medio de pago:</span><span>${sale.payment_method}${sale.installments > 1 ? ` (${sale.installments} cuotas)` : ''}</span></div>
${installLine}`
}
${sale.cae ? `
<div class="divider"></div>
<p class="center bold" style="font-size:10px">COMPROBANTE ELECTRÓNICO AFIP/ARCA</p>
<div class="row"><span>CAE:</span><span style="font-size:10px">${sale.cae}</span></div>
${caeFmtVto ? `<div class="row"><span>Vto. CAE:</span><span>${caeFmtVto}</span></div>` : ''}
` : ''}
${sale.voided ? '<div class="divider"></div><p class="center bold" style="font-size:18px">*** ANULADA ***</p>' : ''}
${pointsInfo && pointsInfo.enabled && sale.client_name ? `
<div class="divider"></div>
<div class="row"><span>Puntos ganados:</span><span class="bold">+${pointsInfo.earned} pts</span></div>
<div class="row"><span>Puntos acumulados:</span><span class="bold">${pointsInfo.total} pts</span></div>
<div class="row" style="font-size:11px"><span>Equivalen a:</span><span>$${(pointsInfo.total * pointsInfo.value).toLocaleString('es-AR')}</span></div>` : ''}
<div class="divider"></div>
<p class="center" style="margin-top:4px">¡Gracias por su compra!</p>
</body></html>`

  const w = window.open('', '_blank', 'width=400,height=600')
  w.document.write(html)
  w.document.close()
  w.onload = () => { w.print(); setTimeout(() => w.close(), 500) }
}

function printChangeTicket(sale, biz = {}) {
  const bizName = biz.business_name || 'DELPA'
  const logoHtml = biz.business_logo ? `<img src="${biz.business_logo}" style="height:40px;object-fit:contain;display:block;margin:0 auto 4px" alt="logo">` : ''
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  body { font-family:monospace; font-size:12px; width:80mm; padding:4mm }
  h1 { font-size:16px; text-align:center; margin-bottom:4px }
  h2 { font-size:13px; text-align:center; margin:4px 0 }
  .center { text-align:center }
  .divider { border-top:1px dashed #000; margin:6px 0 }
  .row { display:flex; justify-content:space-between; margin:2px 0 }
  @media print { @page { size:80mm auto; margin:0 } }
</style></head><body>
${logoHtml}<h1>${bizName}</h1>
<h2>— TICKET DE CAMBIO —</h2>
<div class="divider"></div>
<div class="row"><span>Fecha:</span><span>${formatDateTime(sale.created_at)}</span></div>
${sale.client_name ? `<div class="row"><span>Cliente:</span><span>${sale.client_name}</span></div>` : ''}
<div class="divider"></div>
${(sale.items || []).map(it => `
<div class="row"><span>${it.product_name}</span><span>x${it.quantity}</span></div>
<div class="row" style="padding-left:8px"><span>Talle: ${it.size}</span>${it.color ? `<span>${it.color}</span>` : ''}</div>
`).join('')}
<div class="divider"></div>
<p class="center" style="margin-top:6px;font-size:11px">Conservá este ticket para cambios</p>
</body></html>`

  const w = window.open('', '_blank', 'width=400,height=500')
  w.document.write(html)
  w.document.close()
  w.onload = () => { w.print(); setTimeout(() => w.close(), 500) }
}

export default function Sales() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [cashboxOpen, setCashboxOpen] = useState(null) // null=loading, false=closed, true=open
  const [tab, setTab] = useState('nueva')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [showResults, setShowResults] = useState(false)
  const [cart, setCart] = useState([])
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedSize, setSelectedSize] = useState(null)
  const [qty, setQty] = useState(1)
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPay] = useState('Efectivo')
  const [installments, setInstallments] = useState(1)
  const [voucherType, setVoucherType] = useState('ticket')
  const [seller, setSeller] = useState('')
  const [sellers, setSellers] = useState([])
  const [surcharges, setSurcharges] = useState({})
  const [paymentMethods, setPaymentMethods] = useState(BASE_PAYMENT_METHODS)
  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [completing, setCompleting] = useState(false)
  const [lastSale, setLastSale] = useState(null)
  const [lastSalePoints, setLastSalePoints] = useState(null)
  const [sucursalId, setSucursalId] = useState(null)

  // Split payment
  const [splitPayment, setSplitPayment] = useState(false)
  const [paymentRows, setPaymentRows] = useState([{ method: 'Efectivo', baseAmount: '', installments: 1 }])

  const [history, setHistory] = useState({ sales: [], total: 0, pages: 1 })
  const [hPage, setHPage] = useState(1)
  const [hFrom, setHFrom] = useState('')
  const [hTo, setHTo] = useState('')
  const [hLoading, setHLoading] = useState(false)

  // Tienda Nube orders tab
  const [tnConnected, setTnConnected] = useState(false)
  const [tnOrders, setTnOrders] = useState([])
  const [tnLoading, setTnLoading] = useState(false)
  const [tnImporting, setTnImporting] = useState(null)

  // Detail modal
  const [detailModal, setDetailModal] = useState(null)
  // Void modal
  const [voidModal, setVoidModal] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)

  // Exchange modal
  const [exchangeModal, setExchangeModal] = useState(false)
  const [exchReturnQuery, setExchReturnQuery] = useState('')
  const [exchReturnResults, setExchReturnResults] = useState([])
  const [exchReturnProduct, setExchReturnProduct] = useState(null)
  const [exchReturnSize, setExchReturnSize] = useState(null)
  const [exchNewQuery, setExchNewQuery] = useState('')
  const [exchNewResults, setExchNewResults] = useState([])
  const [exchNewProduct, setExchNewProduct] = useState(null)
  const [exchNewSize, setExchNewSize] = useState(null)
  const [exchClient, setExchClient] = useState(null)
  const [exchClientSearch, setExchClientSearch] = useState('')
  const [exchClientResults, setExchClientResults] = useState([])
  const [exchPayMethod, setExchPayMethod] = useState('Efectivo')
  const [exchNotes, setExchNotes] = useState('')
  const [exchProcessing, setExchProcessing] = useState(false)
  const [exchReturnCustomSize, setExchReturnCustomSize] = useState('')

  // Mercado Pago QR modal
  const [mpModal, setMpModal] = useState(false)
  const [mpOrderId, setMpOrderId] = useState(null)
  const [mpPendingAmount, setMpPendingAmount] = useState(0)
  const [mpTimeLeft, setMpTimeLeft] = useState(300)
  const [mpSuccess, setMpSuccess] = useState(null)
  const [mpError, setMpError] = useState('')
  const mpPollingRef = useRef(null)
  const mpTimerRef = useRef(null)

  // Return modal
  const [returnModal, setReturnModal] = useState(false)
  const [retSaleSearch, setRetSaleSearch] = useState('')
  const [retSaleData, setRetSaleData] = useState(null)
  const [retSaleLoading, setRetSaleLoading] = useState(false)
  const [retSelectedItems, setRetSelectedItems] = useState(new Set())
  const [retReason, setRetReason] = useState('')
  const [retResolution, setRetResolution] = useState('cash')
  const [retProcessing, setRetProcessing] = useState(false)

  const searchRef = useRef()

  const searchProducts = useCallback(debounce(async (q) => {
    if (q.length < 2) { setResults([]); return }
    const res = await api.products.search(q)
    setResults(res)
    setShowResults(true)
  }, 280), [])

  const searchClients = useCallback(debounce(async (q) => {
    if (q.length < 2) { setClientResults([]); return }
    const res = await api.clients.list({ search: q, limit: 6 })
    setClientResults(res.clients || [])
  }, 280), [])

  const searchExchReturnProducts = useCallback(debounce(async (q) => {
    if (q.length < 2) { setExchReturnResults([]); return }
    setExchReturnResults(await api.products.search(q))
  }, 280), [])

  const searchExchNewProducts = useCallback(debounce(async (q) => {
    if (q.length < 2) { setExchNewResults([]); return }
    setExchNewResults(await api.products.search(q))
  }, 280), [])

  const searchExchClients = useCallback(debounce(async (q) => {
    if (q.length < 2) { setExchClientResults([]); return }
    const res = await api.clients.list({ search: q, limit: 6 })
    setExchClientResults(res.clients || [])
  }, 280), [])

  useEffect(() => { searchProducts(query) }, [query, searchProducts])
  useEffect(() => { searchClients(clientSearch) }, [clientSearch, searchClients])
  useEffect(() => { searchExchReturnProducts(exchReturnQuery) }, [exchReturnQuery, searchExchReturnProducts])
  useEffect(() => { searchExchNewProducts(exchNewQuery) }, [exchNewQuery, searchExchNewProducts])
  useEffect(() => { searchExchClients(exchClientSearch) }, [exchClientSearch, searchExchClients])

  const loadHistory = useCallback(async () => {
    setHLoading(true)
    try {
      const res = await api.sales.list({ page: hPage, limit: 25, from: hFrom || undefined, to: hTo || undefined, includeVoided: true })
      setHistory(res)
    } finally { setHLoading(false) }
  }, [hPage, hFrom, hTo])

  useEffect(() => { if (tab === 'historial') loadHistory() }, [tab, loadHistory])

  const loadTnOrders = useCallback(async () => {
    setTnLoading(true)
    try {
      const res = await api.tn.getOrders({ status: 'open' })
      setTnOrders(res.orders || [])
    } catch {}
    finally { setTnLoading(false) }
  }, [])

  useEffect(() => {
    api.tn.status().then(s => setTnConnected(s?.connected || false)).catch(() => {})
    const unsub = window.electron.on('tn:status', s => setTnConnected(s?.connected || false))
    return unsub
  }, [])

  useEffect(() => { if (tab === 'pedidos-web' && tnConnected) loadTnOrders() }, [tab, tnConnected, loadTnOrders])

  const reloadSettings = useCallback((applyAutoSelect = false) => {
    api.sellers.list().then(list => {
      setSellers(list)
      if (applyAutoSelect && user?.username) {
        const match = list.find(s => s.name.toLowerCase() === user.username.toLowerCase())
        const autoName = match ? match.name : (user.role === 'vendedor' ? user.username : '')
        if (autoName) setSeller(autoName)
      }
    }).catch(() => {})

    api.settings.getAll().then(all => {
      try { setSurcharges({ ...DEFAULT_SURCHARGES, ...JSON.parse(all.surcharges_json || '{}') }) } catch {}
      try {
        const custom = JSON.parse(all.custom_payment_methods || '[]')
        const baseIds = new Set(BASE_PAYMENT_METHODS.map(m => m.id))
        const extra = custom.filter(id => id && !baseIds.has(id))
        setPaymentMethods(extra.length > 0
          ? [...BASE_PAYMENT_METHODS, ...extra.map(id => ({ id, icon: CreditCard, color: 'text-zinc-400' }))]
          : BASE_PAYMENT_METHODS)
      } catch {}
      if (all.current_sucursal_id) setSucursalId(Number(all.current_sucursal_id) || null)
    }).catch(() => {})
  }, [user])

  // Auto-complete sale 3 seconds after MP payment detected
  useEffect(() => {
    if (!mpSuccess) return
    const t = setTimeout(() => handleMpPaymentConfirmed(mpSuccess), 3000)
    return () => clearTimeout(t)
  }, [mpSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup MP polling on unmount
  useEffect(() => () => stopMpPolling(), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Check cashbox on mount
  useEffect(() => {
    api.cashbox.current().then(cb => setCashboxOpen(!!cb)).catch(() => setCashboxOpen(false))
    reloadSettings(true)
  }, [user, reloadSettings])

  // Reload sellers whenever any setting is saved (e.g. from Settings page)
  useEffect(() => {
    const unsub = window.electron.on('settings:changed', () => reloadSettings(false))
    return unsub
  }, [reloadSettings])

  // Points redemption
  const [pointsCfg, setPointsCfg] = useState({ enabled: false, perPesos: 1000, value: 100, minRedeem: 5 })
  const [redeemPoints, setRedeemPoints] = useState(false)

  const [biz, setBiz] = useState({})
  const [condFiscal, setCondFiscal] = useState('RI')
  const [facturaModal, setFacturaModal] = useState(false)
  // tipoCbte initialises to 0 — always overwritten by handleFacturar before modal opens
  const [facturaForm, setFacturaForm] = useState({ tipoCbte: 0, docTipo: 99, docNro: '' })
  const [facturaAfipError, setFacturaAfipError] = useState('')
  const [facturando, setFacturando] = useState(false)
  const [facturaSuccess, setFacturaSuccess] = useState(null) // { afip, sale } after CAE ok
  const [postEmailInput, setPostEmailInput] = useState('')
  const [postPhoneInput, setPostPhoneInput] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)

  // Post-INGRESAR (no-CAE) share modal
  const [postSaleModal, setPostSaleModal] = useState(null) // saleData after INGRESAR
  const [postSaleEmail, setPostSaleEmail] = useState('')
  const [postSalePhone, setPostSalePhone] = useState('')
  const [postSaleEmailSending, setPostSaleEmailSending] = useState(false)
  useEffect(() => {
    api.settings.getAll().then(all => {
      setBiz(all)
      setPointsCfg({
        enabled: all.points_enabled === '1',
        perPesos: Number(all.points_per_pesos) || 1000,
        value: Number(all.point_value) || 100,
        minRedeem: Number(all.points_min_redeem) || 5,
      })
    }).catch(() => {})
    api.afip.status().then(s => {
      const cf = s.condFiscal || 'RI'
      setCondFiscal(cf)
      // If current voucherType is not valid for this condFiscal, reset to ticket
      if (cf === 'MONO') setVoucherType(v => (v === 'factura_a' || v === 'factura_b') ? 'ticket' : v)
    }).catch(() => {})
  }, [])

  // ── Barcode scanner ──────────────────────────────────────────────────────────
  const [barcodeEnabled, setBarcodeEnabled] = useState(false)
  const [sizePickModal, setSizePickModal] = useState(null) // { product, sizes }
  const [flashKey, setFlashKey] = useState(null)           // key of row to flash
  const [multiScanConfirm, setMultiScanConfirm] = useState(null) // { key, count, name, sz }
  const [waitlistModal, setWaitlistModal] = useState(null) // { product, size } no-stock case
  const bcBufRef = useRef('')
  const bcLastRef = useRef(0)
  const bcMultiRef = useRef({ code: null, count: 0, ts: 0 })

  useEffect(() => {
    api.settings.get('barcode_scanner').then(v => setBarcodeEnabled(v === '1')).catch(() => {})
    const unsub = window.electron.on('settings:changed', () => {
      api.settings.get('barcode_scanner').then(v => setBarcodeEnabled(v === '1')).catch(() => {})
    })
    return unsub
  }, [])

  const addItemDirect = useCallback((p, sz) => {
    const sizeInfo = (p.sizes || []).find(s => s.size === sz)
    if (!sizeInfo || sizeInfo.stock < 1) { playBeep('error'); toast.error('Stock insuficiente'); return false }
    const key = `${p.id}-${sz}`
    let wasIncrement = false
    setCart(c => {
      const existing = c.find(it => it.key === key)
      if (existing) {
        if (existing.qty + 1 > sizeInfo.stock) return c
        wasIncrement = true
        return c.map(it => it.key === key ? { ...it, qty: it.qty + 1 } : it)
      }
      return [...c, {
        key,
        productId: p.id,
        productName: p.name,
        editedName: p.name,
        size: sz,
        unitPrice: p.price,
        editedPrice: p.price,
        unitCost: p.cost || 0,
        qty: 1,
        maxStock: sizeInfo.stock,
        color: p.color || '',
      }]
    })
    // Flash the row that was updated/added
    setFlashKey(key)
    setTimeout(() => setFlashKey(null), 700)
    playBeep('success')
    if (wasIncrement) {
      toast.success(`${p.name} T.${sz} ×+1`, { duration: 1200 })
    } else {
      toast.success(`${p.name} T.${sz} agregado`)
      setQuery(''); setSelectedProduct(null); setSelectedSize(null); setQty(1)
    }
    return true
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBarcodeInput = useCallback(async (code) => {
    try {
      const result = await api.products.searchByBarcode(code)
      if (!result) {
        playBeep('error')
        toast.error(`Código ${code} no encontrado`)
        return
      }

      let addedSize = null

      if (result.matchedSize) {
        if (result.matchedStock === 0) {
          playBeep('error')
          toast.error(`Sin stock: ${result.name} T.${result.matchedSize}`)
          setWaitlistModal({ product: result, size: result.matchedSize })
          return
        }
        addItemDirect(result, result.matchedSize)
        addedSize = result.matchedSize
      } else {
        const available = (result.sizes || []).filter(s => s.stock > 0)
        if (available.length === 0) {
          playBeep('error')
          toast.error(`Sin stock de ${result.name}`)
          setWaitlistModal({ product: result, size: '' })
          return
        } else if (available.length === 1) {
          addItemDirect(result, available[0].size)
          addedSize = available[0].size
        } else {
          setSizePickModal({ product: result, sizes: available })
          return
        }
      }

      // Multi-scan tracking
      if (addedSize) {
        const m = bcMultiRef.current
        const now = Date.now()
        if (m.code === code && now - m.ts < 3000) {
          m.count++
          m.ts = now
          if (m.count === 3) {
            setMultiScanConfirm({ key: `${result.id}-${addedSize}`, count: m.count, name: result.name, sz: addedSize })
          }
        } else {
          m.code = code; m.count = 1; m.ts = now
        }
      }
    } catch {}
  }, [addItemDirect]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!barcodeEnabled) return
    const onKeyDown = (e) => {
      const tag = e.target.tagName
      if (tag === 'SELECT' || tag === 'TEXTAREA') return
      if (tag === 'INPUT' && e.target !== searchRef.current) return
      const now = Date.now()
      if (now - bcLastRef.current > 250) bcBufRef.current = ''
      bcLastRef.current = now
      if (e.key === 'Enter') {
        const code = bcBufRef.current.trim()
        bcBufRef.current = ''
        if (code.length >= 4) {
          e.preventDefault()
          handleBarcodeInput(code)
        }
        return
      }
      if (e.key.length === 1) bcBufRef.current += e.key
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [barcodeEnabled, handleBarcodeInput])
  // ─────────────────────────────────────────────────────────────────────────────

  const selectProduct = (p) => {
    setSelectedProduct(p)
    setSelectedSize(null)
    setQty(1)
    setQuery(p.name)
    setShowResults(false)
  }

  const addToCart = () => {
    if (!selectedProduct || !selectedSize) return toast.error('Seleccioná un talle')
    const sizeInfo = selectedProduct.sizes?.find(s => s.size === selectedSize)
    const isNA = selectedSize === 'N/A'
    if (!isNA && (!sizeInfo || sizeInfo.stock < qty)) return toast.error('Stock insuficiente')

    const key = `${selectedProduct.id}-${selectedSize}`
    const existing = cart.find(c => c.key === key)
    if (existing) {
      if (!isNA && existing.qty + qty > sizeInfo.stock) return toast.error('Stock insuficiente')
      setCart(c => c.map(it => it.key === key ? { ...it, qty: it.qty + qty } : it))
    } else {
      setCart(c => [...c, {
        key,
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        editedName: selectedProduct.name,
        size: selectedSize,
        unitPrice: selectedProduct.price,
        editedPrice: selectedProduct.price,
        unitCost: selectedProduct.cost || 0,
        qty,
        maxStock: isNA ? 999 : sizeInfo.stock,
        color: selectedProduct.color || '',
      }])
    }
    setQuery(''); setSelectedProduct(null); setSelectedSize(null); setQty(1)
    toast.success(`${selectedProduct.name} T.${selectedSize} agregado`)
  }

  const updateQty = (key, delta) =>
    setCart(c => c.map(it => it.key === key
      ? { ...it, qty: Math.max(1, Math.min(it.maxStock, it.qty + delta)) }
      : it
    ))

  const updateCartField = (key, field, value) =>
    setCart(c => c.map(it => it.key === key ? { ...it, [field]: value } : it))

  const removeItem = (key) => setCart(c => c.filter(it => it.key !== key))

  const surchargeRate = surcharges[getSurchargeKey(paymentMethod, installments)] ?? 0
  const subtotal = cart.reduce((s, it) => s + (Number(it.editedPrice) || 0) * it.qty, 0)
  const discountAmt = Math.min(discount, subtotal)
  const clientPoints = selectedClient?.points ?? 0
  const canRedeem = pointsCfg.enabled && clientPoints >= pointsCfg.minRedeem
  const pointsDiscount = redeemPoints && canRedeem ? Math.min(clientPoints * pointsCfg.value, subtotal - discountAmt) : 0
  const net = subtotal - discountAmt - pointsDiscount
  const surchargeAmt = net * surchargeRate / 100
  const singleTotal = net + surchargeAmt
  const perInstallment = installments > 1 ? singleTotal / installments : 0

  // Split payment computed values
  const splitRows = splitPayment ? paymentRows.map(r => {
    const base = Number(r.baseAmount) || 0
    const rate = surcharges[getSurchargeKey(r.method, r.installments)] ?? 0
    const surAmt = base * rate / 100
    return { ...r, base, rate, surAmt, final: base + surAmt }
  }) : []
  const splitBaseTotal = splitRows.reduce((s, r) => s + r.base, 0)
  const splitFinalTotal = splitRows.reduce((s, r) => s + r.final, 0)
  const splitRemaining = net - splitBaseTotal

  const total = splitPayment ? splitFinalTotal : singleTotal

  const updatePaymentRow = (i, field, value) =>
    setPaymentRows(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r))

  const addPaymentRow = () =>
    setPaymentRows(rows => [...rows, { method: 'Efectivo', baseAmount: '', installments: 1 }])

  const removePaymentRow = (i) =>
    setPaymentRows(rows => rows.filter((_, idx) => idx !== i))

  const enableSplitPayment = () => {
    setPaymentRows([
      { method: paymentMethod, baseAmount: '', installments },
      { method: 'Efectivo', baseAmount: '', installments: 1 },
    ])
    setSplitPayment(true)
  }

  const clearCart = () => {
    setCart([]); setDiscount(0); setSelectedProduct(null); setSelectedSize(null); setQty(1)
    setSelectedClient(null); setClientSearch(''); setQuery('')
    setSplitPayment(false); setPaymentRows([{ method: 'Efectivo', baseAmount: '', installments: 1 }])
    setRedeemPoints(false)
  }

  const completeSale = async (afipData = null, { mpPaymentId = '' } = {}) => {
    if (cart.length === 0) return toast.error('El carrito está vacío')
    if (splitPayment && Math.abs(splitRemaining) > 0.01)
      return toast.error(`Falta asignar ${formatCurrency(Math.abs(splitRemaining))} en medios de pago`)
    setCompleting(true)
    try {
      const paymentsPayload = splitPayment ? splitRows.map(r => ({
        paymentMethod: r.method,
        amount: r.base,
        installments: r.installments || 1,
        surchargeRate: r.rate,
        surchargeAmount: r.surAmt,
        finalAmount: r.final,
      })) : undefined
      const result = await api.sales.create({
        clientId: selectedClient?.id || null,
        items: cart.map(it => ({
          productId: it.productId,
          productName: it.editedName || it.productName,
          size: it.size,
          quantity: it.qty,
          unitPrice: Number(it.editedPrice) || it.unitPrice,
          unitCost: it.unitCost,
        })),
        total,
        subtotal,
        discount: discountAmt,
        pointsRedeemed: redeemPoints && canRedeem ? Math.ceil(pointsDiscount / (pointsCfg.value || 1)) : 0,
        paymentMethod: splitPayment ? 'Múltiple' : paymentMethod,
        notes: '',
        installments: splitPayment ? 1 : installments,
        surchargeRate: splitPayment ? 0 : surchargeRate,
        voucherType,
        sellerName: seller,
        sucursalId,
        cae:         afipData?.cae       || '',
        caeFchVto:   afipData?.caeFchVto || '',
        tipoCbte:    afipData?.tipoComprobante || 0,
        cbteNro:     afipData?.cbteNro   || 0,
        ptoVenta:    afipData?.ptoVenta  || 0,
        docTipo:     afipData?.docTipo   || 99,
        docNro:      afipData?.docNro    || '0',
        payments:    paymentsPayload,
        mpPaymentId: mpPaymentId || '',
      })
      const saleId = typeof result === 'object' ? result.saleId : result
      const saleData = await api.sales.get(saleId)
      setLastSale(saleData)
      // Track points for ticket
      if (pointsCfg.enabled && selectedClient) {
        const earned = Math.floor((saleData?.total || total) / pointsCfg.perPesos)
        const updatedClient = await api.clients.get(selectedClient.id).catch(() => null)
        setLastSalePoints({
          enabled: true,
          earned,
          total: updatedClient?.points ?? (selectedClient.points + earned),
          value: pointsCfg.value,
        })
      } else {
        setLastSalePoints(null)
      }
      clearCart() // also resets splitPayment state
      setPay('Efectivo')
      setInstallments(1)
      const num = saleData?.sale_number || `#${saleId}`
      const caeInfo = afipData?.cae ? ` · CAE: ${afipData.cae.substring(0,8)}...` : ''
      toast.success(`Venta ${num} registrada${caeInfo} — ${formatCurrency(total)}`)
      return saleData
    } catch (e) {
      toast.error(e.message || 'Error al registrar venta')
      return null
    } finally {
      setCompleting(false)
    }
  }

  const closeFacturaModal = () => {
    if (facturando) return
    setFacturaModal(false)
    setFacturaSuccess(null)
    setFacturaAfipError('')
    setPostEmailInput('')
    setPostPhoneInput('')
  }

  const handleFacturar = async () => {
    if (cart.length === 0) return toast.error('El carrito está vacío')
    setFacturaAfipError('')
    setFacturaSuccess(null)
    let cf = condFiscal
    try {
      const status = await api.afip.status()
      cf = status.condFiscal || 'RI'
      setCondFiscal(cf)
    } catch {}
    const tipoCbte = cf === 'MONO' ? 11 : 6
    setFacturaForm({ tipoCbte, docTipo: 99, docNro: '', condFiscalReceptor: 'CF' })
    setFacturaModal(true)
  }

  const confirmFactura = async () => {
    setFacturando(true)
    setFacturaAfipError('')
    // Capture client info before completeSale clears the cart/client
    const clientEmail = selectedClient?.email || ''
    const clientPhone = selectedClient?.phone || ''
    try {
      const res = await api.afip.generarCAE({
        tipoComprobante: facturaForm.tipoCbte,
        docTipo: facturaForm.docTipo,
        docNro: facturaForm.docNro || '0',
        importe: total,
        condFiscalReceptor: facturaForm.condFiscalReceptor || 'CF',
      })
      if (!res.ok) {
        setFacturaAfipError(res.error || 'Error desconocido de AFIP')
        return
      }
      const completedSale = await completeSale(res)
      if (completedSale) {
        setPostEmailInput(clientEmail)
        setPostPhoneInput(clientPhone)
        setFacturaSuccess({ afip: res, sale: completedSale })
      }
    } catch (e) {
      setFacturaAfipError(e.message || 'Error al conectar con AFIP')
    } finally {
      setFacturando(false)
    }
  }

  const continueAsContingencia = async () => {
    closeFacturaModal()
    await completeSale(null)
    toast.warning('Venta registrada sin CAE (contingencia AFIP)')
  }

  const stopMpPolling = () => {
    if (mpPollingRef.current) { clearInterval(mpPollingRef.current); mpPollingRef.current = null }
    if (mpTimerRef.current)   { clearInterval(mpTimerRef.current);   mpTimerRef.current = null }
  }

  const cancelMpModal = () => {
    stopMpPolling()
    setMpModal(false)
    setMpSuccess(null)
    setMpError('')
    setMpTimeLeft(300)
    setMpOrderId(null)
  }

  const startMpPolling = (orderId) => {
    stopMpPolling()
    setMpError('')

    // Countdown — cancels the MP order on timeout
    mpTimerRef.current = setInterval(() => {
      setMpTimeLeft(t => {
        if (t <= 1) {
          stopMpPolling()
          setMpError('Tiempo de espera agotado. La orden fue cancelada.')
          api.mp.cancelOrder({ orderId }).catch(() => {})
          return 0
        }
        return t - 1
      })
    }, 1000)

    // Poll GET /v1/orders/{orderId} every 3 seconds
    mpPollingRef.current = setInterval(async () => {
      try {
        const res = await api.mp.pollOrder({ orderId })
        if (!res.ok) return
        if (res.paid && res.payment) {
          stopMpPolling()
          playBeep()
          setMpSuccess(res.payment)
        } else if (res.expired) {
          stopMpPolling()
          setMpError('La orden expiró. Generá una nueva con el botón Reintentar.')
        } else if (res.canceled) {
          stopMpPolling()
          setMpError('El pago fue cancelado. Podés generar una nueva orden.')
        }
      } catch {}
    }, 3000)
  }

  const handleMpPaymentConfirmed = async (payment) => {
    const clientEmail = selectedClient?.email || ''
    const clientPhone = selectedClient?.phone || ''
    cancelMpModal()
    const saleData = await completeSale(null, { mpPaymentId: String(payment.id) })
    if (saleData) {
      setPostSaleEmail(clientEmail)
      setPostSalePhone(clientPhone)
      setPostSaleModal(saleData)
    }
  }

  const handleIngresar = async () => {
    const clientEmail = selectedClient?.email || ''
    const clientPhone = selectedClient?.phone || ''

    // Intercept MP QR flow
    if (!splitPayment && paymentMethod === 'Mercado Pago QR') {
      if (cart.length === 0) return toast.error('El carrito está vacío')

      // Check POS is configured
      const posConfig = await api.mp.getPos()
      if (!posConfig?.external_id) {
        return toast.error('Configurá el punto de venta de Mercado Pago en Configuración → Mercado Pago')
      }

      // Create order via POST /v1/orders with exact amount
      const orderRes = await api.mp.createOrder({
        amount: total,
        externalReference: `DELPA-${Date.now()}`,
      })
      if (!orderRes?.ok) {
        return toast.error(`Error al crear orden MP: ${orderRes?.error || 'Error desconocido'}`)
      }

      const orderId = orderRes.order_id
      setMpOrderId(orderId)
      setMpPendingAmount(total)
      setMpTimeLeft(300)
      setMpSuccess(null)
      setMpError('')
      setMpModal(true)
      startMpPolling(orderId)
      return
    }

    const saleData = await completeSale(null)
    if (saleData) {
      setPostSaleEmail(clientEmail)
      setPostSalePhone(clientPhone)
      setPostSaleModal(saleData)
    }
  }

  const handleSendTicketEmail = async () => {
    const email = postSaleEmail.trim()
    if (!email || !postSaleModal) return
    setPostSaleEmailSending(true)
    try {
      const res = await api.email.sendTicket({ saleId: postSaleModal.id, toEmail: email })
      if (res.ok) toast.success('Ticket enviado por email')
      else toast.error(res.error || 'Error al enviar email')
    } catch (e) {
      toast.error(e.message || 'Error al enviar email')
    } finally {
      setPostSaleEmailSending(false)
    }
  }

  const handleSendTicketWhatsApp = async () => {
    const phone = postSalePhone.trim()
    if (!phone || !postSaleModal) return
    let digits = phone.replace(/\D/g, '')
    if (!digits.startsWith('549')) {
      if (digits.startsWith('54'))      digits = '549' + digits.slice(2)
      else if (digits.startsWith('0'))  digits = '549' + digits.slice(1)
      else                              digits = '549' + digits
    }
    const bizName = biz.business_name || 'DELPA'
    const clientName = postSaleModal.client_name || 'cliente'
    const msg = `Hola ${clientName}, te enviamos el ticket de tu compra en ${bizName} por ${formatCurrency(postSaleModal.total)}.`
    try {
      const res = await api.email.saveTicketPDF(postSaleModal.id)
      if (res.ok) {
        await api.shell.openPath(res.path)
        toast.info('PDF guardado en Descargas. Adjuntalo en WhatsApp.')
      }
    } catch {}
    api.shell.openExternal(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`)
  }

  const handleSendEmail = async () => {
    const email = postEmailInput.trim()
    if (!email || !facturaSuccess) return
    setSendingEmail(true)
    try {
      const res = await api.email.sendSaleInvoice({ saleId: facturaSuccess.sale.id, toEmail: email })
      if (res.ok) toast.success('Factura enviada por email')
      else toast.error(res.error || 'Error al enviar email')
    } catch (e) {
      toast.error(e.message || 'Error al enviar email')
    } finally {
      setSendingEmail(false)
    }
  }

  const handleSendWhatsApp = () => {
    const phone = postPhoneInput.trim()
    if (!phone || !facturaSuccess) return
    let digits = phone.replace(/\D/g, '')
    if (!digits.startsWith('549')) {
      if (digits.startsWith('54')) digits = '549' + digits.slice(2)
      else if (digits.startsWith('0')) digits = '549' + digits.slice(1)
      else digits = '549' + digits
    }
    const { afip, sale } = facturaSuccess
    const tipoLabel = afip.tipoComprobante === 11 ? 'Factura C' : afip.tipoComprobante === 6 ? 'Factura B' : 'Factura A'
    const cbteNum = `${String(afip.ptoVenta).padStart(4,'0')}-${String(afip.cbteNro).padStart(8,'0')}`
    const bizName = biz.business_name || 'DELPA'
    const clientName = sale.client_name || 'cliente'
    const msg = `Hola ${clientName}, te enviamos tu ${tipoLabel} N° ${cbteNum} de ${bizName} por ${formatCurrency(sale.total)}. CAE: ${afip.cae}`
    api.shell.openExternal(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`)
  }

  const importTnOrder = async (tnOrderId) => {
    setTnImporting(tnOrderId)
    try {
      const res = await api.tn.importOrder(tnOrderId)
      if (res.ok) {
        toast.success(`Pedido #${tnOrderId} importado · stock descontado`)
        if (res.notFound?.length) {
          toast.warning(`Stock no descontado para: ${res.notFound.join(', ')} — producto no encontrado en DELPA`, { duration: 6000 })
        }
        loadTnOrders()
      } else toast.error(res.error || 'Error al importar')
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setTnImporting(null) }
  }

  const openVoidModal = (s) => {
    const saleDate = new Date(s.created_at).toDateString()
    const today = new Date().toDateString()
    if (saleDate !== today) {
      toast.error('Solo se pueden anular ventas del día actual')
      return
    }
    setVoidModal(s)
    setVoidReason('')
  }

  const confirmVoid = async () => {
    if (!voidReason.trim()) return toast.error('El motivo de anulación es obligatorio')
    setVoiding(true)
    try {
      await api.sales.void(voidModal.id, voidReason)
      toast.success('Venta anulada y stock restaurado')
      setVoidModal(null)
      loadHistory()
    } catch (e) { toast.error(e.message) }
    finally { setVoiding(false) }
  }

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        if (e.key === 'Escape') { e.target.blur(); setSelectedProduct(null); setShowResults(false) }
        return
      }
      if (e.key === 'F4') { e.preventDefault(); if (tab === 'nueva') completeSale() }
      if (e.key === 'F10') { e.preventDefault(); clearCart() }
      if (e.key === 'F12') { e.preventDefault(); setTab('nueva'); setTimeout(() => searchRef.current?.focus(), 50) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tab, cart, paymentMethod, installments, discount, selectedClient, voucherType, seller])

  const openExchangeModal = () => {
    setExchReturnQuery(''); setExchReturnResults([]); setExchReturnProduct(null); setExchReturnSize(null)
    setExchReturnCustomSize('')
    setExchNewQuery(''); setExchNewResults([]); setExchNewProduct(null); setExchNewSize(null)
    setExchClient(null); setExchClientSearch(''); setExchClientResults([])
    setExchPayMethod('Efectivo'); setExchNotes(''); setExchProcessing(false)
    setExchangeModal(true)
  }

  const confirmExchange = async () => {
    const actualReturnSize = exchReturnCustomSize.trim() || exchReturnSize
    if (!exchReturnProduct || !actualReturnSize) return toast.error('Seleccioná el producto devuelto y talle')
    if (!exchNewProduct || !exchNewSize) return toast.error('Seleccioná el nuevo producto y talle')
    setExchProcessing(true)
    try {
      const diff = exchNewProduct.price - exchReturnProduct.price
      await api.exchanges.create({
        returnedProductId:   exchReturnProduct.id,
        returnedProductName: exchReturnProduct.name,
        returnedSize:        actualReturnSize,
        returnedQty:         1,
        returnedPrice:       Number(exchReturnProduct.price) || 0,
        newProductId:        exchNewProduct.id,
        newProductName:      exchNewProduct.name,
        newSize:             exchNewSize,
        newQty:              1,
        newPrice:            Number(exchNewProduct.price) || 0,
        clientId:            exchClient?.id || null,
        clientName:          exchClient?.name || '',
        resolution:          diff < 0 ? 'credit' : 'paid',
        paymentMethod:       diff > 0 ? exchPayMethod : 'N/A',
        notes:               exchNotes,
        sellerName:          seller || '',
      })
      toast.success('Cambio registrado correctamente')
      printChangeTicket({
        created_at: new Date().toISOString(),
        client_name: exchClient?.name || '',
        items: [{ product_name: exchNewProduct.name, size: exchNewSize, quantity: 1, color: exchNewProduct.color || '' }],
      }, biz)
      setExchangeModal(false)
    } catch (e) { toast.error(e.message || 'Error al registrar cambio') }
    finally { setExchProcessing(false) }
  }

  const openReturnModal = () => {
    setRetSaleSearch(''); setRetSaleData(null); setRetSelectedItems(new Set())
    setRetReason(''); setRetResolution('cash'); setRetProcessing(false); setRetSaleLoading(false)
    setReturnModal(true)
  }

  const searchReturnSale = async () => {
    const q = retSaleSearch.trim()
    if (!q) return
    setRetSaleLoading(true)
    try {
      const numMatch = q.match(/\d+/)
      if (!numMatch) { toast.error('Ingresá el número de venta'); return }
      const sale = await api.sales.get(Number(numMatch[0]))
      if (!sale) { toast.error('Venta no encontrada'); return }
      if (sale.voided) { toast.error('La venta está anulada'); return }
      setRetSaleData(sale)
      setRetSelectedItems(new Set())
    } catch { toast.error('Venta no encontrada') }
    finally { setRetSaleLoading(false) }
  }

  const toggleRetItem = (idx) =>
    setRetSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })

  const confirmReturn = async () => {
    if (!retSaleData) return toast.error('Buscá una venta primero')
    if (retSelectedItems.size === 0) return toast.error('Seleccioná al menos un producto')
    if (!retReason.trim()) return toast.error('El motivo es obligatorio')
    setRetProcessing(true)
    try {
      const items = [...retSelectedItems].map(i => {
        const it = retSaleData.items[i]
        return { productId: it.product_id, size: it.size, quantity: it.quantity, unitPrice: it.unit_price }
      })
      await api.returns.create({
        saleId: retSaleData.id,
        clientId: retSaleData.client_id || null,
        items,
        reason: retReason,
        resolution: retResolution,
      })
      toast.success('Devolución registrada')
      setReturnModal(false)
    } catch (e) { toast.error(e.message || 'Error al registrar devolución') }
    finally { setRetProcessing(false) }
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block'

  // Loading cashbox check
  if (cashboxOpen === null) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Cashbox guard
  if (!cashboxOpen) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-card border border-amber-500/30 rounded-2xl p-8 max-w-md w-full text-center space-y-5"
        >
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto">
            <Wallet size={28} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white mb-2">Caja no abierta</h2>
            <p className="text-sm text-zinc-400">Debés abrir la caja antes de registrar ventas. Las ventas sin caja no quedan registradas correctamente.</p>
          </div>
          <button
            onClick={() => navigate('/caja')}
            className="btn-primary no-drag w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2"
          >
            <Wallet size={16} /> Ir a Caja → Abrir
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-border px-6 pt-4 shrink-0">
        {[
          { id: 'nueva', label: 'Nueva venta' },
          { id: 'historial', label: 'Historial' },
          ...(tnConnected ? [{ id: 'pedidos-web', label: 'Pedidos web', icon: Store }] : []),
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            {Icon && <Icon size={13} />}
            {label}
          </button>
        ))}
      </div>

      {tab === 'nueva' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* LEFT: Cart */}
          <div className="flex flex-col w-[58%] border-r border-border overflow-hidden">
            <div className="p-4 space-y-3 border-b border-border shrink-0">
              {/* Product search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="F12 · Buscar producto por nombre o código de barras..."
                  className={`${inputCls} pl-8`}
                  onFocus={() => results.length > 0 && setShowResults(true)}
                  onBlur={() => setTimeout(() => setShowResults(false), 150)}
                  autoFocus
                />
                <AnimatePresence>
                  {showResults && results.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl overflow-hidden z-20 shadow-2xl"
                    >
                      {results.map(p => (
                        <button key={p.id} onMouseDown={() => selectProduct(p)}
                          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 text-left transition-colors">
                          <div>
                            <p className="text-sm text-white">{p.name}</p>
                            <p className="text-xs text-zinc-500">{p.brand} {p.color && `· ${p.color}`}</p>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <p className="text-sm font-medium text-white">{formatCurrency(p.price)}</p>
                            <p className="text-xs text-zinc-500">{p.sizes?.reduce((s, x) => s + x.stock, 0)} ud.</p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Size & qty selector */}
              {selectedProduct && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-[#0a0a0a] border border-accent/20 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white truncate">{selectedProduct.name}</p>
                    <p className="text-sm font-bold text-accent shrink-0 ml-2">{formatCurrency(selectedProduct.price)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProduct.sizes?.map(s => (
                      <button key={s.size} onClick={() => setSelectedSize(s.size)}
                        disabled={s.stock === 0}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors',
                          s.stock === 0 ? 'border-border text-zinc-700 cursor-not-allowed' :
                          selectedSize === s.size ? 'border-accent bg-accent/10 text-accent' :
                          'border-border text-zinc-300 hover:border-zinc-500'
                        )}>
                        {s.size} <span className="text-zinc-500">({s.stock})</span>
                      </button>
                    ))}
                    {/* N/A option for products without a size concept */}
                    <button onClick={() => setSelectedSize('N/A')}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs border transition-colors',
                        selectedSize === 'N/A' ? 'border-zinc-400 bg-zinc-700/40 text-zinc-200' :
                        'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-400'
                      )}>
                      N/A
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 border border-border rounded-lg">
                      <button onClick={() => setQty(q => Math.max(1, q - 1))}
                        className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-white"><Minus size={13} /></button>
                      <span className="w-8 text-center text-sm text-white">{qty}</span>
                      <button onClick={() => {
                        const max = selectedProduct.sizes?.find(s => s.size === selectedSize)?.stock || 99
                        setQty(q => Math.min(max, q + 1))
                      }} className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-white">
                        <Plus size={13} />
                      </button>
                    </div>
                    <button onClick={addToCart}
                      className="btn-primary no-drag flex-1 text-sm py-1.5 rounded-lg flex items-center justify-center gap-1.5">
                      <Plus size={14} /> Agregar al carrito
                    </button>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Cart items */}
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-700">
                  <ShoppingCart size={36} className="mb-3 opacity-40" />
                  <p className="text-sm">Carrito vacío</p>
                </div>
              ) : (
                cart.map(it => (
                  <div key={it.key}
                    className={cn('px-4 py-2.5 space-y-1.5 transition-colors duration-300',
                      flashKey === it.key ? 'bg-accent/10 ring-1 ring-accent/30 rounded-lg' : 'hover:bg-white/[0.02]'
                    )}>
                    <div className="flex items-center gap-2">
                      {/* Editable product name */}
                      <input
                        value={it.editedName}
                        onChange={e => updateCartField(it.key, 'editedName', e.target.value)}
                        className="flex-1 min-w-0 bg-transparent text-sm text-white font-medium border-0 border-b border-transparent focus:border-zinc-600 outline-none px-0 py-0.5 no-drag"
                        title="Editar nombre para esta venta"
                      />
                      <span className="text-xs text-zinc-500 shrink-0">
                        T.{it.size}{it.color ? ` · ${it.color}` : ''}
                      </span>
                      <button onClick={() => removeItem(it.key)}
                        className="text-zinc-600 hover:text-red-400 transition-colors p-1 shrink-0">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Editable price */}
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-600 text-xs">$</span>
                        <input
                          type="number" min="0" step="0.01"
                          value={it.editedPrice}
                          onChange={e => updateCartField(it.key, 'editedPrice', e.target.value)}
                          className="w-24 bg-[#111] border border-border rounded px-2 py-0.5 text-xs text-white no-drag focus:border-accent outline-none"
                          title="Editar precio para esta venta"
                        />
                      </div>
                      {/* Qty controls */}
                      <div className="flex items-center gap-1 border border-border rounded-lg ml-auto">
                        <button onClick={() => updateQty(it.key, -1)}
                          className="w-7 h-6 flex items-center justify-center text-zinc-500 hover:text-white"><Minus size={11} /></button>
                        <span className="w-7 text-center text-sm text-white">{it.qty}</span>
                        <button onClick={() => updateQty(it.key, 1)}
                          className="w-7 h-6 flex items-center justify-center text-zinc-500 hover:text-white"><Plus size={11} /></button>
                      </div>
                      <span className="w-20 text-right text-sm font-medium text-white tabular-nums shrink-0">
                        {formatCurrency((Number(it.editedPrice) || 0) * it.qty)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* RIGHT: Checkout */}
          <div className="flex flex-col w-[42%] overflow-y-auto p-4 space-y-4">
            {/* Client */}
            <div className="relative">
              <label className={labelCls}>Cliente (opcional)</label>
              {selectedClient ? (
                <div>
                  <div className="flex items-center justify-between bg-[#0a0a0a] border border-border rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-zinc-500" />
                      <span className="text-sm text-white">{selectedClient.name}</span>
                      {selectedClient.balance > 0 && (
                        <span className="text-xs text-amber-400">Debe {formatCurrency(selectedClient.balance)}</span>
                      )}
                    </div>
                    <button onClick={() => { setSelectedClient(null); setClientSearch(''); setRedeemPoints(false) }}>
                      <X size={14} className="text-zinc-600 hover:text-white" />
                    </button>
                  </div>
                  {canRedeem && (
                    <button
                      onClick={() => setRedeemPoints(v => !v)}
                      className={cn(
                        'no-drag mt-1.5 w-full flex items-center justify-between px-3 py-1.5 rounded-lg border text-xs transition-colors',
                        redeemPoints
                          ? 'border-accent/40 bg-accent/10 text-accent'
                          : 'border-border text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <Gift size={12} />
                        Canjear {clientPoints} puntos = {formatCurrency(clientPoints * pointsCfg.value)} descuento
                      </span>
                      <span className={cn('w-4 h-4 rounded-full border flex items-center justify-center shrink-0', redeemPoints ? 'border-accent bg-accent' : 'border-zinc-600')}>
                        {redeemPoints && <span className="w-2 h-2 rounded-full bg-black" />}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                    placeholder="Buscar cliente..." className={inputCls}
                    onBlur={() => setTimeout(() => setClientResults([]), 150)} />
                  <AnimatePresence>
                    {clientResults.length > 0 && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl overflow-hidden z-20 shadow-xl">
                        {clientResults.map(c => (
                          <button key={c.id} onMouseDown={() => { setSelectedClient(c); setClientSearch(''); setClientResults([]) }}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 text-left">
                            <span className="text-sm text-white">{c.name}</span>
                            <span className="text-xs text-zinc-500">{c.phone}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>

            {/* Payment method */}
            {!splitPayment ? (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className={labelCls}>Medio de pago</label>
                    <button onClick={enableSplitPayment}
                      className="text-xs text-zinc-500 hover:text-accent transition-colors no-drag">
                      Dividir →
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {paymentMethods.map(({ id, icon: Icon, color }) => (
                      <button key={id} onClick={() => { setPay(id); setInstallments(1) }}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs border transition-colors',
                          paymentMethod === id
                            ? 'border-accent bg-accent/10 text-white'
                            : 'border-border text-zinc-500 hover:text-zinc-200 hover:border-zinc-600'
                        )}>
                        <Icon size={13} className={paymentMethod === id ? 'text-accent' : color} />
                        {id}
                      </button>
                    ))}
                  </div>
                </div>
                {paymentMethod === 'Tarjeta Crédito' && (
                  <div>
                    <label className={labelCls}>Cuotas</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {INSTALLMENT_OPTIONS.map(n => (
                        <button key={n} onClick={() => setInstallments(n)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs border transition-colors',
                            installments === n ? 'border-accent bg-accent/10 text-white' : 'border-border text-zinc-500 hover:text-zinc-200'
                          )}>
                          {n === 1 ? '1 cuota' : `${n} cuotas`}
                          {surcharges[getSurchargeKey('Tarjeta Crédito', n)] > 0 &&
                            <span className="ml-1 text-zinc-500">+{surcharges[getSurchargeKey('Tarjeta Crédito', n)]}%</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Split payment mode */
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls}>Medios de pago</label>
                  <button onClick={() => setSplitPayment(false)}
                    className="text-xs text-zinc-500 hover:text-white transition-colors no-drag">
                    ← Un solo medio
                  </button>
                </div>
                <div className="space-y-1.5">
                  {paymentRows.map((row, i) => {
                    const rowRate = surcharges[getSurchargeKey(row.method, row.installments)] ?? 0
                    const rowBase = Number(row.baseAmount) || 0
                    const rowFinal = rowBase * (1 + rowRate / 100)
                    return (
                      <div key={i} className="flex items-center gap-1">
                        <select value={row.method}
                          onChange={e => updatePaymentRow(i, 'method', e.target.value)}
                          className="flex-1 bg-[#0a0a0a] border border-border rounded-lg px-2 py-1.5 text-xs text-white no-drag">
                          {paymentMethods.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                        </select>
                        <input type="number" min="0" step="0.01"
                          value={row.baseAmount}
                          onChange={e => updatePaymentRow(i, 'baseAmount', e.target.value)}
                          placeholder="0"
                          className="w-20 bg-[#0a0a0a] border border-border rounded-lg px-2 py-1.5 text-xs text-white no-drag text-right"
                        />
                        {row.method === 'Tarjeta Crédito' && (
                          <select value={row.installments}
                            onChange={e => updatePaymentRow(i, 'installments', Number(e.target.value))}
                            className="w-12 bg-[#0a0a0a] border border-border rounded-lg px-1 py-1.5 text-xs text-white no-drag">
                            {INSTALLMENT_OPTIONS.map(n => <option key={n} value={n}>{n}c</option>)}
                          </select>
                        )}
                        {rowRate > 0 && rowBase > 0 && (
                          <span className="text-xs text-amber-400 shrink-0 w-14 text-right tabular-nums">{formatCurrency(rowFinal)}</span>
                        )}
                        {paymentRows.length > 1 && (
                          <button onClick={() => removePaymentRow(i)}
                            className="text-zinc-600 hover:text-red-400 p-0.5 shrink-0 no-drag">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button onClick={addPaymentRow}
                  className="no-drag w-full text-xs text-zinc-600 hover:text-zinc-400 border border-dashed border-border/60 rounded-lg py-1.5 mt-1.5 transition-colors">
                  + Agregar método
                </button>
                {net > 0 && Math.abs(splitRemaining) > 0.01 && (
                  <p className={cn('text-xs text-right mt-1', splitRemaining > 0 ? 'text-amber-400' : 'text-red-400')}>
                    {splitRemaining > 0 ? `Falta: ${formatCurrency(splitRemaining)}` : `Excede: ${formatCurrency(-splitRemaining)}`}
                  </p>
                )}
              </div>
            )}

            {/* Voucher + Seller */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Comprobante</label>
                <select value={voucherType} onChange={e => setVoucherType(e.target.value)}
                  className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag">
                  {(condFiscal === 'MONO' ? VOUCHER_TYPES_MONO : VOUCHER_TYPES_RI).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Vendedora</label>
                {sellers.length > 0 ? (
                  <select value={seller} onChange={e => setSeller(e.target.value)}
                    className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag">
                    <option value="">Sin asignar</option>
                    {sellers.map(s => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={seller}
                    onChange={e => setSeller(e.target.value)}
                    placeholder="Nombre de vendedora"
                    className={inputCls}
                  />
                )}
              </div>
            </div>

            {/* Discount */}
            <div>
              <label className={labelCls}>Descuento $</label>
              <input type="number" min="0" step="0.01" value={discount}
                onChange={e => setDiscount(Math.max(0, Number(e.target.value)))}
                placeholder="0,00" className={inputCls} />
            </div>

            {/* Totals */}
            <div className="bg-[#0a0a0a] border border-border rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Subtotal</span>
                <span className="text-white tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmt > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Descuento</span>
                  <span className="text-red-400 tabular-nums">-{formatCurrency(discountAmt)}</span>
                </div>
              )}
              {pointsDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-accent flex items-center gap-1"><Gift size={11} /> Puntos canjeados</span>
                  <span className="text-accent tabular-nums">-{formatCurrency(pointsDiscount)}</span>
                </div>
              )}
              {!splitPayment && surchargeRate > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Recargo {surchargeRate}%</span>
                  <span className="text-amber-400 tabular-nums">+{formatCurrency(surchargeAmt)}</span>
                </div>
              )}
              {splitPayment && splitRows.length > 0 && (
                <div className="border-t border-border/50 pt-2 space-y-1">
                  {splitRows.map((r, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-zinc-400">{r.method}{r.installments > 1 ? ` ${r.installments}c` : ''}</span>
                      <div className="flex items-center gap-2">
                        {r.rate > 0 && r.base > 0 && <span className="text-amber-400">+{r.rate}%</span>}
                        <span className="text-white tabular-nums">{formatCurrency(r.final)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between font-bold">
                <span className="text-white">TOTAL</span>
                <span className={cn('text-xl tabular-nums', splitPayment && Math.abs(splitRemaining) > 0.01 ? 'text-red-400' : 'text-accent')}>
                  {formatCurrency(total)}
                </span>
              </div>
              {!splitPayment && installments > 1 && singleTotal > 0 && (
                <div className="text-xs text-amber-400 text-right">
                  {installments} cuotas de {formatCurrency(perInstallment)} c/u
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={handleFacturar}
                  disabled={cart.length === 0 || completing || facturando}
                  className="no-drag flex-1 disabled:opacity-40 disabled:cursor-not-allowed font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg transition-all"
                >
                  <ShieldCheck size={16} />
                  FACTURAR
                </button>
                <button
                  onClick={handleIngresar}
                  disabled={cart.length === 0 || completing || facturando}
                  className="btn-primary no-drag flex-1 disabled:opacity-40 disabled:cursor-not-allowed font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm"
                >
                  <CheckCircle size={16} />
                  {completing ? 'Procesando...' : 'INGRESAR'}
                </button>
                <button onClick={clearCart} title="F10 — Limpiar"
                  className="no-drag px-3 py-3 border border-border rounded-xl text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors text-xs">
                  F10
                </button>
              </div>
              <p className="text-center text-xs text-zinc-600">
                <span className="text-violet-400 font-medium">FACTURAR</span> = CAE AFIP · <span className="text-accent font-medium">INGRESAR</span> = ticket sin CAE · Total: <span className="text-white font-bold tabular-nums">{formatCurrency(total)}</span>
              </p>
            </div>

            {lastSale && (
              <div className="flex gap-2">
                <button onClick={() => printTicket(lastSale, biz, lastSalePoints)}
                  className="flex-1 border border-border hover:border-zinc-600 text-zinc-400 hover:text-white py-2 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
                  <Printer size={14} /> Ticket
                </button>
                <button onClick={() => printChangeTicket(lastSale, biz)}
                  className="flex-1 border border-border hover:border-zinc-600 text-zinc-400 hover:text-white py-2 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
                  <Gift size={14} /> Ticket cambio
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={openExchangeModal}
                className="flex-1 border border-dashed border-border hover:border-zinc-600 text-zinc-500 hover:text-zinc-300 py-2 rounded-xl transition-colors flex items-center justify-center gap-1.5 text-xs">
                <ArrowLeftRight size={12} /> Cambio
              </button>
              <button onClick={openReturnModal}
                className="flex-1 border border-dashed border-border hover:border-zinc-600 text-zinc-500 hover:text-zinc-300 py-2 rounded-xl transition-colors flex items-center justify-center gap-1.5 text-xs">
                <RotateCcw size={12} /> Devolución
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* HISTORIAL */
        <div className="flex-1 overflow-hidden flex flex-col p-6">
          <div className="flex gap-3 mb-4 shrink-0">
            <input type="date" value={hFrom} onChange={e => { setHFrom(e.target.value); setHPage(1) }}
              className="input-field bg-card border border-border rounded-lg px-3 py-2 text-sm text-white no-drag" />
            <input type="date" value={hTo} onChange={e => { setHTo(e.target.value); setHPage(1) }}
              className="input-field bg-card border border-border rounded-lg px-3 py-2 text-sm text-white no-drag" />
            {(hFrom || hTo) && (
              <button onClick={() => { setHFrom(''); setHTo(''); setHPage(1) }}
                className="text-xs text-zinc-500 hover:text-white px-2">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden flex-1 flex flex-col">
            {(() => {
              const hasSellers = sellers.length > 0
              const cols = hasSellers ? '90px 1fr 1fr 0.9fr 0.75fr 50px 0.9fr auto' : '90px 1fr 1fr 1fr 50px 1fr auto'
              const skeletonCols = hasSellers ? 8 : 7
              return (
                <>
                  <div className="grid text-[11px] text-zinc-500 uppercase tracking-wider px-4 py-2.5 border-b border-border bg-surface shrink-0"
                    style={{ gridTemplateColumns: cols }}>
                    <span>N° Venta</span><span>Fecha</span><span>Cliente</span>
                    <span>Método</span>
                    {hasSellers && <span>Vendedora</span>}
                    <span>Tipo</span><span className="text-right">Total</span><span />
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-border">
                    {hLoading ? (
                      <SkeletonTable rows={6} cols={skeletonCols} />
                    ) : history.sales.length === 0 ? (
                      <EmptyState icon={ShoppingCart} title="Sin ventas en el período" />
                    ) : (
                      history.sales.map(s => (
                        <div key={s.id}
                          className={cn('row-alt grid items-center px-4 py-3 text-sm cursor-pointer', s.voided && 'opacity-40')}
                          style={{ gridTemplateColumns: cols }}
                          onClick={() => api.sales.get(s.id).then(setDetailModal)}>
                          <span className="text-zinc-400 font-mono text-xs">{s.sale_number || `#${s.id}`}</span>
                          <span className="text-zinc-400 text-xs">{formatDateTime(s.created_at)}</span>
                          <span className="text-zinc-300 truncate">{s.client_name || '—'}</span>
                          <span className="text-xs text-zinc-400 truncate">
                            {s.payment_method}{s.installments > 1 ? ` ${s.installments}c` : ''}
                          </span>
                          {hasSellers && (
                            <span className="text-xs text-zinc-400 truncate">{s.seller_name || '—'}</span>
                          )}
                          <span className="flex items-center gap-1">
                            {s.cae
                              ? <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/15 border border-violet-500/30 text-violet-400 rounded font-mono">FAC</span>
                              : <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700/40 border border-zinc-600/30 text-zinc-500 rounded font-mono">TKT</span>
                            }
                            {s.mp_payment_id && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded font-mono" title={`MP ID: ${s.mp_payment_id}`}>MP</span>
                            )}
                          </span>
                          <span className={cn('text-right font-medium tabular-nums', s.voided ? 'line-through text-zinc-600' : 'text-white')}>
                            {formatCurrency(s.total)}
                          </span>
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <button onClick={() => api.sales.get(s.id).then(data => data && printTicket(data, biz))}
                              className="p-1.5 text-zinc-600 hover:text-zinc-300 rounded">
                              <Printer size={13} />
                            </button>
                            {!s.voided && (
                              <button onClick={() => openVoidModal(s)}
                                className="p-1.5 text-zinc-600 hover:text-red-400 rounded" title="Anular">
                                <X size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )
            })()}
            <Pagination page={hPage} pages={history.pages} total={history.total} limit={25} onChange={setHPage} />
          </div>
        </div>
      )}

      {/* Pedidos web (Tienda Nube) */}
      {tab === 'pedidos-web' && (
        <div className="flex-1 overflow-hidden flex flex-col p-6">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <p className="text-sm text-zinc-400">Pedidos abiertos en Tienda Nube — importalos como pedidos locales</p>
            <button onClick={loadTnOrders} disabled={tnLoading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg text-zinc-400 hover:text-white transition-colors">
              <RefreshCw size={13} className={tnLoading ? 'animate-spin' : ''} /> Actualizar
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-card border border-border rounded-xl divide-y divide-border">
            {tnLoading ? (
              <div className="flex items-center justify-center py-16 text-zinc-600 text-sm">Cargando pedidos...</div>
            ) : tnOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                <Store size={32} className="mb-3 opacity-40" />
                <p className="text-sm">Sin pedidos abiertos en Tienda Nube</p>
              </div>
            ) : tnOrders.map(order => (
              <div key={order.id} className="row-alt flex items-center px-4 py-3 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">Pedido #{order.number}</span>
                    <span className="text-xs text-zinc-500">{order.customer?.name} {order.customer?.surname}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {(order.products || []).map(p => `${p.name} ×${p.quantity}`).join(', ').substring(0, 80)}
                  </div>
                </div>
                <span className="text-sm font-bold text-white tabular-nums shrink-0">
                  ${Number(order.total || 0).toLocaleString('es-AR')}
                </span>
                <button
                  onClick={() => importTnOrder(order.id)}
                  disabled={tnImporting === order.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 border border-accent/30 rounded-lg text-accent hover:bg-accent/20 transition-colors disabled:opacity-50 shrink-0">
                  <Download size={12} />
                  {tnImporting === order.id ? 'Importando...' : 'Importar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Detalle de venta */}
      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title={`Venta ${detailModal?.sale_number || `#${detailModal?.id}`}`} width="max-w-lg">
        {detailModal && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-zinc-400">
              <div className="flex justify-between"><span>Fecha:</span><span className="text-white">{formatDateTime(detailModal.created_at)}</span></div>
              <div className="flex justify-between"><span>Cliente:</span><span className="text-white">{detailModal.client_name || '—'}</span></div>
              <div className="flex justify-between"><span>Pago:</span><span className="text-white">{detailModal.payment_method}{detailModal.installments > 1 ? ` · ${detailModal.installments} cuotas` : ''}</span></div>
              {detailModal.seller_name && <div className="flex justify-between"><span>Vendedora:</span><span className="text-white">{detailModal.seller_name}</span></div>}
              {detailModal.surcharge_rate > 0 && <div className="flex justify-between"><span>Recargo:</span><span className="text-amber-400">{detailModal.surcharge_rate}%</span></div>}
            </div>
            <div className="border-t border-border pt-3 space-y-1">
              <div className="grid text-[11px] text-zinc-500 uppercase pb-1" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                <span>Producto</span><span className="text-center">Talle</span><span className="text-center">Cant.</span><span className="text-right">Precio</span>
              </div>
              {detailModal.items?.map((it, i) => (
                <div key={i} className="grid text-sm py-1.5 border-t border-border/50" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                  <span className="text-zinc-200">{it.product_name}</span>
                  <span className="text-center text-zinc-400">{it.size}</span>
                  <span className="text-center text-zinc-400">×{it.quantity}</span>
                  <span className="text-right text-white tabular-nums">{formatCurrency(it.unit_price * it.quantity)}</span>
                </div>
              ))}
            </div>
            {detailModal.discount > 0 && (
              <div className="flex justify-between text-sm border-t border-border pt-2">
                <span className="text-zinc-400">Descuento</span>
                <span className="text-red-400 tabular-nums">-{formatCurrency(detailModal.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border pt-2">
              <span className="text-white">TOTAL</span>
              <span className={cn('text-accent tabular-nums', detailModal.voided && 'line-through text-zinc-500')}>{formatCurrency(detailModal.total)}</span>
            </div>
            {detailModal.installments > 1 && (
              <p className="text-xs text-amber-400 text-right">{detailModal.installments} cuotas de {formatCurrency(detailModal.total / detailModal.installments)} c/u</p>
            )}
            {detailModal.cae && (
              <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl text-xs space-y-1">
                <p className="text-violet-400 font-bold flex items-center gap-1.5"><ShieldCheck size={12} /> Comprobante Electrónico AFIP/ARCA</p>
                <div className="text-zinc-400 space-y-0.5">
                  <div className="flex justify-between"><span>Tipo:</span><span className="text-zinc-200">{detailModal.tipo_cbte === 1 ? 'Factura A' : detailModal.tipo_cbte === 6 ? 'Factura B' : 'Factura C'}</span></div>
                  <div className="flex justify-between"><span>N° Comprobante:</span><span className="text-zinc-200 font-mono">{String(detailModal.pto_venta||0).padStart(4,'0')}-{String(detailModal.cbte_nro||0).padStart(8,'0')}</span></div>
                  <div className="flex justify-between"><span>CAE:</span><span className="text-zinc-200 font-mono">{detailModal.cae}</span></div>
                  {detailModal.cae_fch_vto && <div className="flex justify-between"><span>Vto. CAE:</span><span className="text-zinc-200">{String(detailModal.cae_fch_vto).replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1')}</span></div>}
                </div>
              </div>
            )}
            {detailModal.voided && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
                <p className="font-bold">ANULADA</p>
                {detailModal.void_reason && <p className="mt-1">{detailModal.void_reason}</p>}
              </div>
            )}
            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => { printTicket(detailModal, biz); setDetailModal(null) }}
                className="flex-1 border border-border rounded-lg py-2 text-sm text-zinc-400 hover:text-white flex items-center justify-center gap-2">
                <Printer size={13} /> Ticket
              </button>
              <button onClick={() => { printChangeTicket(detailModal, biz); setDetailModal(null) }}
                className="flex-1 border border-border rounded-lg py-2 text-sm text-zinc-400 hover:text-white flex items-center justify-center gap-2">
                <Gift size={13} /> Sin precio
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Facturar con AFIP */}
      <Modal open={facturaModal} onClose={closeFacturaModal} title={facturaSuccess ? 'Comprobante generado' : 'Generar comprobante AFIP/ARCA'} width="max-w-sm">
        {facturaSuccess ? (
          /* ── SUCCESS PANEL ── */
          <div className="space-y-4">
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-center">
              <CheckCircle size={32} className="text-green-400 mx-auto mb-2" />
              <p className="text-green-300 font-bold text-sm">¡Comprobante generado exitosamente!</p>
              <p className="text-zinc-400 text-xs mt-1">
                {facturaSuccess.afip.tipoComprobante === 11 ? 'Factura C' : facturaSuccess.afip.tipoComprobante === 6 ? 'Factura B' : 'Factura A'}
                {' '}N° {String(facturaSuccess.afip.ptoVenta).padStart(4,'0')}-{String(facturaSuccess.afip.cbteNro).padStart(8,'0')}
              </p>
              <p className="font-mono text-xs text-zinc-300 mt-1 break-all">CAE: {facturaSuccess.afip.cae}</p>
            </div>

            <button onClick={() => printTicket(facturaSuccess.sale, biz)}
              className="w-full flex items-center justify-center gap-2 border border-border rounded-lg py-2.5 text-sm text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
              <Printer size={15} /> Imprimir ticket
            </button>

            <div className="space-y-2">
              <input
                type="email"
                placeholder={facturaSuccess.sale.client_name ? `Email de ${facturaSuccess.sale.client_name}` : 'Email del cliente'}
                value={postEmailInput}
                onChange={e => setPostEmailInput(e.target.value)}
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
              />
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail || !postEmailInput.trim()}
                className="w-full flex items-center justify-center gap-2 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 rounded-lg py-2.5 text-sm text-blue-300 disabled:opacity-40 transition-colors">
                <Mail size={15} /> {sendingEmail ? 'Enviando...' : 'Enviar por Email'}
              </button>
            </div>

            <div className="space-y-2">
              <input
                type="tel"
                placeholder="Teléfono WhatsApp (ej: 1155443322)"
                value={postPhoneInput}
                onChange={e => setPostPhoneInput(e.target.value)}
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
              />
              <button
                onClick={handleSendWhatsApp}
                disabled={!postPhoneInput.trim()}
                className="w-full flex items-center justify-center gap-2 bg-green-600/15 hover:bg-green-600/25 border border-green-500/30 rounded-lg py-2.5 text-sm text-green-300 disabled:opacity-40 transition-colors">
                <MessageCircle size={15} /> Enviar por WhatsApp
              </button>
            </div>

            <button onClick={closeFacturaModal}
              className="w-full py-2 text-sm text-zinc-600 hover:text-zinc-400 transition-colors">
              Cerrar
            </button>
          </div>
        ) : (
          /* ── FORM PANEL ── */
          <>
            <div className="space-y-4">
              <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl text-sm">
                <p className="text-violet-300 font-medium flex items-center gap-2"><ShieldCheck size={14} /> Total a facturar: <span className="text-white font-bold tabular-nums">{formatCurrency(total)}</span></p>
              </div>

              {/* Tipo comprobante */}
              <div>
                <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Tipo de comprobante</label>
                {condFiscal === 'MONO' ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-violet-500/10 border border-violet-500/30 rounded-lg">
                    <ShieldCheck size={16} className="text-violet-400 shrink-0" />
                    <div>
                      <p className="text-sm text-white font-medium">Factura C — código 11</p>
                      <p className="text-xs text-zinc-500 mt-0.5">Único tipo habilitado para Monotributistas</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFacturaForm(f => ({ ...f, tipoCbte: 6, docTipo: 99, docNro: '', condFiscalReceptor: 'CF' }))}
                      className={cn('flex-1 py-2 rounded-lg text-sm border transition-colors text-center', facturaForm.tipoCbte === 6 ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-border text-zinc-400 hover:text-white')}
                    >
                      Factura B<br /><span className="text-xs opacity-60">CF / DNI / CUIT</span>
                    </button>
                    <button
                      onClick={() => setFacturaForm(f => ({ ...f, tipoCbte: 1, docTipo: 80, docNro: '', condFiscalReceptor: 'RI' }))}
                      className={cn('flex-1 py-2 rounded-lg text-sm border transition-colors text-center', facturaForm.tipoCbte === 1 ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-border text-zinc-400 hover:text-white')}
                    >
                      Factura A<br /><span className="text-xs opacity-60">Resp. Inscripto</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Documento receptor — Factura A: CUIT obligatorio */}
              {facturaForm.tipoCbte === 1 && (
                <div>
                  <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">CUIT del receptor *</label>
                  <input
                    className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
                    placeholder="CUIT sin guiones (ej: 20123456789)"
                    value={facturaForm.docNro}
                    onChange={e => setFacturaForm(f => ({ ...f, docNro: e.target.value }))}
                  />
                </div>
              )}

              {/* Documento receptor — Factura B o C: CF / DNI / CUIT opcional */}
              {(facturaForm.tipoCbte === 6 || facturaForm.tipoCbte === 11) && (
                <div>
                  <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Documento receptor (opcional)</label>
                  <select
                    className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag mb-2"
                    value={facturaForm.docTipo}
                    onChange={e => setFacturaForm(f => ({ ...f, docTipo: Number(e.target.value), docNro: '', condFiscalReceptor: Number(e.target.value) === 80 ? 'RI' : 'CF' }))}
                  >
                    <option value={99}>Consumidor Final (sin datos)</option>
                    <option value={96}>DNI</option>
                    <option value={80}>CUIT</option>
                  </select>
                  {facturaForm.docTipo !== 99 && (
                    <input
                      className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
                      placeholder={facturaForm.docTipo === 96 ? 'Número de DNI' : 'CUIT sin guiones'}
                      value={facturaForm.docNro}
                      onChange={e => setFacturaForm(f => ({ ...f, docNro: e.target.value }))}
                    />
                  )}
                  {/* Condición fiscal del receptor cuando hay CUIT */}
                  {facturaForm.docTipo === 80 && (
                    <select
                      className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag mt-2"
                      value={facturaForm.condFiscalReceptor}
                      onChange={e => setFacturaForm(f => ({ ...f, condFiscalReceptor: e.target.value }))}
                    >
                      <option value="RI">Responsable Inscripto</option>
                      <option value="MONO">Monotributista</option>
                      <option value="EX">IVA Exento</option>
                    </select>
                  )}
                </div>
              )}

              {/* AFIP error */}
              {facturaAfipError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 space-y-2">
                  <p className="font-medium mb-1">Error AFIP:</p>
                  {facturaAfipError.split('\n').map((line, i) => (
                    <p key={i} className="font-mono leading-relaxed">{line}</p>
                  ))}
                  <button
                    onClick={continueAsContingencia}
                    className="text-amber-400 hover:text-amber-300 underline pt-1 block"
                  >
                    Continuar sin CAE (contingencia)
                  </button>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
              <button onClick={closeFacturaModal} disabled={facturando} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
              <button
                onClick={confirmFactura}
                disabled={facturando || (facturaForm.tipoCbte === 1 && !facturaForm.docNro.trim())}
                className="no-drag px-5 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium flex items-center gap-2"
              >
                <ShieldCheck size={14} className={facturando ? 'animate-pulse' : ''} />
                {facturando ? 'Comunicando con AFIP...' : 'Generar comprobante'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Modal: Post-INGRESAR — enviar ticket */}
      <Modal open={!!postSaleModal} onClose={() => setPostSaleModal(null)} title="Venta registrada" width="max-w-sm">
        {postSaleModal && (
          <div className="space-y-4">
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-center">
              <CheckCircle size={28} className="text-green-400 mx-auto mb-2" />
              <p className="text-green-300 font-bold text-sm">
                {postSaleModal.sale_number || `#${postSaleModal.id}`} — {formatCurrency(postSaleModal.total)}
              </p>
              <p className="text-zinc-500 text-xs mt-1">Ticket sin CAE registrado</p>
            </div>

            <button onClick={() => { printTicket(postSaleModal, biz); setPostSaleModal(null) }}
              className="w-full flex items-center justify-center gap-2 border border-border rounded-lg py-2.5 text-sm text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
              <Printer size={15} /> Imprimir ticket
            </button>

            <div className="space-y-2">
              <input
                type="email"
                placeholder="Email del cliente"
                value={postSaleEmail}
                onChange={e => setPostSaleEmail(e.target.value)}
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
              />
              <button
                onClick={handleSendTicketEmail}
                disabled={postSaleEmailSending || !postSaleEmail.trim()}
                className="w-full flex items-center justify-center gap-2 bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 rounded-lg py-2.5 text-sm text-blue-300 disabled:opacity-40 transition-colors">
                <Mail size={15} /> {postSaleEmailSending ? 'Enviando...' : 'Enviar por Email'}
              </button>
            </div>

            <div className="space-y-2">
              <input
                type="tel"
                placeholder="Teléfono WhatsApp (ej: 1155443322)"
                value={postSalePhone}
                onChange={e => setPostSalePhone(e.target.value)}
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
              />
              <button
                onClick={handleSendTicketWhatsApp}
                disabled={!postSalePhone.trim()}
                className="w-full flex items-center justify-center gap-2 bg-green-600/15 hover:bg-green-600/25 border border-green-500/30 rounded-lg py-2.5 text-sm text-green-300 disabled:opacity-40 transition-colors">
                <MessageCircle size={15} /> Enviar por WhatsApp (+ PDF)
              </button>
            </div>

            <button onClick={() => setPostSaleModal(null)}
              className="w-full py-2 text-sm text-zinc-600 hover:text-zinc-400 transition-colors">
              Cerrar
            </button>
          </div>
        )}
      </Modal>

      {/* Modal: Cambio de producto */}
      <Modal open={exchangeModal} onClose={() => setExchangeModal(false)} title="Registrar cambio" width="max-w-lg">
        <div className="space-y-4">
          {/* Client (optional) */}
          <div className="relative">
            <label className={labelCls}>Cliente (opcional)</label>
            {exchClient ? (
              <div className="flex items-center justify-between bg-[#0a0a0a] border border-border rounded-lg px-3 py-2">
                <span className="text-sm text-white">{exchClient.name}</span>
                <button onClick={() => { setExchClient(null); setExchClientSearch('') }}><X size={13} className="text-zinc-600 hover:text-white" /></button>
              </div>
            ) : (
              <>
                <input value={exchClientSearch} onChange={e => setExchClientSearch(e.target.value)}
                  placeholder="Buscar cliente..." className={inputCls}
                  onBlur={() => setTimeout(() => setExchClientResults([]), 150)} />
                <AnimatePresence>
                  {exchClientResults.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl overflow-hidden z-30 shadow-xl">
                      {exchClientResults.map(c => (
                        <button key={c.id} onMouseDown={() => { setExchClient(c); setExchClientSearch(''); setExchClientResults([]) }}
                          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 text-left">
                          <span className="text-sm text-white">{c.name}</span>
                          <span className="text-xs text-zinc-500">{c.phone}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Returned product */}
            <div className="space-y-2">
              <label className={labelCls}>Producto devuelto</label>
              <div className="relative">
                <input value={exchReturnQuery} onChange={e => { setExchReturnQuery(e.target.value); setExchReturnProduct(null); setExchReturnSize(null) }}
                  placeholder="Buscar o escanear..." className={inputCls}
                  onBlur={() => setTimeout(() => setExchReturnResults([]), 150)}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const code = exchReturnQuery.trim()
                    if (code.length < 4) return
                    try {
                      const result = await api.products.searchByBarcode(code)
                      if (result) {
                        setExchReturnProduct(result)
                        setExchReturnQuery(result.name)
                        setExchReturnResults([])
                        setExchReturnSize(result.matchedSize || null)
                        setExchReturnCustomSize('')
                        playBeep('success')
                      } else {
                        playBeep('error')
                        toast.error('Código no encontrado')
                      }
                    } catch { playBeep('error') }
                  }} />
                <AnimatePresence>
                  {exchReturnResults.length > 0 && !exchReturnProduct && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl overflow-hidden z-30 shadow-xl">
                      {exchReturnResults.map(p => (
                        <button key={p.id} onMouseDown={async () => {
                          setExchReturnProduct(p); setExchReturnQuery(p.name); setExchReturnResults([]); setExchReturnSize(null); setExchReturnCustomSize('')
                          try { const full = await api.products.get(p.id); if (full) setExchReturnProduct(full) } catch {}
                        }}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 text-left">
                          <span className="text-xs text-white">{p.name}</span>
                          <span className="text-xs text-zinc-500">{formatCurrency(p.price)}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {exchReturnProduct && (
                <div className="space-y-1.5">
                  <p className="text-xs text-accent font-medium">{formatCurrency(exchReturnProduct.price)}</p>
                  <div className="flex flex-wrap gap-1">
                    {exchReturnProduct.sizes?.map(s => (
                      <button key={s.size} onClick={() => { setExchReturnSize(s.size); setExchReturnCustomSize('') }}
                        className={cn('px-2 py-0.5 rounded text-xs border transition-colors',
                          exchReturnSize === s.size && !exchReturnCustomSize ? 'border-accent bg-accent/10 text-accent' : 'border-border text-zinc-400 hover:border-zinc-500')}>
                        {s.size} <span className="text-zinc-600">({s.stock})</span>
                      </button>
                    ))}
                  </div>
                  <input
                    value={exchReturnCustomSize}
                    onChange={e => { setExchReturnCustomSize(e.target.value); setExchReturnSize(null) }}
                    placeholder="Otro talle (ej: 39)..."
                    className="w-full px-2 py-1 text-xs rounded-lg bg-zinc-900 border border-border text-white placeholder-zinc-600 focus:outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>

            {/* New product */}
            <div className="space-y-2">
              <label className={labelCls}>Producto nuevo</label>
              <div className="relative">
                <input value={exchNewQuery} onChange={e => { setExchNewQuery(e.target.value); setExchNewProduct(null); setExchNewSize(null) }}
                  placeholder="Buscar o escanear..." className={inputCls}
                  onBlur={() => setTimeout(() => setExchNewResults([]), 150)}
                  onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const code = exchNewQuery.trim()
                    if (code.length < 4) return
                    try {
                      const result = await api.products.searchByBarcode(code)
                      if (result) {
                        if (result.matchedSize && result.matchedStock === 0) {
                          playBeep('error')
                          toast.error(`Sin stock: ${result.name} T.${result.matchedSize}`)
                          return
                        }
                        setExchNewProduct(result)
                        setExchNewQuery(result.name)
                        setExchNewResults([])
                        setExchNewSize(result.matchedSize || null)
                        playBeep('success')
                      } else {
                        playBeep('error')
                        toast.error('Código no encontrado')
                      }
                    } catch { playBeep('error') }
                  }} />
                <AnimatePresence>
                  {exchNewResults.length > 0 && !exchNewProduct && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl overflow-hidden z-30 shadow-xl">
                      {exchNewResults.map(p => (
                        <button key={p.id} onMouseDown={() => { setExchNewProduct(p); setExchNewQuery(p.name); setExchNewResults([]); setExchNewSize(null) }}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 text-left">
                          <span className="text-xs text-white">{p.name}</span>
                          <span className="text-xs text-zinc-500">{formatCurrency(p.price)}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {exchNewProduct && (
                <div className="space-y-1.5">
                  <p className="text-xs text-accent font-medium">{formatCurrency(exchNewProduct.price)}</p>
                  {(() => {
                    const available = (exchNewProduct.sizes || []).filter(s => s.stock > 0)
                    return available.length === 0
                      ? <p className="text-xs text-red-400 italic">Sin stock disponible en ningún talle</p>
                      : (
                        <div className="flex flex-wrap gap-1">
                          {available.map(s => (
                            <button key={s.size} onClick={() => setExchNewSize(s.size)}
                              className={cn('px-2 py-0.5 rounded text-xs border transition-colors',
                                exchNewSize === s.size ? 'border-accent bg-accent/10 text-accent' : 'border-border text-zinc-400 hover:border-zinc-500')}>
                              {s.size} <span className="text-zinc-500">({s.stock})</span>
                            </button>
                          ))}
                        </div>
                      )
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Price difference */}
          {exchReturnProduct && exchNewProduct && (
            <div className={cn('p-3 rounded-xl text-sm border',
              exchNewProduct.price > exchReturnProduct.price
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : exchNewProduct.price < exchReturnProduct.price
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                  : 'bg-zinc-800/50 border-border text-zinc-400')}>
              {exchNewProduct.price > exchReturnProduct.price
                ? `El cliente abona la diferencia: ${formatCurrency(exchNewProduct.price - exchReturnProduct.price)}`
                : exchNewProduct.price < exchReturnProduct.price
                  ? `Se devuelve al cliente: ${formatCurrency(exchReturnProduct.price - exchNewProduct.price)}`
                  : 'Cambio sin diferencia de precio'}
            </div>
          )}

          {/* Payment method if customer pays */}
          {exchReturnProduct && exchNewProduct && exchNewProduct.price > exchReturnProduct.price && (
            <div>
              <label className={labelCls}>Medio de pago (diferencia)</label>
              <div className="flex flex-wrap gap-1.5">
                {paymentMethods.slice(0, 4).map(({ id }) => (
                  <button key={id} onClick={() => setExchPayMethod(id)}
                    className={cn('px-3 py-1.5 rounded-lg text-xs border transition-colors',
                      exchPayMethod === id ? 'border-accent bg-accent/10 text-white' : 'border-border text-zinc-500 hover:text-zinc-300')}>
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>Notas (opcional)</label>
            <input value={exchNotes} onChange={e => setExchNotes(e.target.value)}
              placeholder="Motivo del cambio..." className={inputCls} />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <button onClick={() => setExchangeModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
            <button onClick={confirmExchange} disabled={exchProcessing || !exchReturnProduct || !exchReturnSize || !exchNewProduct || !exchNewSize}
              className="no-drag btn-primary px-5 py-2 text-sm rounded-lg font-medium disabled:opacity-40 flex items-center gap-2">
              <ArrowLeftRight size={14} className={exchProcessing ? 'animate-spin' : ''} />
              {exchProcessing ? 'Registrando...' : 'Registrar cambio'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Devolución */}
      <Modal open={returnModal} onClose={() => setReturnModal(false)} title="Registrar devolución" width="max-w-lg">
        <div className="space-y-4">
          {/* Sale search */}
          <div>
            <label className={labelCls}>Número de venta</label>
            <div className="flex gap-2">
              <input value={retSaleSearch} onChange={e => setRetSaleSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchReturnSale()}
                placeholder="Ej: 42 ó VTA-0042" className={cn(inputCls, 'flex-1')} />
              <button onClick={searchReturnSale} disabled={retSaleLoading}
                className="no-drag px-4 py-2 bg-accent/10 border border-accent/30 text-accent rounded-lg text-sm hover:bg-accent/20 transition-colors disabled:opacity-40">
                {retSaleLoading ? '...' : 'Buscar'}
              </button>
            </div>
          </div>

          {/* Sale items */}
          {retSaleData && (
            <div className="space-y-3">
              <div className="p-3 bg-[#0a0a0a] border border-border rounded-xl text-xs text-zinc-400">
                <div className="flex justify-between">
                  <span>{retSaleData.sale_number || `#${retSaleData.id}`}</span>
                  <span>{retSaleData.client_name || 'Sin cliente'}</span>
                  <span className="text-white font-medium">{formatCurrency(retSaleData.total)}</span>
                </div>
              </div>
              <div>
                <label className={labelCls}>Seleccioná los productos a devolver</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {retSaleData.items?.map((it, i) => (
                    <button key={i} onClick={() => toggleRetItem(i)}
                      className={cn('w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors text-left',
                        retSelectedItems.has(i) ? 'border-accent bg-accent/10 text-white' : 'border-border text-zinc-400 hover:border-zinc-600')}>
                      <span>{it.product_name} T.{it.size} ×{it.quantity}</span>
                      <span className="text-xs tabular-nums">{formatCurrency(it.unit_price * it.quantity)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className={labelCls}>Motivo *</label>
            <input value={retReason} onChange={e => setRetReason(e.target.value)}
              placeholder="Ej: Producto defectuoso, talle incorrecto..." className={inputCls} />
          </div>

          {/* Resolution */}
          <div>
            <label className={labelCls}>Resolución</label>
            <div className="flex gap-2">
              {[
                { id: 'cash', label: 'Efectivo' },
                { id: 'credit', label: 'Cta. Cte.' },
                { id: 'nota', label: 'Nota crédito' },
              ].map(({ id, label }) => (
                <button key={id} onClick={() => setRetResolution(id)}
                  className={cn('flex-1 py-2 rounded-lg text-xs border transition-colors',
                    retResolution === id ? 'border-accent bg-accent/10 text-white' : 'border-border text-zinc-500 hover:text-zinc-300')}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <button onClick={() => setReturnModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
            <button onClick={confirmReturn} disabled={retProcessing || !retSaleData || retSelectedItems.size === 0 || !retReason.trim()}
              className="no-drag btn-primary px-5 py-2 text-sm rounded-lg font-medium disabled:opacity-40 flex items-center gap-2">
              <RotateCcw size={14} className={retProcessing ? 'animate-spin' : ''} />
              {retProcessing ? 'Registrando...' : 'Confirmar devolución'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Anular venta */}
      <Modal open={!!voidModal} onClose={() => setVoidModal(null)} title="Anular venta" width="max-w-sm">
        {voidModal && (
          <div className="space-y-4">
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm">
              <p className="text-red-400 font-medium">Venta {voidModal.sale_number || `#${voidModal.id}`} — {formatCurrency(voidModal.total)}</p>
              <p className="text-zinc-400 text-xs mt-1">El stock de los productos será restaurado automáticamente.</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Motivo de anulación *</label>
              <textarea
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag resize-none"
                rows={3}
                placeholder="Ej: Error en precio, devolución del cliente..."
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                autoFocus
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setVoidModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={confirmVoid} disabled={voiding || !voidReason.trim()}
            className="no-drag px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {voiding ? 'Anulando...' : 'Confirmar anulación'}
          </button>
        </div>
      </Modal>

      {/* ── Modal: Mercado Pago QR ── */}
      {mpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-8 w-full max-w-sm mx-4 text-center shadow-2xl">
            {!mpSuccess ? (
              <>
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 mx-auto mb-5">
                  <QrCode size={32} className="text-blue-400" />
                </div>
                <h2 className="text-lg font-bold text-white mb-1">Esperando pago con Mercado Pago</h2>
                <p className="text-3xl font-bold text-accent tabular-nums my-4">{formatCurrency(mpPendingAmount)}</p>
                <p className="text-sm text-zinc-400 mb-6">Pedile al cliente que escanee el QR del local</p>

                {mpError ? (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-5">
                    <p className="text-sm text-red-400">{mpError}</p>
                    <button
                      onClick={async () => {
                        setMpError('')
                        setMpTimeLeft(300)
                        const orderRes = await api.mp.createOrder({
                          amount: mpPendingAmount,
                          externalReference: `DELPA-${Date.now()}`,
                        })
                        if (!orderRes?.ok) {
                          setMpError(`Error al crear orden: ${orderRes?.error || 'Error'}`)
                          return
                        }
                        const newOrderId = orderRes.order_id
                        setMpOrderId(newOrderId)
                        startMpPolling(newOrderId)
                      }}
                      className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
                    >
                      Reintentar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-3 mb-5">
                    <Loader2 size={18} className="text-blue-400 animate-spin" />
                    <div className="flex items-center gap-1.5 text-sm text-zinc-400">
                      <Clock size={14} />
                      <span className="tabular-nums font-mono">
                        {String(Math.floor(mpTimeLeft / 60)).padStart(2, '0')}:{String(mpTimeLeft % 60).padStart(2, '0')}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={cancelMpModal}
                  className="w-full py-2.5 text-sm text-zinc-500 hover:text-white border border-border hover:border-zinc-500 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30 mx-auto mb-5">
                  <CheckCircle size={36} className="text-green-400" />
                </div>
                <h2 className="text-xl font-bold text-white mb-1">¡Pago recibido!</h2>
                <p className="text-3xl font-bold text-green-400 tabular-nums my-4">{formatCurrency(mpSuccess.amount)}</p>
                {mpSuccess.payerName && (
                  <p className="text-sm text-zinc-300 mb-1">{mpSuccess.payerName}</p>
                )}
                {mpSuccess.payerEmail && (
                  <p className="text-xs text-zinc-500 mb-3">{mpSuccess.payerEmail}</p>
                )}
                <p className="text-xs text-zinc-600 font-mono mb-5">ID: {mpSuccess.id}</p>
                <p className="text-xs text-zinc-500">Completando venta automáticamente...</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Multi-scan confirm modal ── */}
      {multiScanConfirm && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setMultiScanConfirm(null)}>
          <div className="bg-[#111] border border-border rounded-2xl p-6 w-80 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-white font-semibold text-sm mb-1">Escaneo múltiple detectado</p>
            <p className="text-zinc-400 text-xs mb-4">
              Escaneaste <span className="text-accent font-bold">{multiScanConfirm.name} T.{multiScanConfirm.sz}</span> {multiScanConfirm.count} veces.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setMultiScanConfirm(null)
                  bcMultiRef.current = { code: null, count: 0, ts: 0 }
                }}
                className="flex-1 btn-primary py-2 rounded-xl text-sm"
              >
                Sí, agregar {multiScanConfirm.count} u.
              </button>
              <button
                onClick={() => {
                  setCart(c => c.map(it => it.key === multiScanConfirm.key ? { ...it, qty: 1 } : it))
                  setMultiScanConfirm(null)
                  bcMultiRef.current = { code: null, count: 0, ts: 0 }
                }}
                className="flex-1 py-2 rounded-xl text-sm border border-border text-zinc-400 hover:text-white"
              >
                No, solo 1
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Waitlist modal (no stock, offer to add to waitlist) ── */}
      {waitlistModal && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setWaitlistModal(null)}>
          <div className="bg-[#111] border border-border rounded-2xl p-6 w-80 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <p className="text-amber-400 font-semibold text-sm mb-1">Sin stock disponible</p>
            <p className="text-zinc-400 text-xs mb-4">
              <span className="text-white">{waitlistModal.product?.name}</span>
              {waitlistModal.size ? ` T.${waitlistModal.size}` : ''} no tiene stock.
              ¿Agregar a la lista de espera?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setWaitlistModal(null)
                  window.location.href = '#/pedidos?waitlist=1'
                }}
                className="flex-1 btn-primary py-2 rounded-xl text-sm"
              >
                Ir a Lista de espera
              </button>
              <button onClick={() => setWaitlistModal(null)}
                className="flex-1 py-2 rounded-xl text-sm border border-border text-zinc-400 hover:text-white">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Size picker modal (barcode scan with multiple sizes) ── */}
      {sizePickModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setSizePickModal(null)}>
          <div className="bg-[#111] border border-border rounded-2xl p-6 w-80 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-white font-semibold text-sm">Seleccioná el talle</h3>
              <button onClick={() => setSizePickModal(null)} className="text-zinc-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <p className="text-zinc-500 text-xs mb-4 truncate">{sizePickModal.product.name}{sizePickModal.product.color ? ` · ${sizePickModal.product.color}` : ''}</p>
            <div className="flex flex-wrap gap-2">
              {sizePickModal.sizes.map(sz => (
                <button
                  key={sz.size}
                  onClick={() => { addItemDirect(sizePickModal.product, sz.size); setSizePickModal(null) }}
                  className="flex flex-col items-center justify-center w-16 h-14 rounded-xl border border-border bg-white/[0.04] hover:border-accent hover:bg-accent/10 hover:text-accent transition-all text-white"
                >
                  <span className="text-sm font-bold">{sz.size}</span>
                  <span className="text-[10px] text-zinc-500">{sz.stock} u.</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
