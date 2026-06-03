import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Plus, Search, Edit2, Trash2, Users, Eye, DollarSign,
  Upload, Trophy, Cake, MessageCircle, Crown, CheckCircle, AlertTriangle, Info, Gift,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import { PhoneLink, EmailLink } from '@/components/shared/ContactLinks'
import Modal from '@/components/shared/Modal'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function emptyForm() { return { name:'', phone:'', dni:'', email:'', address:'', notes:'', birth_date:'' } }

function whatsappUrl(client, message) {
  const phone = (client.phone||'').replace(/\D/g,'')
  if (!phone) return null
  const wp = phone.startsWith('54') ? phone : '54' + (phone.startsWith('0') ? phone.slice(1) : phone)
  const firstName = (client.name||'').split(' ')[0]
  const text = encodeURIComponent((message||'Feliz cumple [nombre]!').replace('[nombre]', firstName))
  return `https://wa.me/${wp}?text=${text}`
}

const TABS = [
  { id: 'list',      label: 'Lista',            Icon: Users },
  { id: 'ranking',   label: 'Mejores clientas', Icon: Trophy },
  { id: 'birthdays', label: 'Cumpleaños del mes', Icon: Cake },
]

const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

export default function Clients() {
  const [tab, setTab] = useState('list')

  // List
  const [data, setData] = useState({ clients:[], total:0, pages:1 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Ranking
  const [ranking, setRanking] = useState([])
  const [rankLoading, setRankLoading] = useState(false)

  // Birthdays
  const [monthBirthdays, setMonthBirthdays] = useState([])
  const [bdayLoading, setBdayLoading] = useState(false)
  const [birthdayMsg, setBirthdayMsg] = useState('Feliz cumple [nombre]! 🎁 Pasate por el local, te tenemos un regalo especial 🎉')

  // Form / modals
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [histModal, setHistModal] = useState(null)
  const [history, setHistory] = useState([])
  const [pointsHistory, setPointsHistory] = useState([])
  const [payModal, setPayModal] = useState(null)
  const [payAmt, setPayAmt] = useState('')

  // Import
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    setLoading(true)
    try { const r = await api.clients.list({ page, search, limit:25 }); setData(r) }
    finally { setLoading(false) }
  }, [page, search])

  const loadRanking = useCallback(async () => {
    setRankLoading(true)
    try { setRanking(await api.clients.ranking()) }
    finally { setRankLoading(false) }
  }, [])

  const loadBirthdays = useCallback(async () => {
    setBdayLoading(true)
    try {
      const [bdays, msg] = await Promise.all([
        api.clients.birthdayMonth(),
        api.settings.get('birthday_message'),
      ])
      setMonthBirthdays(bdays)
      if (msg) setBirthdayMsg(msg)
    } finally { setBdayLoading(false) }
  }, [])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (tab === 'ranking') loadRanking() }, [tab, loadRanking])
  useEffect(() => { if (tab === 'birthdays') loadBirthdays() }, [tab, loadBirthdays])

  // ── Handlers ───────────────────────────────────────────────────────────────

  const openCreate = () => { setForm(emptyForm()); setEditId(null); setModal('form') }
  const openEdit = (c) => {
    setForm({ name:c.name, phone:c.phone, dni:c.dni, email:c.email, address:c.address, notes:c.notes, birth_date:c.birth_date||'' })
    setEditId(c.id); setModal('form')
  }

  const openHistory = async (c) => {
    const [hist, pts] = await Promise.all([
      api.clients.history(c.id),
      api.clients.points.history(c.id).catch(() => []),
    ])
    setHistory(hist)
    setPointsHistory(pts)
    setHistModal(c)
  }
  const openPayment = (c) => { setPayModal(c); setPayAmt('') }

  const save = async () => {
    if (!form.name.trim()) return toast.error('El nombre es requerido')
    setSaving(true)
    try {
      if (editId) { await api.clients.update(editId, form); toast.success('Cliente actualizado') }
      else { await api.clients.create(form); toast.success('Cliente creado') }
      setModal(null); loadList()
    } catch (e) { toast.error(e.message||'Error') }
    finally { setSaving(false) }
  }

  const remove = async (id, name) => {
    if (!confirm(`¿Eliminar a "${name}"?`)) return
    await api.clients.delete(id); toast.success('Cliente eliminado'); loadList()
  }

  const registerPayment = async () => {
    if (!payAmt || Number(payAmt) <= 0) return toast.error('Ingresá un monto válido')
    await api.clients.addPayment({ clientId:payModal.id, amount:Number(payAmt) })
    toast.success(`Pago de ${formatCurrency(Number(payAmt))} registrado`)
    setPayModal(null); loadList()
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const res = await api.clients.importCSV()
      if (res === null) return // user cancelled dialog
      setImportResult(res)
      if (res.imported > 0) loadList()
    } catch (e) { toast.error(e.message||'Error al importar') }
    finally { setImporting(false) }
  }

  const openWA = (client) => {
    const url = whatsappUrl(client, birthdayMsg)
    if (url) api.shell.openExternal(url)
    else toast.error('Esta clienta no tiene teléfono registrado')
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]:v }))
  const currentMonth = MONTHS[new Date().getMonth()]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
      exit={{ opacity:0, y:-4 }} transition={{ duration:0.18 }}
      className="p-6"
    >
      <PageHeader
        title="Clientes"
        subtitle={`${data.total} clientes registrados`}
        actions={
          <div className="flex gap-2">
            <button onClick={handleImport} disabled={importing}
              className="no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
              <Upload size={14} /> {importing ? 'Importando...' : 'Importar CSV'}
            </button>
            <button onClick={openCreate} className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg">
              <Plus size={15} /> Nuevo cliente
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === id ? 'border-accent text-accent' : 'border-transparent text-zinc-500 hover:text-zinc-300')}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>

      {/* ── Tab: Lista ──────────────────────────────────────────────────────── */}
      {tab === 'list' && (
        <>
          <div className="relative mb-4 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input className={`${inputCls} pl-8`} placeholder="Buscar nombre, email, teléfono..."
              value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="grid text-[11px] text-zinc-500 uppercase tracking-wider px-4 py-2.5 border-b border-border bg-surface"
              style={{ gridTemplateColumns:'2fr 1fr 1fr 1fr 80px auto' }}>
              <span>Nombre</span><span>Teléfono</span><span>DNI</span><span className="text-right">Saldo CC</span><span className="text-right">Puntos</span><span />
            </div>
            <div className="divide-y divide-border">
              {loading ? <SkeletonTable rows={5} cols={6} />
                : data.clients.length === 0 ? (
                  <EmptyState icon={Users} title={search ? 'Sin coincidencias' : 'Sin clientes registrados'} subtitle="Importá desde CSV o creá uno nuevo" />
                ) : data.clients.map(c => (
                  <div key={c.id} className="row-alt grid items-center px-4 py-3" style={{ gridTemplateColumns:'2fr 1fr 1fr 1fr 80px auto' }}>
                    <div>
                      <p className="text-sm text-white font-medium">{c.name}</p>
                      <EmailLink email={c.email} />
                    </div>
                    <PhoneLink phone={c.phone} />
                    <span className="text-sm text-zinc-300">{c.dni||'—'}</span>
                    <span className={cn('text-sm text-right font-medium tabular-nums', c.balance > 0 ? 'text-amber-400' : 'text-zinc-400')}>
                      {c.balance > 0 ? formatCurrency(c.balance) : '—'}
                    </span>
                    <span className={cn('text-sm text-right font-medium tabular-nums', (c.points||0) > 0 ? 'text-accent' : 'text-zinc-600')}>
                      {(c.points||0) > 0 ? <span className="flex items-center justify-end gap-1"><Gift size={11} />{c.points}</span> : '—'}
                    </span>
                    <div className="flex gap-1">
                      {c.balance > 0 && (
                        <button onClick={() => openPayment(c)} className="no-drag p-1.5 text-zinc-600 hover:text-green-400 rounded" title="Registrar pago">
                          <DollarSign size={13} />
                        </button>
                      )}
                      <button onClick={() => openHistory(c)} className="no-drag p-1.5 text-zinc-600 hover:text-accent rounded" title="Historial"><Eye size={13} /></button>
                      <button onClick={() => openEdit(c)} className="no-drag p-1.5 text-zinc-600 hover:text-accent rounded"><Edit2 size={13} /></button>
                      <button onClick={() => remove(c.id, c.name)} className="no-drag p-1.5 text-zinc-600 hover:text-red-400 rounded"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
            </div>
            <Pagination page={page} pages={data.pages} total={data.total} limit={25} onChange={setPage} />
          </div>
        </>
      )}

      {/* ── Tab: Ranking ────────────────────────────────────────────────────── */}
      {tab === 'ranking' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
            style={{ gridTemplateColumns:'32px 2fr 1fr 1fr 1fr 1fr 80px' }}>
            <span>#</span><span>Clienta</span><span>Teléfono</span>
            <span className="text-right">Total gastado</span>
            <span className="text-right">Compras</span>
            <span>Última compra</span>
            <span>Badge</span>
          </div>
          <div className="divide-y divide-border">
            {rankLoading ? <SkeletonTable rows={8} cols={7} />
              : ranking.length === 0 ? <EmptyState icon={Trophy} title="Sin datos de ranking" subtitle="Importá clientes desde Tienda Nube o registrá ventas" />
              : ranking.map((c, i) => (
                <div key={c.id} className="row-alt grid items-center px-4 py-3 text-sm gap-2"
                  style={{ gridTemplateColumns:'32px 2fr 1fr 1fr 1fr 1fr 80px' }}>
                  <span className={cn('font-bold tabular-nums', i < 3 ? 'text-accent' : 'text-zinc-600')}>{i+1}</span>
                  <div>
                    <p className="text-white font-medium">{c.name}</p>
                    <EmailLink email={c.email} />
                  </div>
                  <PhoneLink phone={c.phone} />
                  <span className="text-right text-white tabular-nums font-medium">{formatCurrency(c.effective_spent)}</span>
                  <span className="text-right text-zinc-300 tabular-nums">{c.effective_count}</span>
                  <span className="text-zinc-500 text-xs">{c.last_purchase || '—'}</span>
                  <div className="flex gap-1 flex-wrap">
                    {c.effective_count > 3 && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent font-medium">
                        <Crown size={9} /> VIP
                      </span>
                    )}
                    {c.is_new === 1 && (
                      <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-medium">
                        Nueva
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Tab: Cumpleaños del mes ──────────────────────────────────────────── */}
      {tab === 'birthdays' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">Clientas que cumplen años en <span className="text-white font-medium">{currentMonth}</span></p>
            <span className="text-xs text-zinc-600">{monthBirthdays.length} clientas</span>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
              style={{ gridTemplateColumns:'60px 2fr 1fr auto' }}>
              <span>Día</span><span>Nombre</span><span>Teléfono</span><span />
            </div>
            <div className="divide-y divide-border">
              {bdayLoading ? <SkeletonTable rows={5} cols={4} />
                : monthBirthdays.length === 0 ? <EmptyState icon={Cake} title={`Sin cumpleaños en ${currentMonth}`} subtitle="Completá las fechas de nacimiento importando desde Tienda Nube" />
                : monthBirthdays.map(c => {
                  const day = c.birth_date?.slice(8,10) || '—'
                  const url = whatsappUrl(c, birthdayMsg)
                  return (
                    <div key={c.id} className="row-alt grid items-center px-4 py-3 text-sm gap-2"
                      style={{ gridTemplateColumns:'60px 2fr 1fr auto' }}>
                      <span className="text-accent font-bold tabular-nums text-base">{day}</span>
                      <p className="text-white font-medium">{c.name}</p>
                      <PhoneLink phone={c.phone} />
                      <button
                        onClick={() => url ? api.shell.openExternal(url) : toast.error('Sin teléfono registrado')}
                        className="no-drag flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors">
                        <MessageCircle size={12} /> WhatsApp
                      </button>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Birthday message preview */}
          <div className="bg-surface border border-border rounded-xl p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Mensaje configurado</p>
            <p className="text-sm text-zinc-300 italic">"{birthdayMsg}"</p>
            <p className="text-xs text-zinc-600 mt-2">Editá el mensaje en Configuración → Negocio</p>
          </div>
        </div>
      )}

      {/* ── Modal: Formulario ───────────────────────────────────────────────── */}
      <Modal open={modal === 'form'} onClose={() => setModal(null)} title={editId ? 'Editar cliente' : 'Nuevo cliente'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Nombre *</label>
              <input className={inputCls} value={form.name} onChange={e => f('name', e.target.value)} autoFocus />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input className={inputCls} value={form.phone} onChange={e => f('phone', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>DNI</label>
              <input className={inputCls} value={form.dni} onChange={e => f('dni', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} value={form.email} onChange={e => f('email', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Fecha de nacimiento</label>
              <input type="date" className={inputCls} value={form.birth_date} onChange={e => f('birth_date', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Dirección</label>
              <input className={inputCls} value={form.address} onChange={e => f('address', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notas</label>
              <textarea className={`${inputCls} resize-none`} rows={2} value={form.notes} onChange={e => f('notes', e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">
            {saving ? 'Guardando...' : editId ? 'Guardar' : 'Crear cliente'}
          </button>
        </div>
      </Modal>

      {/* ── Modal: Resultado import ─────────────────────────────────────────── */}
      <Modal open={!!importResult} onClose={() => setImportResult(null)} title="Importación completada" width="max-w-sm">
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-400">
            <CheckCircle size={16} />
            <span><span className="font-bold">{importResult?.imported}</span> clientes importados</span>
          </div>
          {(importResult?.duplicates||0) > 0 && (
            <div className="flex items-center gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-400">
              <Info size={16} />
              <span><span className="font-bold">{importResult?.duplicates}</span> duplicados saltados (ya existían)</span>
            </div>
          )}
          {(importResult?.errors||0) > 0 && (
            <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
              <AlertTriangle size={16} />
              <span><span className="font-bold">{importResult?.errors}</span> filas con error</span>
            </div>
          )}
        </div>
        <div className="flex justify-end mt-6 pt-4 border-t border-border">
          <button onClick={() => setImportResult(null)} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">Listo</button>
        </div>
      </Modal>

      {/* ── Modal: Historial ────────────────────────────────────────────────── */}
      <Modal open={!!histModal} onClose={() => setHistModal(null)} title={`Historial — ${histModal?.name}`} width="max-w-2xl">
        {histModal && (histModal.phone || histModal.email) && (
          <div className="flex items-center gap-4 mb-4 pb-4 border-b border-border">
            {histModal.phone && <PhoneLink phone={histModal.phone} />}
            {histModal.email && <EmailLink email={histModal.email} />}
          </div>
        )}

        {/* Points balance */}
        {(histModal?.points ?? 0) >= 0 && (
          <div className="flex items-center justify-between mb-4 px-4 py-3 rounded-xl bg-accent/5 border border-accent/15">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Gift size={14} className="text-accent" />
              Puntos acumulados
            </div>
            <span className="text-accent font-bold text-lg tabular-nums">{histModal?.points ?? 0}</span>
          </div>
        )}

        <div className="space-y-1 mb-4">
          {history.length === 0 ? <p className="text-zinc-600 text-sm text-center py-8">Sin compras registradas</p>
            : history.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/[0.03] text-sm">
                <div>
                  <span className="text-zinc-400 text-xs mr-2">#{s.id}</span>
                  <span className="text-white">{formatDateTime(s.created_at)}</span>
                  <span className="text-zinc-500 text-xs ml-2">{s.items} artículos</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">{s.payment_method}</span>
                  <span className={cn('font-medium tabular-nums', s.voided ? 'line-through text-zinc-600' : 'text-white')}>{formatCurrency(s.total)}</span>
                </div>
              </div>
            ))}
        </div>

        {/* Points log */}
        {pointsHistory.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Gift size={11} /> Historial de puntos</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {pointsHistory.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn('font-bold tabular-nums', p.amount > 0 ? 'text-accent' : 'text-red-400')}>
                      {p.amount > 0 ? `+${p.amount}` : p.amount}
                    </span>
                    <span className="text-zinc-500">
                      {p.type === 'earn' ? 'Ganados en compra' : p.type === 'redeem' ? 'Canjeados' : p.type === 'adjust_add' ? 'Ajuste +' : p.type === 'adjust_remove' ? 'Ajuste -' : p.notes || p.type}
                    </span>
                  </div>
                  <span className="text-zinc-600">{formatDateTime(p.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal: Pago ─────────────────────────────────────────────────────── */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Registrar pago — ${payModal?.name}`} width="max-w-sm">
        <div className="space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm">
            <span className="text-zinc-400">Saldo pendiente: </span>
            <span className="text-amber-400 font-bold">{formatCurrency(payModal?.balance)}</span>
          </div>
          <div>
            <label className={labelCls}>Monto del pago $</label>
            <input type="number" min="0" step="0.01" className={inputCls} value={payAmt} onChange={e => setPayAmt(e.target.value)} autoFocus />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setPayModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={registerPayment} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg">Registrar pago</button>
        </div>
      </Modal>
    </motion.div>
  )
}
