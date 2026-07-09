import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Vault, ArrowUpCircle, ArrowDownCircle, ClipboardCheck, Printer,
  TrendingUp, TrendingDown, Landmark, Store, Filter, History, Lock, Unlock,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import Modal from '@/components/shared/Modal'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const fmtMonth = (ym) => {
  const [y, m] = (ym || '').split('-')
  return `${MONTHS_ES[Number(m) - 1] || ''} ${y || ''}`.trim()
}

const INGRESO_CATS = ['Depósito en efectivo', 'Aporte de socio', 'Otros ingresos', 'General']
const EGRESO_CATS  = ['Pago a proveedor', 'Retiro del dueño', 'Gastos varios', 'Depósito bancario', 'General']

function buildReportHTML(data, biz, rangeLabel) {
  const { movements, totalIngresos, totalEgresos, periodBalance, balance } = data
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const fmtDate = s => s ? new Date(s).toLocaleString('es-AR') : '—'
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Informe Caja Grande</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:24px}
  h1{font-size:20px;font-weight:bold;margin-bottom:2px}
  h2{font-size:12px;font-weight:bold;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #333;text-transform:uppercase;letter-spacing:.5px}
  .biz-info{color:#555;margin-bottom:16px}.biz-info p{margin:2px 0}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px}
  th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:10px;text-transform:uppercase;color:#555}
  td{padding:4px 8px;border-bottom:1px solid #eee}
  .r{text-align:right}.total-row td{font-weight:bold;background:#f9f9f9}
  .grn{color:#16a34a}.red{color:#dc2626}
  .sb{border:1px solid #ccc;border-radius:4px;padding:12px;margin-bottom:16px}
  .sr{display:flex;justify-content:space-between;padding:3px 0}
  .sr.bold{font-weight:bold;font-size:14px;border-top:1px solid #ccc;padding-top:6px;margin-top:4px}
  .footer{margin-top:24px;padding-top:8px;border-top:1px solid #ddd;color:#999;font-size:10px;text-align:center}
  .print-btn{margin-top:16px;padding:8px 20px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer}
  @media print{.print-btn{display:none}@page{size:A4;margin:15mm}}
</style></head><body>
${biz.business_logo ? `<img src="${biz.business_logo}" style="height:50px;object-fit:contain;display:block;margin-bottom:8px" alt="logo">` : ''}
<h1>${biz.business_name || 'DELPA'}</h1>
<div class="biz-info">
  ${biz.business_address ? `<p>${biz.business_address}</p>` : ''}
  ${biz.business_phone ? `<p>Tel: ${biz.business_phone}</p>` : ''}
</div>
<h2>Informe de Caja Grande${rangeLabel ? ` — ${rangeLabel}` : ''}</h2>
<div class="sb">
  <div class="sr"><span>Ingresos del período:</span><span class="grn">${fmt(totalIngresos)}</span></div>
  <div class="sr"><span>Egresos del período:</span><span class="red">-${fmt(totalEgresos)}</span></div>
  <div class="sr bold ${periodBalance >= 0 ? 'grn' : 'red'}"><span>Saldo del período:</span><span>${fmt(periodBalance)}</span></div>
  <div class="sr" style="margin-top:6px"><span>Saldo actual total de la caja:</span><span><strong>${fmt(balance)}</strong></span></div>
</div>
<h2>Movimientos (${movements.length})</h2>
<table>
  <thead><tr><th>Fecha</th><th>Tipo</th><th>Origen</th><th>Categoría</th><th>Descripción</th><th class="r">Monto</th></tr></thead>
  <tbody>
    ${movements.map(m => `<tr>
      <td>${fmtDate(m.created_at)}</td>
      <td style="color:${m.type === 'ingreso' ? '#16a34a' : '#dc2626'}">${m.type}</td>
      <td>${m.source === 'caja_chica' ? 'Caja chica' : 'Manual'}</td>
      <td>${m.category || '—'}</td>
      <td>${m.description || '—'}</td>
      <td class="r ${m.type === 'ingreso' ? 'grn' : 'red'}">${m.type === 'egreso' ? '-' : '+'}${fmt(m.amount)}</td>
    </tr>`).join('')}
    <tr class="total-row"><td colspan="5">TOTAL INGRESOS</td><td class="r grn">${fmt(totalIngresos)}</td></tr>
    <tr class="total-row"><td colspan="5">TOTAL EGRESOS</td><td class="r red">-${fmt(totalEgresos)}</td></tr>
  </tbody>
</table>
<button class="print-btn" onclick="window.print()">Imprimir</button>
<div class="footer">Generado por DELPA Gestión PRO · ${new Date().toLocaleString('es-AR')}</div>
</body></html>`
}

export default function MainCashBox() {
  const { user } = useAuth()
  const createdBy = user?.username || ''

  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('movimientos')
  const [movements, setMovements] = useState([])
  const [movLoading, setMovLoading] = useState(false)
  const [audits, setAudits] = useState([])
  const [monthly, setMonthly] = useState([])
  const [sessions, setSessions] = useState([])
  const [biz, setBiz] = useState({})

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [movModal, setMovModal] = useState(false)
  const [movForm, setMovForm] = useState({ type: 'ingreso', category: 'Depósito en efectivo', amount: '', description: '' })
  const [auditModal, setAuditModal] = useState(false)
  const [auditForm, setAuditForm] = useState({ counted: '', notes: '' })
  const [openModal, setOpenModal] = useState(false)
  const [openForm, setOpenForm] = useState({ counted: '', notes: '' })
  const [closeModal, setCloseModal] = useState(false)
  const [closeForm, setCloseForm] = useState({ counted: '', notes: '' })
  const [processing, setProcessing] = useState(false)

  const opening = balance?.opening || null

  const loadBalance = useCallback(async () => {
    try { setBalance(await api.mainCashbox.balance()) } catch { setBalance(null) }
  }, [])

  const loadMovements = useCallback(async () => {
    setMovLoading(true)
    try { setMovements(await api.mainCashbox.movements({ from: from || undefined, to: to || undefined })) }
    finally { setMovLoading(false) }
  }, [from, to])

  const loadAudits = useCallback(async () => {
    try { setAudits(await api.mainCashbox.audits({ limit: 50 })) } catch { setAudits([]) }
  }, [])

  const loadMonthly = useCallback(async () => {
    try { setMonthly(await api.mainCashbox.monthlySummary({ months: 6 })) } catch { setMonthly([]) }
  }, [])

  const loadSessions = useCallback(async () => {
    try { setSessions(await api.mainCashbox.sessions({ limit: 50 })) } catch { setSessions([]) }
  }, [])

  useEffect(() => {
    (async () => {
      setLoading(true)
      await Promise.all([loadBalance(), loadMovements()])
      setLoading(false)
    })()
    api.settings.getAll().then(setBiz).catch(() => {})
  }, [loadBalance, loadMovements])

  useEffect(() => { if (tab === 'movimientos') loadMovements() }, [tab, loadMovements])
  useEffect(() => { if (tab === 'arqueos') loadAudits() }, [tab, loadAudits])
  useEffect(() => { if (tab === 'reportes') loadMonthly() }, [tab, loadMonthly])
  useEffect(() => { if (tab === 'historial') loadSessions() }, [tab, loadSessions])

  const openMovModal = (type) => {
    setMovForm({ type, category: type === 'ingreso' ? 'Depósito en efectivo' : 'Pago a proveedor', amount: '', description: '' })
    setMovModal(true)
  }

  const handleAddMovement = async () => {
    if (!movForm.description.trim()) return toast.error('Ingresá un concepto')
    if (!movForm.amount || Number(movForm.amount) <= 0) return toast.error('Monto inválido')
    setProcessing(true)
    try {
      await api.mainCashbox.addMovement({
        type: movForm.type,
        category: movForm.category,
        amount: Number(movForm.amount),
        description: movForm.description.trim(),
        createdBy,
      })
      toast.success(movForm.type === 'ingreso' ? 'Ingreso registrado' : 'Egreso registrado')
      setMovModal(false)
      loadBalance(); loadMovements()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const handleAudit = async () => {
    if (auditForm.counted === '' || isNaN(Number(auditForm.counted))) return toast.error('Ingresá el efectivo contado')
    setProcessing(true)
    try {
      const res = await api.mainCashbox.audit({ countedAmount: Number(auditForm.counted), notes: auditForm.notes, createdBy })
      const diff = res.difference
      if (diff === 0) toast.success('Arqueo OK — sin diferencias')
      else toast[diff > 0 ? 'success' : 'error'](`Arqueo registrado. Diferencia: ${diff >= 0 ? '+' : ''}${formatCurrency(diff)}`)
      setAuditModal(false)
      setAuditForm({ counted: '', notes: '' })
      loadAudits()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const handleOpen = async () => {
    if (openForm.counted === '' || isNaN(Number(openForm.counted))) return toast.error('Ingresá el saldo físico contado')
    setProcessing(true)
    try {
      const res = await api.mainCashbox.open({ countedAmount: Number(openForm.counted), notes: openForm.notes, createdBy })
      toast.success(res.difference === 0 ? 'Caja Grande abierta' : `Caja Grande abierta. Diferencia de apertura: ${res.difference >= 0 ? '+' : ''}${formatCurrency(res.difference)}`)
      setOpenModal(false)
      setOpenForm({ counted: '', notes: '' })
      loadBalance()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const handleCloseSession = async () => {
    if (closeForm.counted === '' || isNaN(Number(closeForm.counted))) return toast.error('Ingresá el saldo físico contado')
    setProcessing(true)
    try {
      const res = await api.mainCashbox.close({ countedAmount: Number(closeForm.counted), notes: closeForm.notes, createdBy })
      toast.success(res.difference === 0 ? 'Caja Grande cerrada — sin diferencias' : `Caja Grande cerrada. Diferencia: ${res.difference >= 0 ? '+' : ''}${formatCurrency(res.difference)}`)
      setCloseModal(false)
      setCloseForm({ counted: '', notes: '' })
      loadBalance(); loadMovements()
      if (tab === 'historial') loadSessions()
    } catch (e) { toast.error(e.message) }
    finally { setProcessing(false) }
  }

  const printReport = async () => {
    try {
      const [data, bizData] = await Promise.all([
        api.mainCashbox.report({ from: from || undefined, to: to || undefined }),
        api.settings.getAll(),
      ])
      const rangeLabel = from || to ? `${from || '...'} a ${to || '...'}` : 'Histórico completo'
      const w = window.open('', '_blank', 'width=960,height=700')
      w.document.write(buildReportHTML(data, bizData, rangeLabel))
      w.document.close(); w.focus()
    } catch { toast.error('Error al generar informe') }
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'

  // Diferencia esperada en el modal de arqueo
  const auditDiff = (() => {
    if (auditForm.counted === '' || isNaN(Number(auditForm.counted)) || !balance) return null
    return Number(auditForm.counted) - balance.balance
  })()
  const openDiff = (() => {
    if (openForm.counted === '' || isNaN(Number(openForm.counted)) || !balance) return null
    return Number(openForm.counted) - balance.balance
  })()
  const closeDiff = (() => {
    if (closeForm.counted === '' || isNaN(Number(closeForm.counted)) || !balance) return null
    return Number(closeForm.counted) - balance.balance
  })()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader
        title="Caja Grande"
        subtitle="Caja central acumulada del local"
        actions={
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => openMovModal('ingreso')} className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-green-600/90 hover:bg-green-500 text-white font-medium transition-colors">
              <ArrowUpCircle size={15} /> Nuevo ingreso
            </button>
            <button onClick={() => openMovModal('egreso')} className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-red-600/90 hover:bg-red-500 text-white font-medium transition-colors">
              <ArrowDownCircle size={15} /> Nuevo egreso
            </button>
            <button onClick={() => { setAuditForm({ counted: '', notes: '' }); setAuditModal(true) }} className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors">
              <ClipboardCheck size={15} /> Arquear
            </button>
            {opening ? (
              <button onClick={() => { setCloseForm({ counted: '', notes: '' }); setCloseModal(true) }} className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium transition-colors">
                <Lock size={15} /> Cerrar caja grande
              </button>
            ) : (
              <button onClick={() => { setOpenForm({ counted: '', notes: '' }); setOpenModal(true) }} className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-accent hover:bg-accent/90 text-black font-medium transition-colors">
                <Unlock size={15} /> Abrir caja grande
              </button>
            )}
          </div>
        }
      />

      {/* Saldo principal + desglose */}
      {loading || !balance ? (
        <div className="py-8"><SkeletonTable rows={3} cols={4} /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
              className="lg:col-span-1 bg-gradient-to-br from-accent/20 via-card to-card border border-accent/30 rounded-2xl p-6 flex flex-col justify-center"
            >
              <div className="flex items-center gap-2 mb-2">
                <Vault size={18} className="text-accent" />
                <p className="text-xs text-zinc-400 uppercase tracking-wider">Saldo actual total</p>
              </div>
              <p className="text-4xl font-bold text-white tabular-nums leading-tight">{formatCurrency(balance.balance)}</p>
              <p className="text-[11px] text-zinc-600 mt-2">
                {balance.totalMovimientos} movimientos
                {balance.lastUpdated ? ` · act. ${formatDateTime(balance.lastUpdated)}` : ''}
              </p>
            </motion.div>

            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: 'Ingresos desde cajas chicas', value: balance.ingresosCajaChica, icon: Store, color: 'text-green-400', border: 'border-green-900/30' },
                { label: 'Ingresos manuales', value: balance.ingresosManual, icon: TrendingUp, color: 'text-blue-400', border: 'border-blue-900/30' },
                { label: 'Egresos manuales', value: balance.egresosManual, icon: TrendingDown, color: 'text-red-400', border: 'border-red-900/30' },
              ].map(({ label, value, icon: Icon, color, border }) => (
                <div key={label} className={cn('bg-card border rounded-xl p-4 flex flex-col', border)}>
                  <div className={cn('w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center mb-3', color)}>
                    <Icon size={17} />
                  </div>
                  <p className="text-[11px] text-zinc-500 uppercase tracking-wider leading-tight">{label}</p>
                  <p className={cn('text-xl font-bold tabular-nums mt-1', color)}>{formatCurrency(value)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Banner apertura activa */}
          {opening && (
            <div className="mb-5 flex flex-wrap items-center gap-3 bg-[#0a0a0a] border border-border rounded-xl px-4 py-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-green-400 font-medium">
                <Unlock size={13} /> Caja abierta
              </span>
              <span className="text-xs text-zinc-500">desde {formatDateTime(opening.opened_at)}</span>
              <span className="text-xs text-zinc-500">· Apertura contada: <span className="text-zinc-300">{formatCurrency(opening.opening_balance_real)}</span></span>
              {opening.opening_difference !== 0 && (
                <span className="text-xs font-medium text-amber-400 ml-auto">
                  Diferencia de apertura: {opening.opening_difference >= 0 ? '+' : ''}{formatCurrency(opening.opening_difference)}
                </span>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-border mb-5">
            {[
              { id: 'movimientos', label: 'Movimientos' },
              { id: 'arqueos', label: 'Arqueos' },
              { id: 'historial', label: 'Historial' },
              { id: 'reportes', label: 'Reportes' },
            ].map(({ id, label }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn('px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
                  tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
                {label}
              </button>
            ))}
          </div>

          {/* Movimientos */}
          {tab === 'movimientos' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex items-center gap-2 text-zinc-500 text-xs"><Filter size={13} /> Filtrar por fecha:</div>
                <div>
                  <label className="text-[10px] text-zinc-600 uppercase block mb-1">Desde</label>
                  <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={cn(inputCls, 'w-auto')} />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-600 uppercase block mb-1">Hasta</label>
                  <input type="date" value={to} onChange={e => setTo(e.target.value)} className={cn(inputCls, 'w-auto')} />
                </div>
                {(from || to) && (
                  <button onClick={() => { setFrom(''); setTo('') }} className="text-xs text-zinc-500 hover:text-white px-3 py-2">Limpiar</button>
                )}
                <button onClick={printReport} className="ml-auto no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
                  <Printer size={14} /> Imprimir informe
                </button>
              </div>

              <div className="bg-card border border-border rounded-xl overflow-hidden">
                {movLoading ? <SkeletonTable rows={6} cols={5} />
                  : movements.length === 0 ? (
                    <EmptyState icon={History} title="Sin movimientos" subtitle="Los ingresos y egresos de la caja grande aparecerán acá" />
                  ) : (
                    <>
                      <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                        style={{ gridTemplateColumns: '150px 90px 110px 1fr 130px' }}>
                        <span>Fecha</span><span>Tipo</span><span>Origen</span><span>Concepto</span><span className="text-right">Monto</span>
                      </div>
                      <div className="divide-y divide-border max-h-[460px] overflow-y-auto">
                        {movements.map(m => (
                          <div key={m.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '150px 90px 110px 1fr 130px' }}>
                            <span className="text-zinc-500 text-xs">{formatDateTime(m.created_at)}</span>
                            <span className={cn('flex items-center gap-1.5 text-xs font-medium', m.type === 'ingreso' ? 'text-green-400' : 'text-red-400')}>
                              {m.type === 'ingreso' ? <ArrowUpCircle size={13} /> : <ArrowDownCircle size={13} />}{m.type}
                            </span>
                            <span className="text-xs">
                              {m.source === 'caja_chica'
                                ? <span className="inline-flex items-center gap-1 text-accent"><Store size={11} /> Caja chica</span>
                                : <span className="text-zinc-500">Manual</span>}
                            </span>
                            <span className="text-zinc-300 truncate pr-2">
                              {m.description}
                              {m.category && m.category !== 'General' && <span className="text-zinc-600 text-xs ml-1">· {m.category}</span>}
                            </span>
                            <span className={cn('text-right font-medium tabular-nums', m.type === 'ingreso' ? 'text-green-400' : 'text-red-400')}>
                              {m.type === 'egreso' ? '-' : '+'}{formatCurrency(m.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
              </div>
            </div>
          )}

          {/* Arqueos */}
          {tab === 'arqueos' && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {audits.length === 0 ? (
                <EmptyState icon={ClipboardCheck} title="Sin arqueos" subtitle="Registrá un arqueo para controlar el efectivo físico vs el saldo esperado" />
              ) : (
                <>
                  <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                    style={{ gridTemplateColumns: '150px 1fr 1fr 1fr 1fr' }}>
                    <span>Fecha</span><span className="text-right">Esperado</span><span className="text-right">Contado</span><span className="text-right">Diferencia</span><span>Usuario</span>
                  </div>
                  <div className="divide-y divide-border">
                    {audits.map(a => (
                      <div key={a.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '150px 1fr 1fr 1fr 1fr' }}>
                        <span className="text-zinc-500 text-xs">{formatDateTime(a.created_at)}</span>
                        <span className="text-right tabular-nums text-zinc-300">{formatCurrency(a.expected_balance)}</span>
                        <span className="text-right tabular-nums text-white">{formatCurrency(a.counted_amount)}</span>
                        <span className={cn('text-right tabular-nums font-medium', a.difference === 0 ? 'text-zinc-400' : a.difference > 0 ? 'text-green-400' : 'text-red-400')}>
                          {a.difference >= 0 ? '+' : ''}{formatCurrency(a.difference)}
                        </span>
                        <span className="text-zinc-500 text-xs truncate">{a.created_by || '—'}{a.notes ? ` · ${a.notes}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Historial de aperturas y cierres */}
          {tab === 'historial' && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {sessions.length === 0 ? (
                <EmptyState icon={History} title="Sin aperturas/cierres" subtitle="El historial de aperturas y cierres de la caja grande aparecerá acá" />
              ) : (
                <>
                  <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                    style={{ gridTemplateColumns: '150px 150px 90px 1fr 1fr 1fr' }}>
                    <span>Apertura</span><span>Cierre</span><span>Estado</span><span className="text-right">Esperado</span><span className="text-right">Contado</span><span className="text-right">Diferencia</span>
                  </div>
                  <div className="divide-y divide-border max-h-[460px] overflow-y-auto">
                    {sessions.map(sn => {
                      const isOpen = sn.status === 'open'
                      const expected = isOpen ? sn.opening_balance_expected : sn.closing_balance_expected
                      const real = isOpen ? sn.opening_balance_real : sn.closing_balance_real
                      const diff = isOpen ? sn.opening_difference : sn.closing_difference
                      return (
                        <div key={sn.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '150px 150px 90px 1fr 1fr 1fr' }}>
                          <span className="text-zinc-400 text-xs">{formatDateTime(sn.opened_at)}</span>
                          <span className="text-zinc-400 text-xs">{sn.closed_at ? formatDateTime(sn.closed_at) : '—'}</span>
                          <span className={cn('text-xs font-medium', isOpen ? 'text-green-400' : 'text-zinc-500')}>{isOpen ? 'Abierta' : 'Cerrada'}</span>
                          <span className="text-right tabular-nums text-zinc-300">{expected != null ? formatCurrency(expected) : '—'}</span>
                          <span className="text-right tabular-nums text-white">{real != null ? formatCurrency(real) : '—'}</span>
                          <span className={cn('text-right tabular-nums font-medium', diff == null ? 'text-zinc-600' : diff === 0 ? 'text-green-400' : diff > 0 ? 'text-green-400' : 'text-red-400')}>
                            {diff == null ? '—' : `${diff >= 0 ? '+' : ''}${formatCurrency(diff)}`}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Reportes */}
          {tab === 'reportes' && (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Landmark size={15} className="text-accent" />
                  <h3 className="text-sm font-medium text-white">Comparativa mes a mes — últimos 6 meses</h3>
                </div>
                {monthly.length === 0 ? (
                  <EmptyState icon={Landmark} title="Sin datos" subtitle="Todavía no hay movimientos para comparar" />
                ) : (
                  <>
                    <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
                      style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                      <span>Mes</span><span className="text-right">Ingresos</span><span className="text-right">Egresos</span><span className="text-right">Saldo del mes</span>
                    </div>
                    <div className="divide-y divide-border">
                      {monthly.map(r => (
                        <div key={r.month} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                          <span className="text-zinc-200 capitalize">{fmtMonth(r.month)}</span>
                          <span className="text-right tabular-nums text-green-400">+{formatCurrency(r.ingresos)}</span>
                          <span className="text-right tabular-nums text-red-400">-{formatCurrency(r.egresos)}</span>
                          <span className={cn('text-right tabular-nums font-medium', r.saldo >= 0 ? 'text-white' : 'text-red-400')}>{formatCurrency(r.saldo)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button onClick={printReport} className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
                <Printer size={14} /> Exportar historial a PDF
              </button>
            </div>
          )}
        </>
      )}

      {/* Modal movimiento manual */}
      <Modal open={movModal} onClose={() => setMovModal(false)} title={movForm.type === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo egreso'} width="max-w-sm">
        <div className="space-y-4">
          <div className="flex gap-2">
            {['ingreso', 'egreso'].map(t => (
              <button key={t} onClick={() => setMovForm(f => ({ ...f, type: t, category: t === 'ingreso' ? 'Depósito en efectivo' : 'Pago a proveedor' }))}
                className={cn('flex-1 py-2 rounded-lg text-sm border capitalize transition-colors',
                  movForm.type === t
                    ? t === 'ingreso' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
                    : 'border-border text-zinc-500 hover:text-zinc-200')}>
                {t}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Categoría</label>
            <select className={inputCls} value={movForm.category} onChange={e => setMovForm(f => ({ ...f, category: e.target.value }))}>
              {(movForm.type === 'ingreso' ? INGRESO_CATS : EGRESO_CATS).map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Concepto</label>
            <input className={inputCls} value={movForm.description} onChange={e => setMovForm(f => ({ ...f, description: e.target.value }))} placeholder="Ej: Depósito del turno mañana..." autoFocus />
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Monto $</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={movForm.amount} onChange={e => setMovForm(f => ({ ...f, amount: e.target.value }))} placeholder="0,00" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setMovModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleAddMovement} disabled={processing}
            className={cn('no-drag px-5 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-50',
              movForm.type === 'ingreso' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500')}>
            {processing ? 'Guardando...' : 'Registrar'}
          </button>
        </div>
      </Modal>

      {/* Modal arqueo */}
      <Modal open={auditModal} onClose={() => setAuditModal(false)} title="Arqueo de Caja Grande" width="max-w-sm">
        <div className="space-y-4">
          <div className="bg-[#0a0a0a] border border-border rounded-lg px-4 py-3 flex justify-between items-center">
            <span className="text-sm text-zinc-400">Saldo esperado</span>
            <span className="text-lg font-bold text-white tabular-nums">{formatCurrency(balance?.balance || 0)}</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Efectivo físico contado $</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={auditForm.counted} onChange={e => setAuditForm(f => ({ ...f, counted: e.target.value }))} placeholder="0,00" autoFocus />
          </div>
          {auditDiff !== null && (
            <div className={cn('flex justify-between items-center px-4 py-3 rounded-lg border text-sm font-medium',
              auditDiff === 0 ? 'bg-zinc-500/5 border-border text-zinc-300' : auditDiff > 0 ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400')}>
              <span>Diferencia</span>
              <span className="tabular-nums">{auditDiff >= 0 ? '+' : ''}{formatCurrency(auditDiff)}</span>
            </div>
          )}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Notas</label>
            <input className={inputCls} value={auditForm.notes} onChange={e => setAuditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observaciones..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setAuditModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleAudit} disabled={processing} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">{processing ? 'Registrando...' : 'Registrar arqueo'}</button>
        </div>
      </Modal>

      {/* Modal apertura */}
      <Modal open={openModal} onClose={() => setOpenModal(false)} title="Apertura de Caja Grande" width="max-w-sm">
        <div className="space-y-4">
          <div className="bg-[#0a0a0a] border border-border rounded-lg px-4 py-3 flex justify-between items-center">
            <span className="text-sm text-zinc-400">Saldo esperado (sistema)</span>
            <span className="text-lg font-bold text-white tabular-nums">{formatCurrency(balance?.balance || 0)}</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Saldo físico contado al abrir $</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={openForm.counted} onChange={e => setOpenForm(f => ({ ...f, counted: e.target.value }))} placeholder="0,00" autoFocus />
          </div>
          {openDiff !== null && openDiff !== 0 && (
            <div className="flex justify-between items-center px-4 py-3 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-400 text-sm font-medium">
              <span>Diferencia de apertura</span>
              <span className="tabular-nums">{openDiff >= 0 ? '+' : ''}{formatCurrency(openDiff)}</span>
            </div>
          )}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Notas</label>
            <input className={inputCls} value={openForm.notes} onChange={e => setOpenForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observaciones..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setOpenModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleOpen} disabled={processing} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">{processing ? 'Abriendo...' : 'Abrir caja grande'}</button>
        </div>
      </Modal>

      {/* Modal cierre */}
      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="Cierre de Caja Grande" width="max-w-sm">
        <div className="space-y-4">
          <div className="bg-[#0a0a0a] border border-border rounded-lg px-4 py-3 flex justify-between items-center">
            <span className="text-sm text-zinc-400">Saldo esperado (sistema)</span>
            <span className="text-lg font-bold text-white tabular-nums">{formatCurrency(balance?.balance || 0)}</span>
          </div>
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Saldo físico contado al cerrar $</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={closeForm.counted} onChange={e => setCloseForm(f => ({ ...f, counted: e.target.value }))} placeholder="0,00" autoFocus />
          </div>
          {closeDiff !== null && (
            <div className={cn('flex justify-between items-center px-4 py-3 rounded-lg border text-sm font-medium',
              closeDiff === 0 ? 'bg-zinc-500/5 border-border text-zinc-300' : closeDiff > 0 ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400')}>
              <span>Diferencia</span>
              <span className="tabular-nums">{closeDiff >= 0 ? '+' : ''}{formatCurrency(closeDiff)}</span>
            </div>
          )}
          {closeDiff !== null && closeDiff !== 0 && (
            <p className="text-[11px] text-zinc-600">Se registrará un movimiento de ajuste de {formatCurrency(Math.abs(closeDiff))} para que el saldo refleje el conteo físico.</p>
          )}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Observaciones</label>
            <input className={inputCls} value={closeForm.notes} onChange={e => setCloseForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observaciones..." />
          </div>
          <p className="text-[11px] text-zinc-600">Se enviará un email de cierre con el resumen del día al correo configurado.</p>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setCloseModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={handleCloseSession} disabled={processing} className="no-drag px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg font-medium disabled:opacity-50">{processing ? 'Cerrando...' : 'Cerrar caja grande'}</button>
        </div>
      </Modal>
    </motion.div>
  )
}
