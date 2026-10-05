import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Plus, FileText, Printer, Mail, CheckCircle, AlertTriangle, Clock, X, User, Ban } from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, cn, debounce } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import PageHeader from '@/components/shared/PageHeader'
import HelpButton from '@/components/HelpButton'

const fmtDMY = (s) => {
  if (!s) return '—'
  const [y, m, d] = String(s).split('-')
  return d ? `${d}/${m}/${y}` : s
}
const PAY_METHODS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'MP QR']
const SIT_LABEL = { al_dia: 'Al día', con_mora: 'Con mora', completado: 'Completado', cancelado: 'Cancelado' }
const SIT_CLS = {
  al_dia:     'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  con_mora:   'text-red-300 bg-red-500/10 border-red-500/30',
  completado: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  cancelado:  'text-zinc-400 bg-zinc-500/10 border-zinc-500/30',
}

// Buscador de clientes reutilizable (misma mecánica que Ventas: api.clients.list).
function ClientPicker({ value, onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const search = useCallback(debounce(async (text) => {
    if (!text || text.length < 2) { setResults([]); return }
    try { const r = await api.clients.list({ search: text, limit: 6 }); setResults(r?.clients || []) } catch { setResults([]) }
  }, 250), [])
  useEffect(() => { search(q) }, [q, search])

  if (value) {
    return (
      <div className="flex items-center justify-between bg-[#0a0a0a] border border-border rounded-lg px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-white"><User size={14} className="text-zinc-500" />{value.name}</span>
        <button onClick={() => onPick(null)} className="text-zinc-500 hover:text-white"><X size={14} /></button>
      </div>
    )
  }
  return (
    <div className="relative">
      <input className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white"
        value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente por nombre…" />
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          {results.map(c => (
            <button key={c.id} onClick={() => { onPick(c); setQ(''); setResults([]) }}
              className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-white/5 flex items-center justify-between">
              <span>{c.name}</span>{c.price_list && c.price_list !== 'publico' && <span className="text-[10px] text-zinc-500">{c.price_list}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Creditos() {
  const [credits, setCredits] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [newOpen, setNewOpen] = useState(false)
  const [detail, setDetail] = useState(null)       // credit (from credits:get)
  const [stmtOpen, setStmtOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await api.credits.list({ status: statusFilter }); setCredits(r?.credits || []) }
    catch (e) { toast.error('No se pudieron cargar los créditos: ' + (e?.message || e)) }
    finally { setLoading(false) }
  }, [statusFilter])
  useEffect(() => { load() }, [load])

  const openDetail = async (id) => {
    try { const c = await api.credits.get(id); if (c) setDetail(c) }
    catch (e) { toast.error('Error al abrir el crédito: ' + (e?.message || e)) }
  }

  const FILTERS = [
    { k: '', label: 'Todos' },
    { k: 'activo', label: 'Activos' },
    { k: 'completado', label: 'Completados' },
    { k: 'cancelado', label: 'Cancelados' },
  ]

  return (
    <div className="p-6">
      <PageHeader
        title="Créditos"
        subtitle="Planes de cuotas de clientes, con interés por mora y estado de cuenta"
        actions={
          <>
            <HelpButton />
            <button onClick={() => setStmtOpen(true)}
              className="no-drag flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-border text-zinc-300 hover:text-white hover:bg-white/5">
              <FileText size={15} /> Estado de cuenta
            </button>
            <button onClick={() => setNewOpen(true)}
              className="no-drag flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:brightness-110">
              <Plus size={15} /> Nuevo crédito
            </button>
          </>
        }
      />

      <div className="flex gap-2 mb-4">
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setStatusFilter(f.k)}
            className={cn('px-3 py-1.5 text-xs rounded-lg border', statusFilter === f.k ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-zinc-400 hover:text-white')}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-sm text-zinc-500">Cargando…</div>
        ) : credits.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-zinc-500">No hay créditos para mostrar.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-border">
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                  <th className="px-5 py-3 font-medium text-center">Cuotas</th>
                  <th className="px-5 py-3 font-medium text-right">Saldo</th>
                  <th className="px-5 py-3 font-medium">Próx. venc.</th>
                  <th className="px-5 py-3 font-medium text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {credits.map(c => (
                  <tr key={c.id} onClick={() => openDetail(c.id)}
                    className="border-b border-border/60 hover:bg-white/[0.03] cursor-pointer">
                    <td className="px-5 py-2.5 text-white">{c.client_name}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-zinc-200">{formatCurrency(c.total_amount)}</td>
                    <td className="px-5 py-2.5 text-center tabular-nums text-zinc-300">{c.installments_paid}/{c.installments_total}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-white font-medium">{formatCurrency(c.owed)}</td>
                    <td className="px-5 py-2.5 text-zinc-300">{fmtDMY(c.next_due)}</td>
                    <td className="px-5 py-2.5 text-center">
                      <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border', SIT_CLS[c.situacion] || SIT_CLS.al_dia)}>
                        {SIT_LABEL[c.situacion] || c.situacion}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {newOpen && <NewCreditModal onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); load() }} />}
      {detail && <CreditDetailModal credit={detail} onClose={() => setDetail(null)} onChanged={(fresh) => { setDetail(fresh); load() }} />}
      {stmtOpen && <StatementModal onClose={() => setStmtOpen(false)} />}
    </div>
  )
}

// ─── Nuevo crédito ─────────────────────────────────────────────────────────────
function NewCreditModal({ onClose, onCreated }) {
  const [client, setClient] = useState(null)
  const [total, setTotal] = useState('')
  const [count, setCount] = useState('3')
  const [firstDue, setFirstDue] = useState(() => new Date().toISOString().slice(0, 10))
  const [rate, setRate] = useState('0')
  const [saleId, setSaleId] = useState('')
  const [notes, setNotes] = useState('')
  const [preview, setPreview] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const t = Number(total), c = parseInt(count, 10)
    if (t > 0 && c >= 1 && c <= 36 && firstDue) {
      api.credits.preview({ totalAmount: t, installmentsCount: c, firstDueDate: firstDue }).then(setPreview).catch(() => setPreview([]))
    } else setPreview([])
  }, [total, count, firstDue])

  const save = async () => {
    if (!client) return toast.error('Seleccioná un cliente')
    if (!(Number(total) > 0)) return toast.error('El monto total debe ser mayor a 0')
    const c = parseInt(count, 10)
    if (!(c >= 1 && c <= 36)) return toast.error('Las cuotas deben ser entre 1 y 36')
    if (!firstDue) return toast.error('Indicá la fecha de la primera cuota')
    setSaving(true)
    try {
      const res = await api.credits.create({
        clientId: client.id, saleId: saleId ? Number(saleId) : null,
        totalAmount: Number(total), installmentsCount: c, firstDueDate: firstDue,
        lateInterestRate: Number(rate) || 0, notes,
      })
      if (res?.ok) { toast.success('Crédito creado'); onCreated() }
      else toast.error(res?.error || 'No se pudo crear el crédito')
    } catch (e) { toast.error(e?.message || 'Error al crear') }
    finally { setSaving(false) }
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

  return (
    <Modal open onClose={onClose} title="Nuevo crédito" width="max-w-2xl">
      <div className="p-5 space-y-4 overflow-y-auto">
        <div>
          <label className={labelCls}>Cliente *</label>
          <ClientPicker value={client} onPick={setClient} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Monto total $ *</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={total} onChange={e => setTotal(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <label className={labelCls}>Cantidad de cuotas (1-36) *</label>
            <input type="number" min="1" max="36" className={inputCls} value={count} onChange={e => setCount(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Fecha primera cuota *</label>
            <input type="date" className={inputCls} value={firstDue} onChange={e => setFirstDue(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Interés por mora (% mensual)</label>
            <input type="number" min="0" step="0.1" className={inputCls} value={rate} onChange={e => setRate(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={labelCls}>Vincular a venta (ID, opcional)</label>
            <input type="number" min="0" className={inputCls} value={saleId} onChange={e => setSaleId(e.target.value)} placeholder="N° de venta" />
          </div>
          <div>
            <label className={labelCls}>Observaciones</label>
            <input className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} placeholder="(opcional)" />
          </div>
        </div>

        {preview.length > 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-xs text-zinc-400 bg-white/[0.02] border-b border-border">Plan de cuotas</div>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {preview.map(p => (
                    <tr key={p.number} className="border-b border-border/50">
                      <td className="px-3 py-1.5 text-zinc-400">Cuota {p.number}</td>
                      <td className="px-3 py-1.5 text-zinc-300">{fmtDMY(p.due_date)}</td>
                      <td className="px-3 py-1.5 text-right text-white tabular-nums">{formatCurrency(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 p-4 border-t border-border">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-zinc-300 hover:text-white">Cancelar</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium hover:brightness-110 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Crear crédito'}
        </button>
      </div>
    </Modal>
  )
}

// ─── Detalle de crédito ─────────────────────────────────────────────────────────
function CreditDetailModal({ credit, onClose, onChanged }) {
  const [payFor, setPayFor] = useState(null)   // installment to pay
  const [method, setMethod] = useState('Efectivo')
  const [busy, setBusy] = useState(false)

  const refresh = async () => { const fresh = await api.credits.get(credit.id); if (fresh) onChanged(fresh) }

  const doPay = async () => {
    if (!payFor) return
    setBusy(true)
    try {
      const res = await api.credits.registerPayment({ installmentId: payFor.id, paymentMethod: method })
      if (res?.ok) {
        toast.success(res.completed ? 'Cuota cobrada — crédito completado' : 'Cuota cobrada')
        setPayFor(null); setMethod('Efectivo'); await refresh()
      } else toast.error(res?.error || 'No se pudo registrar el pago')
    } catch (e) { toast.error(e?.message || 'Error') }
    finally { setBusy(false) }
  }

  const cancelCredit = async () => {
    if (!confirm('¿Cancelar este crédito? Las cuotas quedan sin cobrar.')) return
    try { const r = await api.credits.cancel({ id: credit.id }); if (r?.ok) { toast.success('Crédito cancelado'); await refresh() } }
    catch (e) { toast.error(e?.message || 'Error') }
  }

  const stIcon = (st) => st === 'pagada' ? <CheckCircle size={14} className="text-emerald-400" />
    : st === 'vencida' ? <AlertTriangle size={14} className="text-red-400" /> : <Clock size={14} className="text-zinc-500" />

  return (
    <Modal open onClose={onClose} title={`Crédito #${credit.id} — ${credit.client_name}`} width="max-w-3xl">
      <div className="p-5 space-y-4 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-zinc-500">Total</p><p className="text-white font-semibold">{formatCurrency(credit.total_amount)}</p></div>
          <div><p className="text-xs text-zinc-500">Saldo</p><p className="text-white font-semibold">{formatCurrency(credit.owed)}</p></div>
          <div><p className="text-xs text-zinc-500">Cuotas</p><p className="text-white font-semibold">{credit.installments_paid}/{credit.installments_total}</p></div>
          <div><p className="text-xs text-zinc-500">Mora</p><p className="text-white font-semibold">{Number(credit.late_interest_rate) || 0}% /mes</p></div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 uppercase border-b border-border">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Vencimiento</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2 text-right">Interés</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(credit.installments || []).map(it => (
                <tr key={it.id} className="border-b border-border/50">
                  <td className="px-3 py-2 text-zinc-400">{it.number}</td>
                  <td className="px-3 py-2 text-zinc-300">{fmtDMY(it.due_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{formatCurrency(it.original_amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-300">{Number(it.interest_amount) > 0 ? formatCurrency(it.interest_amount) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white font-medium">{formatCurrency(it.total_amount || it.original_amount)}</td>
                  <td className="px-3 py-2"><span className="flex items-center gap-1.5 text-xs">{stIcon(it.status)}{it.status === 'pagada' ? `Pagada ${it.paid_date ? fmtDMY(it.paid_date) : ''}` : it.status === 'vencida' ? 'Vencida' : 'Pendiente'}</span></td>
                  <td className="px-3 py-2 text-right">
                    {!it.paid_date && credit.status === 'activo' && (
                      <button onClick={() => { setPayFor(it); setMethod('Efectivo') }}
                        className="px-2.5 py-1 text-xs rounded-md bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25">Registrar pago</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex justify-between gap-2 p-4 border-t border-border">
        {credit.status === 'activo'
          ? <button onClick={cancelCredit} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10"><Ban size={14} /> Cancelar crédito</button>
          : <span className="text-xs text-zinc-500 self-center">Estado: {SIT_LABEL[credit.status] || credit.status}</span>}
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-zinc-300 hover:text-white">Cerrar</button>
      </div>

      {payFor && (
        <Modal open onClose={() => setPayFor(null)} title={`Cobrar cuota ${payFor.number}`} width="max-w-sm">
          <div className="p-5 space-y-3">
            <p className="text-sm text-zinc-300">Importe: <strong className="text-white">{formatCurrency(payFor.total_amount || payFor.original_amount)}</strong></p>
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Método de pago</label>
              <select className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white" value={method} onChange={e => setMethod(e.target.value)}>
                {PAY_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 p-4 border-t border-border">
            <button onClick={() => setPayFor(null)} className="px-4 py-2 text-sm rounded-lg border border-border text-zinc-300">Cancelar</button>
            <button onClick={doPay} disabled={busy} className="px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium disabled:opacity-50">{busy ? 'Cobrando…' : 'Confirmar pago'}</button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

// ─── Estado de cuenta por cliente ──────────────────────────────────────────────
function StatementModal({ onClose }) {
  const [client, setClient] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [emailing, setEmailing] = useState(false)

  const loadStatement = async (c) => {
    setClient(c); setData(null)
    if (!c) return
    setLoading(true)
    try { const res = await api.credits.accountStatement({ clientId: c.id }); if (res?.ok) setData(res); else toast.error(res?.error || 'Error') }
    catch (e) { toast.error(e?.message || 'Error') }
    finally { setLoading(false) }
  }

  const print = () => {
    if (!data?.html) return
    const w = window.open('', '_blank', 'width=820,height=900')
    if (!w) return toast.error('Permití las ventanas emergentes para imprimir')
    w.document.write(data.html); w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 300)
  }

  const sendEmail = async () => {
    if (!client) return
    setEmailing(true)
    try {
      const res = await api.credits.emailStatement({ clientId: client.id })
      if (res?.ok) toast.success('Estado de cuenta enviado a ' + res.email)
      else if (res?.noEmail) toast.error('El cliente no tiene email cargado en su ficha.')
      else toast.error(res?.error || 'No se pudo enviar')
    } catch (e) { toast.error(e?.message || 'Error') }
    finally { setEmailing(false) }
  }

  return (
    <Modal open onClose={onClose} title="Estado de cuenta por cliente" width="max-w-3xl">
      <div className="p-5 space-y-4 overflow-y-auto">
        <div>
          <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">Cliente</label>
          <ClientPicker value={client} onPick={loadStatement} />
        </div>
        {loading && <p className="text-sm text-zinc-500">Cargando…</p>}
        {data && (
          <>
            <div className={cn('rounded-lg p-3 border text-sm', data.totals.overdueCount > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-emerald-500/10 border-emerald-500/20')}>
              Total adeudado: <strong className="text-white">{formatCurrency(data.totals.totalOwed)}</strong>
              <span className="text-zinc-400"> · Cuotas vencidas: </span><strong className={data.totals.overdueCount > 0 ? 'text-red-300' : 'text-emerald-300'}>{data.totals.overdueCount}</strong>
            </div>
            <iframe title="estado" srcDoc={data.html} className="w-full rounded-lg border border-border bg-white" style={{ height: 420 }} />
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 p-4 border-t border-border">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-zinc-300">Cerrar</button>
        <button onClick={print} disabled={!data} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-border text-zinc-200 hover:bg-white/5 disabled:opacity-50"><Printer size={15} /> Imprimir</button>
        <button onClick={sendEmail} disabled={!data || emailing} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-accent text-white font-medium disabled:opacity-50"><Mail size={15} /> {emailing ? 'Enviando…' : 'Enviar por email'}</button>
      </div>
    </Modal>
  )
}
