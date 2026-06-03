import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ScanLine, Plus, CheckCircle, AlertTriangle, XCircle,
  TrendingUp, TrendingDown, Minus as MinusIcon,
  FileDown, Mail, RotateCcw, ClipboardList, PackageCheck,
  Hash, ChevronRight,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime, cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'

// ── Audio helpers ──────────────────────────────────────────────────────────────
function beepOk() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'; osc.frequency.value = 1047
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.12)
  } catch {}
}

function beepError() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sawtooth'; osc.frequency.value = 220
    gain.gain.setValueAtTime(0.35, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.35)
  } catch {}
}

// ── Difference badge ───────────────────────────────────────────────────────────
function DiffBadge({ diff }) {
  if (diff === 0) return <span className="text-zinc-600 text-xs flex items-center gap-0.5"><MinusIcon size={10} />0</span>
  if (diff > 0)  return <span className="text-green-400 text-xs font-bold flex items-center gap-0.5"><TrendingUp size={11} />+{diff}</span>
  return               <span className="text-red-400 text-xs font-bold flex items-center gap-0.5"><TrendingDown size={11} />{diff}</span>
}

// ── Row color for comparison table ─────────────────────────────────────────────
function rowBg(item) {
  if (item.real_stock === 0 && item.system_stock > 0) return 'bg-red-500/[0.07] border-l-2 border-red-500/40'
  if (item.difference === 0) return 'bg-green-500/[0.05] border-l-2 border-green-500/30'
  if (Math.abs(item.difference) <= 2) return 'bg-amber-500/[0.07] border-l-2 border-amber-500/40'
  return 'bg-red-500/[0.07] border-l-2 border-red-500/40'
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Inventory() {
  // view: 'loading' | 'history' | 'scan' | 'compare'
  const [view, setView]               = useState('loading')
  const [session, setSession]         = useState(null)
  const [scanItems, setScanItems]     = useState([])  // only real_stock > 0
  const [notFound, setNotFound]       = useState([])  // unknown barcodes
  const [comparison, setComparison]   = useState(null) // full comparison data
  const [history, setHistory]         = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [lastScan, setLastScan]       = useState(null) // { product_name, size, qty } for flash
  const [startModal, setStartModal]   = useState(false)
  const [startNotes, setStartNotes]   = useState('')
  const [starting, setStarting]       = useState(false)
  const [closeModal, setCloseModal]   = useState(false)
  const [adjusting, setAdjusting]     = useState(false)
  const [exporting, setExporting]     = useState(false)
  const [emailing, setEmailing]       = useState(false)
  const [barcodeVal, setBarcodeVal]   = useState('')
  const [scanning, setScanning]       = useState(false)

  const barcodeRef = useRef(null)
  const listRef    = useRef(null)

  // ── Init ──────────────────────────────────────────────────────────────────────
  const init = useCallback(async () => {
    try {
      const res = await api.inventory.getCurrent()
      if (res?.session) {
        setSession(res.session)
        setScanItems(res.items.filter(i => i.real_stock > 0))
        setView('scan')
      } else {
        await loadHistory()
        setView('history')
      }
    } catch {
      setView('history')
    }
  }, [])

  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    try {
      const res = await api.inventory.history({ page: 1, limit: 30 })
      setHistory(res.sessions || [])
    } finally {
      setHistLoading(false)
    }
  }, [])

  useEffect(() => { init() }, [init])

  // Auto-focus barcode input while in scan view
  useEffect(() => {
    if (view === 'scan') barcodeRef.current?.focus()
  }, [view])

  // Keep focus on barcode input (re-focus on window click)
  const refocusBarcode = useCallback((e) => {
    if (view !== 'scan') return
    if (e.target?.tagName === 'INPUT' && e.target !== barcodeRef.current) return
    if (e.target?.tagName === 'BUTTON') return
    barcodeRef.current?.focus()
  }, [view])

  // ── Start session ─────────────────────────────────────────────────────────────
  const startSession = async () => {
    setStarting(true)
    try {
      const id = await api.inventory.start(startNotes)
      setSession({ id, notes: startNotes, status: 'open', created_at: new Date().toISOString() })
      setScanItems([])
      setNotFound([])
      setLastScan(null)
      setStartModal(false)
      setStartNotes('')
      setView('scan')
      toast.success('Inventario iniciado — empezá a escanear')
    } catch (e) {
      toast.error(e.message || 'Error al iniciar inventario')
    } finally {
      setStarting(false)
    }
  }

  // ── Scan handler — usa searchByBarcode igual que Ventas ──────────────────────
  const handleScan = useCallback(async (barcode) => {
    const code = String(barcode || '').trim()
    if (!code || !session) return
    setScanning(true)
    setBarcodeVal('')
    try {
      // Paso 1: buscar el producto EXACTAMENTE igual que Ventas
      console.log('[INVENTORY] código escaneado:', code)
      const result = await api.products.searchByBarcode(code)
      console.log('[INVENTORY] resultado searchByBarcode:', result)

      if (!result) {
        // No encontrado — igual que si result es null/undefined
        beepError()
        setNotFound(prev => {
          const exists = prev.find(x => x.barcode === code)
          if (exists) return prev.map(x => x.barcode === code ? { ...x, count: x.count + 1 } : x)
          return [{ barcode: code, count: 1 }, ...prev]
        })
        toast.warning(`No encontrado: ${code}`, { duration: 2500 })
        return
      }

      // Paso 2: determinar el talle escaneado
      const productId   = result.id
      const productName = result.name
      const color       = result.color || ''
      // matchedSize viene cuando se escaneó un size_barcode específico
      // Si es null, el lector leyó el barcode del producto (no de talle)
      const size = result.matchedSize || result.sizes?.[0]?.size

      console.log('[INVENTORY] productId:', productId, 'size:', size, 'matchedSize:', result.matchedSize)

      if (!size) {
        beepError()
        toast.warning(`Producto encontrado (${productName}) pero sin talle identificable`, { duration: 3000 })
        return
      }

      // Paso 3: registrar en inventario
      const item = await api.inventory.increment({
        sessionId: session.id,
        productId,
        size,
        productName,
        color,
      })

      beepOk()
      setScanItems(prev => {
        const idx = prev.findIndex(i => i.product_id === item.product_id && i.size === item.size)
        if (idx >= 0) {
          const updated = [...prev]; updated[idx] = item
          return updated.sort((a, b) => a.product_name.localeCompare(b.product_name) || a.size.localeCompare(b.size))
        }
        return [...prev, item].sort((a, b) => a.product_name.localeCompare(b.product_name) || a.size.localeCompare(b.size))
      })
      setLastScan({ product_name: item.product_name, size: item.size, color: item.color, qty: item.real_stock })
      setTimeout(() => setLastScan(null), 2500)

    } catch (e) {
      console.log('[INVENTORY] error:', e)
      beepError()
      toast.error('Error al escanear: ' + (e?.message || e))
    } finally {
      setScanning(false)
      setTimeout(() => barcodeRef.current?.focus(), 50)
    }
  }, [session])

  const handleBarcodeKey = (e) => {
    if (e.key === 'Enter' || e.key === '\r' || e.keyCode === 13) {
      e.preventDefault()
      handleScan(barcodeVal)
    }
  }

  // ── Finalizar → comparison view ───────────────────────────────────────────────
  const finishAndCompare = async () => {
    try {
      const res = await api.inventory.getReport(session.id)
      if (!res) { const c = await api.inventory.getCurrent(); setComparison(c) }
      else setComparison(res)
      setView('compare')
    } catch (e) {
      toast.error('Error al cargar comparativa')
    }
  }

  // ── Close session ─────────────────────────────────────────────────────────────
  const closeSession = async (applyAdjustments) => {
    if (!session) return
    setAdjusting(true)
    try {
      await api.inventory.close({ sessionId: session.id, applyAdjustments })
      toast.success(applyAdjustments ? 'Stock ajustado correctamente' : 'Inventario cerrado sin ajustar')
      setCloseModal(false)
      setSession(null); setScanItems([]); setNotFound([]); setComparison(null)
      await loadHistory()
      setView('history')
    } catch (e) {
      toast.error(e.message || 'Error al cerrar')
    } finally {
      setAdjusting(false)
    }
  }

  // ── Export PDF ────────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    if (!session) return
    setExporting(true)
    try {
      const res = await api.inventory.exportPDF(session.id)
      if (res?.ok) toast.success('PDF guardado correctamente')
    } catch (e) {
      toast.error(e.message || 'Error al exportar PDF')
    } finally {
      setExporting(false)
    }
  }

  // ── Send email ────────────────────────────────────────────────────────────────
  const sendEmail = async () => {
    if (!session) return
    setEmailing(true)
    try {
      await api.inventory.emailReport(session.id)
      toast.success('Informe enviado por email')
    } catch (e) {
      toast.error(e.message || 'Error al enviar email')
    } finally {
      setEmailing(false)
    }
  }

  const totalQty = scanItems.reduce((s, i) => s + i.real_stock, 0)

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: loading
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: history
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }} className="p-6 h-full flex flex-col">
        <PageHeader
          title="Inventario Físico"
          subtitle="Conteo por escaneo de código de barras"
          actions={
            <button onClick={() => setStartModal(true)}
              className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
              <Plus size={15} /> Nuevo inventario
            </button>
          }
        />

        {history.length === 0 && !histLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-white/[0.04] flex items-center justify-center mb-4">
              <ScanLine size={28} className="text-zinc-500" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Sin inventarios registrados</h3>
            <p className="text-sm text-zinc-500 max-w-xs mb-6">
              Iniciá un inventario físico para comparar el stock del sistema con lo que tenés en el local.
            </p>
            <button onClick={() => setStartModal(true)}
              className="btn-primary no-drag flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold">
              <Plus size={16} /> Nuevo inventario
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-surface text-[11px] text-zinc-500 uppercase tracking-wider">
                <span className="flex-1">Fecha</span>
                <span className="w-20 text-center">Escaneados</span>
                <span className="w-20 text-center">Coinciden</span>
                <span className="w-20 text-center">Diferencias</span>
                <span className="w-20 text-center">No escaneados</span>
                <span className="w-20 text-center">Estado</span>
              </div>
              {histLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : history.map(s => (
                <div key={s.id} className="row-alt flex items-center px-4 py-3 text-sm gap-3">
                  <div className="flex-1">
                    <p className="text-zinc-200 text-sm">{formatDateTime(s.created_at)}</p>
                    {s.notes && <p className="text-xs text-zinc-600 mt-0.5">{s.notes}</p>}
                  </div>
                  <span className="w-20 text-center tabular-nums text-zinc-300 text-sm">{s.total_qty ?? '—'}</span>
                  <span className="w-20 text-center tabular-nums text-green-400 text-sm">{s.exact_count ?? '—'}</span>
                  <span className="w-20 text-center tabular-nums text-amber-400 text-sm">{s.diff_count ?? '—'}</span>
                  <span className="w-20 text-center tabular-nums text-red-400 text-sm">{s.unscanned_count ?? '—'}</span>
                  <span className={cn('w-20 text-center text-xs px-2 py-0.5 rounded-full border',
                    s.status === 'closed'
                      ? 'bg-green-500/10 border-green-500/30 text-green-400'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-400')}>
                    {s.status === 'closed' ? 'Cerrado' : 'Abierto'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Modal: Start */}
        <Modal open={startModal} onClose={() => { setStartModal(false); setStartNotes('') }}
          title="Nuevo inventario físico" width="max-w-sm">
          <div className="space-y-4">
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300 flex items-start gap-2">
              <ScanLine size={14} className="shrink-0 mt-0.5" />
              <p>Se cargará todo el stock actual. Luego escaneás los productos uno a uno y DELPA compara las diferencias.</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block">Notas (opcional)</label>
              <input
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag"
                placeholder="Ej: Conteo mensual Junio 2026..."
                value={startNotes}
                onChange={e => setStartNotes(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !starting) startSession() }}
                autoFocus
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
            <button onClick={() => { setStartModal(false); setStartNotes('') }}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
            <button onClick={startSession} disabled={starting}
              className="btn-primary no-drag px-5 py-2 text-sm rounded-lg disabled:opacity-50 flex items-center gap-2">
              <ScanLine size={14} />{starting ? 'Iniciando...' : 'Iniciar inventario'}
            </button>
          </div>
        </Modal>
      </motion.div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: scan
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'scan') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }} className="p-6 h-full flex flex-col" onClick={refocusBarcode}>
        <PageHeader
          title="Escaneo de Inventario"
          subtitle={session?.notes ? `"${session.notes}"` : `Sesión #${session?.id}`}
          actions={
            <div className="flex gap-2">
              <button onClick={finishAndCompare}
                className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
                <CheckCircle size={15} /> Finalizar y comparar
              </button>
            </div>
          }
        />

        {/* Scan input + flash */}
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                ref={barcodeRef}
                value={barcodeVal}
                onChange={e => setBarcodeVal(e.target.value)}
                onKeyDown={handleBarcodeKey}
                placeholder="Esperando escaneo..."
                className="w-full bg-[#0d0d0d] border border-border rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder-zinc-600 no-drag focus:border-accent outline-none font-mono"
                autoFocus
              />
            </div>
            <div className="flex flex-col items-end shrink-0">
              <span className="text-2xl font-bold text-white tabular-nums">{totalQty}</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">unidades</span>
            </div>
            <div className="flex flex-col items-end shrink-0">
              <span className="text-2xl font-bold text-accent tabular-nums">{scanItems.length}</span>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">ítems</span>
            </div>
          </div>

          {/* Last scan flash */}
          <AnimatePresence>
            {lastScan && (
              <motion.div
                key={lastScan.product_name + lastScan.size + lastScan.qty}
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-3 px-4 py-2.5 bg-green-500/10 border border-green-500/30 rounded-xl text-sm">
                <CheckCircle size={15} className="text-green-400 shrink-0" />
                <span className="text-green-300 font-medium">{lastScan.product_name}</span>
                <span className="text-green-500 text-xs">T.{lastScan.size}</span>
                {lastScan.color && <span className="text-green-600 text-xs">{lastScan.color}</span>}
                <span className="ml-auto text-green-400 font-bold tabular-nums">×{lastScan.qty}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Scan list + not-found side by side */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Scanned items */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <PackageCheck size={12} /> Escaneados
            </h3>
            <div ref={listRef} className="flex-1 overflow-y-auto bg-card border border-border rounded-xl">
              {scanItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center text-zinc-600">
                  <ScanLine size={20} className="mb-2 opacity-40" />
                  <p className="text-xs">Aún no se escaneó nada</p>
                </div>
              ) : (
                <>
                  <div className="sticky top-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-surface text-[10px] text-zinc-600 uppercase tracking-wider">
                    <span className="flex-1">Producto</span>
                    <span className="w-14 text-center">Talle</span>
                    <span className="w-14 text-center">Cant.</span>
                    <span className="w-14 text-center">Dif.</span>
                  </div>
                  <div className="divide-y divide-border">
                    {scanItems.map(item => (
                      <motion.div key={`${item.product_id}-${item.size}`}
                        initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-2 px-3 py-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="text-zinc-200 truncate">{item.product_name}</p>
                          {item.color && <p className="text-zinc-600 text-[10px]">{item.color}</p>}
                        </div>
                        <span className="w-14 text-center text-zinc-400 font-mono">{item.size}</span>
                        <span className="w-14 text-center text-white font-bold tabular-nums">{item.real_stock}</span>
                        <div className="w-14 flex justify-center"><DiffBadge diff={item.difference} /></div>
                      </motion.div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Not found */}
          {notFound.length > 0 && (
            <div className="w-52 flex flex-col min-h-0">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <XCircle size={12} className="text-red-500" /> No encontrados ({notFound.length})
              </h3>
              <div className="flex-1 overflow-y-auto bg-card border border-red-500/20 rounded-xl divide-y divide-border">
                {notFound.map(x => (
                  <div key={x.barcode} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="flex-1 font-mono text-red-400 truncate">{x.barcode}</span>
                    {x.count > 1 && <span className="text-zinc-600 shrink-0">×{x.count}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: compare
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'compare') {
    const items       = comparison?.items       || []
    const exact       = comparison?.exact       || []
    const withDiff    = comparison?.withDiff    || []
    const unscanned   = comparison?.unscanned   || []
    const totalQtyC   = comparison?.totalScannedQty || 0
    const scanned     = comparison?.scanned     || []

    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }} className="p-6 h-full flex flex-col">
        <PageHeader
          title="Comparativa de Inventario"
          subtitle={session?.notes ? `"${session.notes}"` : `Sesión #${session?.id}`}
          actions={
            <div className="flex gap-2">
              <button onClick={() => setView('scan')}
                className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border text-zinc-400 hover:text-white hover:border-zinc-500 rounded-lg transition-colors">
                <RotateCcw size={14} /> Seguir escaneando
              </button>
              <button onClick={exportPDF} disabled={exporting}
                className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border text-zinc-400 hover:text-white hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50">
                <FileDown size={14} />{exporting ? 'Exportando...' : 'Exportar PDF'}
              </button>
              <button onClick={sendEmail} disabled={emailing}
                className="no-drag flex items-center gap-2 px-3 py-2 text-sm border border-border text-zinc-400 hover:text-white hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50">
                <Mail size={14} />{emailing ? 'Enviando...' : 'Enviar email'}
              </button>
              <button onClick={() => setCloseModal(true)}
                className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
                <CheckCircle size={15} /> Ajustar stock
              </button>
            </div>
          }
        />

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Ítems escaneados', value: scanned.length,  color: 'text-white',      icon: Hash },
            { label: 'Coinciden',        value: exact.length,     color: 'text-green-400',  icon: CheckCircle },
            { label: 'Con diferencia',   value: withDiff.filter(i => i.real_stock > 0).length, color: 'text-amber-400', icon: AlertTriangle },
            { label: 'No escaneados',    value: unscanned.length, color: 'text-red-400',    icon: XCircle },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <Icon size={16} className={cn('shrink-0', color)} />
              <div>
                <p className={cn('text-xl font-bold tabular-nums', color)}>{value}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500/20 border border-green-500/40 inline-block" />Coincide</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500/20 border border-amber-500/40 inline-block" />Dif. ≤ 2</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/40 inline-block" />Dif. &gt; 2 / No escaneado</span>
          <span className="ml-auto text-zinc-600">{totalQtyC} unidades escaneadas en total</span>
        </div>

        {/* Comparison table */}
        <div className="flex-1 overflow-auto bg-card border border-border rounded-xl">
          <div className="sticky top-0 flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface text-[10px] text-zinc-500 uppercase tracking-wider">
            <span className="flex-1">Producto</span>
            <span className="w-16 text-center">Talle</span>
            <span className="w-16 text-center">Color</span>
            <span className="w-20 text-center">Sistema</span>
            <span className="w-20 text-center">Escaneado</span>
            <span className="w-20 text-center">Diferencia</span>
          </div>
          <div className="divide-y divide-border/50">
            {items.map(item => (
              <div key={`${item.product_id}-${item.size}`}
                className={cn('flex items-center gap-2 px-4 py-2 text-sm pl-[14px]', rowBg(item))}>
                <span className="flex-1 text-zinc-200 text-sm truncate">{item.product_name}</span>
                <span className="w-16 text-center text-zinc-400 font-mono text-xs">{item.size}</span>
                <span className="w-16 text-center text-zinc-500 text-xs truncate">{item.color || '—'}</span>
                <span className="w-20 text-center tabular-nums text-zinc-300">{item.system_stock}</span>
                <span className={cn('w-20 text-center tabular-nums font-medium',
                  item.real_stock === 0 ? 'text-red-400' : 'text-white')}>{item.real_stock}</span>
                <div className="w-20 flex justify-center"><DiffBadge diff={item.difference} /></div>
              </div>
            ))}
            {items.length === 0 && (
              <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">Sin datos</div>
            )}
          </div>
        </div>

        {/* Modal: close / adjust */}
        <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Finalizar inventario" width="max-w-sm">
          <div className="space-y-3">
            {withDiff.length > 0 ? (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm">
                <p className="text-amber-300 font-medium mb-1 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {withDiff.length} diferencia(s) detectada(s)
                </p>
                <p className="text-xs text-amber-500/80">¿Querés actualizar el stock del sistema con los valores escaneados?</p>
              </div>
            ) : (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-300">
                <p className="flex items-center gap-1.5"><CheckCircle size={14} /> El stock coincide exactamente.</p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 mt-6 pt-4 border-t border-border">
            <button onClick={() => closeSession(true)} disabled={adjusting}
              className="btn-primary no-drag w-full py-2.5 text-sm rounded-lg disabled:opacity-50 flex items-center justify-center gap-2">
              <CheckCircle size={14} />{adjusting ? 'Ajustando...' : 'Ajustar stock y cerrar'}
            </button>
            <button onClick={() => closeSession(false)} disabled={adjusting}
              className="w-full py-2.5 text-sm rounded-lg border border-border text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
              {adjusting ? 'Cerrando...' : 'Cerrar sin ajustar'}
            </button>
            <button onClick={() => setCloseModal(false)} className="text-xs text-zinc-600 hover:text-zinc-400 py-1 transition-colors">Cancelar</button>
          </div>
        </Modal>
      </motion.div>
    )
  }

  return null
}
