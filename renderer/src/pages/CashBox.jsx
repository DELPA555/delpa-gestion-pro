import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Wallet, Lock, Unlock, History, Plus, ArrowUpCircle, ArrowDownCircle, Printer } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

function generateReportHTML(data, biz) {
  const { cashbox: cb, byMethod, allSales, voidedSales, expenses, manualMovements = [], totalSales, totalExpenses, totalManualIngresos = 0, totalManualEgresos = 0, expectedCash, paymentCounts } = data
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const fmtDate = s => s ? new Date(s).toLocaleString('es-AR') : '—'
  const fmtTime = s => s ? new Date(s).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const gananciaNet = totalSales + totalManualIngresos - totalManualEgresos - totalExpenses
  const cbDiff = cb.difference || 0

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe de Cierre #${cb.id}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px}
  h1{font-size:20px;font-weight:bold;margin-bottom:2px}
  h2{font-size:12px;font-weight:bold;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #333;text-transform:uppercase;letter-spacing:.5px}
  .biz-info{color:#555;margin-bottom:16px}.biz-info p{margin:2px 0}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}.total-row td{font-weight:bold;background:#f9f9f9}
  .grn{color:#16a34a}.red{color:#dc2626}
  .sb{border:1px solid #ccc;border-radius:4px;padding:12px;margin-bottom:16px}
  .sr{display:flex;justify-content:space-between;padding:3px 0}
  .sr.bold{font-weight:bold;font-size:13px;border-top:1px solid #ccc;padding-top:6px;margin-top:4px}
  .badge{background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:3px;font-size:9px}
  .item-row td{color:#777;font-size:10px;background:#fafafa}
  .footer{margin-top:24px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:10px;text-align:center}
  .print-btn{margin-top:16px;padding:8px 20px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px}
  @media print{.print-btn{display:none}@page{size:A4;margin:15mm}}
</style>
</head>
<body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:50px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
<h1>${biz.business_name || 'DELPA'}</h1>
<div class="biz-info">
  ${biz.business_address ? `<p>${biz.business_address}</p>` : ''}
  ${biz.business_phone ? `<p>Tel: ${biz.business_phone}</p>` : ''}
  ${biz.business_cuit ? `<p>CUIT: ${biz.business_cuit}</p>` : ''}
</div>

<h2>Informe de Cierre de Caja N° ${cb.id}</h2>
<div class="sb">
  <div class="sr"><span>Apertura:</span><span>${fmtDate(cb.opened_at)}</span></div>
  <div class="sr"><span>Cierre:</span><span>${fmtDate(cb.closed_at)}</span></div>
  <div class="sr"><span>Efectivo inicial:</span><span>${fmt(cb.opening_cash)}</span></div>
  ${cb.notes ? `<div class="sr"><span>Notas:</span><span>${cb.notes}</span></div>` : ''}
</div>

<h2>Resumen por medio de pago</h2>
<table>
  <thead><tr><th>Método</th><th class="r">Ventas</th><th class="r">Sistema</th><th class="r">Real contado</th><th class="r">Diferencia</th></tr></thead>
  <tbody>
    ${byMethod.map(m => {
      const real = paymentCounts[m.payment_method]?.real ?? m.total
      const d = real - m.total
      return `<tr>
        <td>${m.payment_method}</td><td class="r">${m.count}</td>
        <td class="r">${fmt(m.total)}</td><td class="r">${fmt(real)}</td>
        <td class="r ${d >= 0 ? 'grn' : 'red'}">${d >= 0 ? '+' : ''}${fmt(d)}</td>
      </tr>`
    }).join('')}
    <tr class="total-row">
      <td>TOTAL</td><td class="r">${allSales.length}</td>
      <td class="r">${fmt(totalSales)}</td><td class="r"></td><td class="r"></td>
    </tr>
  </tbody>
</table>

<h2>Ventas del período (${allSales.length})</h2>
<table>
  <thead><tr><th>N° Venta</th><th>Hora</th><th>Cliente</th><th>Vendedora</th><th>Método</th><th class="r">Total</th></tr></thead>
  <tbody>
    ${allSales.map(s => `<tr>
      <td>${s.sale_number || '#' + s.id}</td>
      <td>${fmtTime(s.created_at)}</td>
      <td>${s.client_name || '—'}</td>
      <td>${s.seller_name || '—'}</td>
      <td>${s.payment_method}${s.installments > 1 ? ` (${s.installments}c)` : ''}</td>
      <td class="r">${fmt(s.total)}</td>
    </tr>${(s.items || []).map(it => `<tr class="item-row">
      <td></td>
      <td colspan="4" style="padding-left:16px">↳ ${it.product_name} T.${it.size} ×${it.quantity} — ${fmt(it.unit_price)} c/u</td>
      <td class="r">${fmt(it.unit_price * it.quantity)}</td>
    </tr>`).join('')}`).join('')}
    <tr class="total-row"><td colspan="5">TOTAL VENTAS</td><td class="r">${fmt(totalSales)}</td></tr>
  </tbody>
</table>

${voidedSales.length > 0 ? `
<h2>Ventas anuladas (${voidedSales.length})</h2>
<table>
  <thead><tr><th>N° Venta</th><th class="r">Total</th><th>Motivo</th></tr></thead>
  <tbody>
    ${voidedSales.map(s => `<tr>
      <td>${s.sale_number || '#' + s.id} <span class="badge">ANULADA</span></td>
      <td class="r">${fmt(s.total)}</td>
      <td>${s.void_reason || '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

${expenses.length > 0 ? `
<h2>Gastos del período (${expenses.length})</h2>
<table>
  <thead><tr><th>Concepto</th><th>Método</th><th class="r">Monto</th></tr></thead>
  <tbody>
    ${expenses.map(e => `<tr>
      <td>${e.concept}</td><td>${e.payment_method || 'Efectivo'}</td>
      <td class="r">${fmt(e.amount)}</td>
    </tr>`).join('')}
    <tr class="total-row"><td colspan="2">TOTAL GASTOS</td><td class="r">${fmt(totalExpenses)}</td></tr>
  </tbody>
</table>` : ''}

${manualMovements.length > 0 ? `
<h2>Movimientos manuales de caja (${manualMovements.length})</h2>
<table>
  <thead><tr><th>Tipo</th><th>Concepto</th><th>Método</th><th class="r">Monto</th></tr></thead>
  <tbody>
    ${manualMovements.map(m => `<tr>
      <td style="color:${m.type === 'ingreso' ? '#16a34a' : '#dc2626'}">${m.type}</td>
      <td>${m.concept || '—'}</td>
      <td>${m.payment_method || 'Efectivo'}</td>
      <td class="r ${m.type === 'ingreso' ? 'grn' : 'red'}">${m.type === 'egreso' ? '-' : '+'}${fmt(m.amount)}</td>
    </tr>`).join('')}
    ${totalManualIngresos > 0 ? `<tr class="total-row"><td colspan="3">TOTAL INGRESOS MANUALES</td><td class="r grn">+${fmt(totalManualIngresos)}</td></tr>` : ''}
    ${totalManualEgresos > 0 ? `<tr class="total-row"><td colspan="3">TOTAL EGRESOS MANUALES</td><td class="r red">-${fmt(totalManualEgresos)}</td></tr>` : ''}
  </tbody>
</table>` : ''}

<h2>Resumen final</h2>
<div class="sb">
  <div class="sr"><span>Total ventas:</span><span class="grn">${fmt(totalSales)}</span></div>
  ${totalManualIngresos > 0 ? `<div class="sr"><span>Ingresos manuales:</span><span class="grn">+${fmt(totalManualIngresos)}</span></div>` : ''}
  ${totalManualEgresos > 0 ? `<div class="sr red"><span>Egresos manuales:</span><span>-${fmt(totalManualEgresos)}</span></div>` : ''}
  <div class="sr red"><span>Total gastos:</span><span>-${fmt(totalExpenses)}</span></div>
  <div class="sr bold ${gananciaNet >= 0 ? 'grn' : 'red'}"><span>Ganancia neta:</span><span>${gananciaNet >= 0 ? '' : '-'}${fmt(Math.abs(gananciaNet))}</span></div>
  <div class="sr" style="margin-top:8px"><span>Efectivo esperado en caja:</span><span>${fmt(expectedCash)}</span></div>
  <div class="sr"><span>Efectivo real contado:</span><span>${fmt(cb.real_cash)}</span></div>
  <div class="sr bold ${cbDiff === 0 ? 'grn' : cbDiff > 0 ? 'grn' : 'red'}">
    <span>Diferencia:</span><span>${cbDiff >= 0 ? '+' : ''}${fmt(cbDiff)}</span>
  </div>
</div>

<button class="print-btn" onclick="window.print()">Imprimir</button>
<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body>
</html>`
}

export default function CashBox() {
  const [cashbox, setCashbox] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('actual')
  const [openModal, setOpenModal] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [movementModal, setMovementModal] = useState(false)
  const [openCash, setOpenCash] = useState('')
  const [openShift, setOpenShift] = useState('')
  const [shiftOptions, setShiftOptions] = useState(['Mañana', 'Tarde'])
  const [paymentRealAmounts, setPaymentRealAmounts] = useState({})
  const [closeNotes, setCloseNotes] = useState('')
  const [lastClosedId, setLastClosedId] = useState(null)
  const [history, setHistory] = useState({ cashboxes: [], total: 0, pages: 1 })
  const [hPage, setHPage] = useState(1)
  const [hLoading, setHLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [commissions, setCommissions] = useState([])
  const [commLoading, setCommLoading] = useState(false)
  const [movements, setMovements] = useState([])
  const [movLoading, setMovLoading] = useState(false)
  const [movForm, setMovForm] = useState({ type: 'ingreso', concept: '', amount: '', paymentMethod: 'Efectivo' })
  const [saleDetail, setSaleDetail] = useState(null)
  const [biz, setBiz] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cb = await api.cashbox.current()
      setCashbox(cb)
      if (cb) {
        const s = await api.cashbox.summary(cb.id)
        setSummary(s)
      } else setSummary(null)
    } finally { setLoading(false) }
  }, [])

  const loadHistory = useCallback(async () => {
    setHLoading(true)
    try { setHistory(await api.cashbox.history({ page: hPage, limit: 20 })) }
    finally { setHLoading(false) }
  }, [hPage])

  const loadMovements = useCallback(async (cbId) => {
    if (!cbId) return
    setMovLoading(true)
    try { setMovements(await api.cashbox.movements(cbId)) }
    finally { setMovLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    api.settings.getAll().then(all => {
      setBiz(all)
      try {
        const shifts = JSON.parse(all.cashbox_shifts || '["Mañana","Tarde"]')
        if (Array.isArray(shifts) && shifts.length > 0) {
          setShiftOptions(shifts)
          setOpenShift(shifts[0])
        }
      } catch {}
    }).catch(() => {})
  }, [])
  useEffect(() => { if (tab === 'historial') loadHistory() }, [tab, loadHistory])
  useEffect(() => { if (tab === 'movimientos' && cashbox) loadMovements(cashbox.id) }, [tab, cashbox, loadMovements])

  const handleOpen = async () => {
    setProcessing(true)
    try {
      await api.cashbox.open({ openingCash: Number(openCash) || 0, shift: openShift })
      toast.success('Caja abierta' + (openShift ? ` — Turno ${openShift}` : ''))
      setOpenModal(false); load()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const openCloseModal = () => {
    const init = {}
    summary?.byMethod?.forEach(m => { init[m.payment_method] = '' })
    setPaymentRealAmounts(init)
    setCloseNotes('')
    setCloseModal(true)
    if (cashbox) {
      setCommLoading(true)
      const from = new Date(cashbox.opened_at).toISOString().split('T')[0]
      const to = new Date().toISOString().split('T')[0]
      api.reports.commissions({ from, to })
        .then(data => { setCommissions((data || []).filter(c => c.commission_amount > 0)); setCommLoading(false) })
        .catch(() => { setCommissions([]); setCommLoading(false) })
    }
  }

  const handleClose = async () => {
    setProcessing(true)
    try {
      const paymentCounts = {}
      summary?.byMethod?.forEach(m => {
        const raw = paymentRealAmounts[m.payment_method]
        paymentCounts[m.payment_method] = {
          system: m.total,
          real: raw !== '' && raw !== undefined ? Number(raw) : m.total,
        }
      })
      const efectivoRaw = paymentRealAmounts['Efectivo']
      const realCash = efectivoRaw !== '' && efectivoRaw !== undefined ? Number(efectivoRaw) : null
      const closedId = cashbox.id
      const res = await api.cashbox.close({ cashboxId: cashbox.id, realCash, notes: closeNotes, paymentCounts })
      toast.success(`Caja cerrada. Diferencia: ${formatCurrency(res.difference)}`)
      setCloseModal(false)
      setLastClosedId(closedId)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const handleAddMovement = async () => {
    if (!movForm.concept.trim()) return toast.error('Ingresá un concepto')
    if (!movForm.amount || Number(movForm.amount) <= 0) return toast.error('Monto inválido')
    setProcessing(true)
    try {
      await api.cashbox.addMovement({
        cashboxId: cashbox.id,
        type: movForm.type,
        concept: movForm.concept,
        amount: Number(movForm.amount),
        paymentMethod: movForm.paymentMethod,
      })
      toast.success('Movimiento registrado')
      setMovementModal(false)
      setMovForm({ type: 'ingreso', concept: '', amount: '', paymentMethod: 'Efectivo' })
      loadMovements(cashbox.id)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const printClosingReport = async (cbId) => {
    try {
      const [data, bizData] = await Promise.all([api.cashbox.report(cbId), api.settings.getAll()])
      if (!data) return toast.error('No se pudo cargar el informe')
      const html = generateReportHTML(data, bizData)
      const w = window.open('', '_blank', 'width=960,height=700')
      w.document.write(html)
      w.document.close()
      w.focus()
    } catch { toast.error('Error al generar informe') }
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Caja" subtitle={cashbox ? `Abierta desde ${formatDateTime(cashbox.opened_at)}${cashbox.shift ? ` — Turno ${cashbox.shift}` : ''}` : 'Sin caja abierta'}
        actions={
          <div className="flex gap-2">
            {cashbox && (
              <button onClick={() => setMovementModal(true)} className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
                <Plus size={14} /> Movimiento
              </button>
            )}
            {!cashbox ? (
              <button onClick={() => { setOpenCash(''); setOpenModal(true) }} className="no-drag btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-lg"><Unlock size={15} /> Abrir caja</button>
            ) : (
              <button onClick={openCloseModal} className="no-drag flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"><Lock size={15} /> Cerrar caja</button>
            )}
          </div>
        }
      />

      <div className="flex border-b border-border mb-5">
        {[
          { id: 'actual', label: 'Caja actual' },
          { id: 'movimientos', label: 'Movimientos' },
          { id: 'historial', label: 'Historial' },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'actual' ? (
        loading ? <div className="py-8"><SkeletonTable rows={4} cols={4} /></div>
        : !cashbox ? (
          <div className="space-y-4">
            <EmptyState icon={Wallet} title="Sin caja abierta" subtitle="Abrí la caja para empezar a registrar ventas y gastos del día" />
            {lastClosedId && (
              <div className="flex justify-center">
                <button onClick={() => printClosingReport(lastClosedId)}
                  className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
                  <Printer size={14} /> Imprimir informe de cierre
                </button>
              </div>
            )}
          </div>
        ) : summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Efectivo inicial', value: cashbox.opening_cash, color: 'text-zinc-300' },
                { label: 'Total ventas', value: summary.totalSales, color: 'text-green-400' },
                { label: 'Movimientos netos', value: (summary.manualIngresos || 0) - (summary.manualEgresos || 0), color: (summary.manualIngresos || 0) - (summary.manualEgresos || 0) >= 0 ? 'text-blue-400' : 'text-orange-400', sub: `+${formatCurrency(summary.manualIngresos || 0)} / -${formatCurrency(summary.manualEgresos || 0)}` },
                { label: 'Efectivo esperado', value: summary.expectedCash, color: 'text-accent' },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="bg-card border border-border rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">{label}</p>
                  <p className={`text-xl font-bold tabular-nums ${color}`}>{formatCurrency(value)}</p>
                  {sub && <p className="text-[10px] text-zinc-600 mt-0.5 tabular-nums">{sub}</p>}
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <p className="text-xs text-zinc-500 uppercase tracking-wider px-4 py-3 border-b border-border">Ventas por medio de pago</p>
              <div className="divide-y divide-border">
                {summary.byMethod.length === 0 ? (
                  <div className="py-6 text-center text-zinc-700 text-sm">Sin ventas en esta caja</div>
                ) : summary.byMethod.map(m => (
                  <div key={m.payment_method} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div><span className="text-white">{m.payment_method}</span><span className="text-zinc-500 ml-2">{m.count} ventas</span></div>
                    <span className="text-white font-medium tabular-nums">{formatCurrency(m.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      ) : tab === 'movimientos' ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {!cashbox ? (
            <EmptyState icon={Wallet} title="Sin caja abierta" subtitle="Abrí la caja para ver los movimientos" />
          ) : movLoading ? (
            <SkeletonTable rows={6} cols={5} />
          ) : movements.length === 0 ? (
            <EmptyState icon={History} title="Sin movimientos" subtitle="Los movimientos aparecerán aquí" />
          ) : (
            <>
              <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                style={{ gridTemplateColumns: '80px 1fr 1fr 1fr 90px' }}>
                <span>Tipo</span><span>Concepto</span><span>Método</span><span>Fecha</span><span className="text-right">Monto</span>
              </div>
              <div className="divide-y divide-border max-h-[460px] overflow-y-auto">
                {movements.map((m, i) => (
                  <div key={i}
                    className={cn('row-alt grid items-center px-4 py-3 text-sm', m.sale_id && 'cursor-pointer hover:bg-white/[0.03]')}
                    onClick={() => m.sale_id && api.sales.get(m.sale_id).then(setSaleDetail)}>
                    <span className={cn('flex items-center gap-1.5 text-xs font-medium',
                      m.type === 'ingreso' ? 'text-green-400' : 'text-red-400')}>
                      {m.type === 'ingreso' ? <ArrowUpCircle size={13} /> : <ArrowDownCircle size={13} />}
                      {m.type}
                    </span>
                    <span className="text-zinc-300">
                      {m.concept === 'venta'
                        ? <span>{m.concept}{m.client_name ? ` — ${m.client_name}` : ''}{m.seller_name ? ` (${m.seller_name})` : ''}</span>
                        : m.concept}
                    </span>
                    <span className="text-zinc-500 text-xs">{m.payment_method}</span>
                    <span className="text-zinc-500 text-xs">{formatDateTime(m.created_at)}</span>
                    <span className={cn('text-right font-medium tabular-nums', m.type === 'ingreso' ? 'text-green-400' : 'text-red-400')}>
                      {m.type === 'egreso' ? '-' : '+'}{formatCurrency(m.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
            style={{ gridTemplateColumns: '60px 1fr 1fr 1fr 1fr 1fr 44px' }}>
            <span>#</span><span>Apertura</span><span>Cierre</span><span className="text-right">Inicial</span><span className="text-right">Real</span><span className="text-right">Diferencia</span><span></span>
          </div>
          <div className="divide-y divide-border">
            {hLoading ? <SkeletonTable rows={5} cols={7} />
              : history.cashboxes.map(c => (
                <div key={c.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '60px 1fr 1fr 1fr 1fr 1fr 44px' }}>
                  <span className="text-zinc-600 font-mono">#{c.id}</span>
                  <span className="text-zinc-300">{formatDateTime(c.opened_at)}</span>
                  <span className="text-zinc-400">{c.closed_at ? formatDateTime(c.closed_at) : <span className="text-green-400 text-xs">Abierta</span>}</span>
                  <span className="text-right tabular-nums text-zinc-300">{formatCurrency(c.opening_cash)}</span>
                  <span className="text-right tabular-nums text-zinc-300">{c.real_cash != null ? formatCurrency(c.real_cash) : '—'}</span>
                  <span className={cn('text-right tabular-nums font-medium', c.difference == null ? 'text-zinc-600' : c.difference >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {c.difference != null ? formatCurrency(c.difference) : '—'}
                  </span>
                  {c.closed_at ? (
                    <button onClick={() => printClosingReport(c.id)} title="Imprimir informe"
                      className="no-drag flex items-center justify-center text-zinc-600 hover:text-zinc-300 transition-colors">
                      <Printer size={14} />
                    </button>
                  ) : <span />}
                </div>
              ))}
          </div>
          <Pagination page={hPage} pages={history.pages} total={history.total} limit={20} onChange={setHPage} />
        </div>
      )}

      {/* Open modal */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title="Abrir caja" width="max-w-sm">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Turno</label>
            <div className="flex gap-2 flex-wrap">
              {shiftOptions.map(s => (
                <button key={s} onClick={() => setOpenShift(s)}
                  className={cn('px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                    openShift === s ? 'bg-accent/10 border-accent text-accent' : 'border-border text-zinc-500 hover:text-zinc-300')}>
                  {s}
                </button>
              ))}
              <button onClick={() => setOpenShift('')}
                className={cn('px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                  openShift === '' ? 'bg-zinc-700 border-zinc-600 text-zinc-200' : 'border-border text-zinc-600 hover:text-zinc-400')}>
                Sin turno
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Efectivo inicial $</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={openCash} onChange={e => setOpenCash(e.target.value)} placeholder="0,00" autoFocus />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setOpenModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleOpen} disabled={processing} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">{processing ? 'Abriendo...' : 'Abrir caja'}</button>
        </div>
      </Modal>

      {/* Close modal */}
      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Cerrar caja" width="max-w-lg">
        <div className="space-y-5">
          {summary?.byMethod?.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">Recuento por medio de pago</p>
              <div className="space-y-1.5">
                <div className="grid text-[10px] text-zinc-600 uppercase px-3 mb-1" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                  <span>Método</span><span className="text-right">Sistema</span><span className="text-right">Real</span><span className="text-right">Diferencia</span>
                </div>
                {summary.byMethod.map(m => {
                  const raw = paymentRealAmounts[m.payment_method] ?? ''
                  const realNum = raw !== '' ? Number(raw) : null
                  const diff = realNum !== null ? realNum - m.total : null
                  return (
                    <div key={m.payment_method} className="grid items-center gap-2 bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                      <span className="text-sm text-white font-medium">{m.payment_method}</span>
                      <span className="text-right text-sm tabular-nums text-zinc-400">{formatCurrency(m.total)}</span>
                      <input
                        type="number" min="0" step="0.01" placeholder="—"
                        value={raw}
                        onChange={e => setPaymentRealAmounts(prev => ({ ...prev, [m.payment_method]: e.target.value }))}
                        className="input-field w-full bg-surface border border-border rounded px-2 py-1 text-sm text-right text-white no-drag"
                      />
                      <span className={cn('text-right text-sm tabular-nums font-medium',
                        diff === null ? 'text-zinc-700' : diff >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {diff === null ? '—' : `${diff >= 0 ? '+' : ''}${formatCurrency(diff)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {summary && (
            <div className="bg-[#0a0a0a] border border-border rounded-xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between text-zinc-500 text-xs">
                <span>Ventas del día (efectivo):</span>
                <span>{formatCurrency(summary.byMethod?.find(m => m.payment_method === 'Efectivo')?.total || 0)}</span>
              </div>
              {(summary.manualIngresos > 0) && (
                <div className="flex justify-between text-zinc-500 text-xs">
                  <span>Ingresos manuales (efectivo):</span>
                  <span className="text-green-400">+{formatCurrency(summary.manualIngresos)}</span>
                </div>
              )}
              {(summary.manualEgresos > 0) && (
                <div className="flex justify-between text-zinc-500 text-xs">
                  <span>Egresos manuales (efectivo):</span>
                  <span className="text-red-400">-{formatCurrency(summary.manualEgresos)}</span>
                </div>
              )}
              {(summary.expenses?.total > 0) && (
                <div className="flex justify-between text-zinc-500 text-xs">
                  <span>Gastos:</span>
                  <span className="text-red-400">-{formatCurrency(summary.expenses.total)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border/50 pt-1.5">
                <span className="text-zinc-400">Efectivo esperado en caja:</span>
                <span className="text-white font-bold">{formatCurrency(summary.expectedCash)}</span>
              </div>
              {(() => {
                const raw = paymentRealAmounts['Efectivo']
                if (raw === '' || raw === undefined) return null
                const diff = Number(raw) - summary.expectedCash
                return (
                  <div className={cn('flex justify-between font-medium', diff >= 0 ? 'text-green-400' : 'text-red-400')}>
                    <span>Diferencia efectivo:</span>
                    <span>{diff >= 0 ? '+' : ''}{formatCurrency(diff)}</span>
                  </div>
                )
              })()}
            </div>
          )}

          {commLoading ? (
            <div className="py-2 text-xs text-zinc-500 animate-pulse">Calculando comisiones...</div>
          ) : commissions.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Comisiones a pagar</p>
              <div className="space-y-1.5">
                {commissions.map(c => (
                  <div key={c.seller_name} className="flex items-center justify-between bg-[#0a0a0a] border border-border rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm text-white">{c.seller_name}</span>
                      <span className="text-xs text-zinc-500 ml-2">{c.sale_count} ventas · {c.commission_rate}%</span>
                    </div>
                    <span className="text-sm font-semibold text-accent tabular-nums">{formatCurrency(c.commission_amount)}</span>
                  </div>
                ))}
                {commissions.length > 1 && (
                  <div className="flex items-center justify-between px-3 py-1">
                    <span className="text-xs text-zinc-500">Total comisiones</span>
                    <span className="text-sm font-bold text-accent tabular-nums">
                      {formatCurrency(commissions.reduce((s, c) => s + c.commission_amount, 0))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Notas</label>
            <input className={inputCls} value={closeNotes} onChange={e => setCloseNotes(e.target.value)} placeholder="Observaciones..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setCloseModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleClose} disabled={processing} className="no-drag px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg font-medium disabled:opacity-50">
            {processing ? 'Cerrando...' : 'Cerrar caja'}
          </button>
        </div>
      </Modal>

      {/* Movement modal */}
      <Modal open={movementModal} onClose={() => setMovementModal(false)} title="Nuevo movimiento" width="max-w-sm">
        <div className="space-y-4">
          <div className="flex gap-2">
            {['ingreso', 'egreso'].map(t => (
              <button key={t} onClick={() => setMovForm(f => ({ ...f, type: t }))}
                className={cn('flex-1 py-2 rounded-lg text-sm border capitalize transition-colors',
                  movForm.type === t
                    ? t === 'ingreso' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
                    : 'border-border text-zinc-500 hover:text-zinc-200')}>
                {t}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Concepto</label>
            <input className={inputCls} value={movForm.concept} onChange={e => setMovForm(f => ({ ...f, concept: e.target.value }))} placeholder="Ej: Retiro de efectivo..." autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Monto $</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={movForm.amount} onChange={e => setMovForm(f => ({ ...f, amount: e.target.value }))} placeholder="0,00" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Método</label>
              <select className={inputCls} value={movForm.paymentMethod} onChange={e => setMovForm(f => ({ ...f, paymentMethod: e.target.value }))}>
                {['Efectivo', 'Transferencia', 'Tarjeta Débito', 'Tarjeta Crédito', 'Mercado Pago'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setMovementModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleAddMovement} disabled={processing} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">{processing ? 'Guardando...' : 'Registrar'}</button>
        </div>
      </Modal>

      {/* Sale detail modal */}
      {saleDetail && (
        <Modal open={!!saleDetail} onClose={() => setSaleDetail(null)} title={`Venta ${saleDetail.sale_number || '#' + saleDetail.id}`} width="max-w-md">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-zinc-400"><span>Fecha:</span><span>{formatDateTime(saleDetail.created_at)}</span></div>
            <div className="flex justify-between text-zinc-400"><span>Cliente:</span><span>{saleDetail.client_name || '—'}</span></div>
            <div className="flex justify-between text-zinc-400"><span>Método:</span><span>{saleDetail.payment_method}{saleDetail.installments > 1 ? ` ${saleDetail.installments} cuotas` : ''}</span></div>
            {saleDetail.seller_name && <div className="flex justify-between text-zinc-400"><span>Vendedora:</span><span>{saleDetail.seller_name}</span></div>}
            <div className="border-t border-border pt-2 divide-y divide-border">
              {saleDetail.items?.map((it, i) => (
                <div key={i} className="flex justify-between py-2">
                  <span className="text-zinc-300">{it.product_name} T.{it.size} x{it.quantity}</span>
                  <span className="text-white tabular-nums">{formatCurrency(it.unit_price * it.quantity)}</span>
                </div>
              ))}
            </div>
            {saleDetail.discount > 0 && <div className="flex justify-between text-zinc-400"><span>Descuento:</span><span className="text-red-400">-{formatCurrency(saleDetail.discount)}</span></div>}
            <div className="flex justify-between font-bold text-base border-t border-border pt-2"><span className="text-white">TOTAL</span><span className="text-accent">{formatCurrency(saleDetail.total)}</span></div>
          </div>
        </Modal>
      )}
    </motion.div>
  )
}
