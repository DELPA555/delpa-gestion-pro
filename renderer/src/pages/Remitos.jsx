import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, FileBox, Eye, Trash2, CheckCircle, XCircle, Clock, Search, Printer, MessageCircle, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api'
import { bizContactFooterHtml } from '../lib/printFooter'

const fmtDate = s => s ? new Date(s).toLocaleDateString('es-AR') : '—'
const fmtMoney = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)

const STATUS_LABELS = { pendiente: 'Pendiente', entregado: 'Entregado', rechazado: 'Rechazado' }
const STATUS_COLORS = {
  pendiente: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  entregado: 'bg-green-500/15 text-green-400 border-green-500/30',
  rechazado: 'bg-red-500/15 text-red-400 border-red-500/30',
}
const TYPE_LABELS = { venta: 'Venta', transferencia: 'Transferencia', devolucion: 'Devolución' }

function StatusBadge({ status }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[status] || 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function printRemito(remito, biz = {}) {
  const bizName = biz.business_name || 'DELPA'
  const bizAddr = biz.business_address || ''
  const bizPhone = biz.business_phone || ''
  const fmt = v => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(v || 0)
  const items = remito.items || []
  const rows = items.map(it =>
    `<tr><td>${it.name || ''}</td><td style="text-align:center">${it.size || ''}</td><td style="text-align:right">${it.qty}</td><td style="text-align:right">${it.unit_price ? fmt(it.unit_price) : '—'}</td></tr>`
  ).join('')
  const total = items.reduce((s, it) => s + (it.qty * (it.unit_price || 0)), 0)

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Remito ${remito.number}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px}
.header{display:flex;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #111}
.biz h1{font-size:20px;font-weight:bold}.biz p{color:#555;font-size:11px;margin:1px 0}
.rem h2{font-size:16px;font-weight:bold;text-align:right}.rem p{color:#555;font-size:11px;text-align:right}
.recipient{background:#f8f8f8;padding:12px;border-radius:6px;margin-bottom:16px}
.recipient strong{font-size:11px;text-transform:uppercase;color:#999;letter-spacing:.5px}
.recipient p{font-size:13px;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{text-align:left;padding:7px 6px;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
td{padding:7px 6px;border-bottom:1px solid #eee;font-size:12px}
.total-row td{font-weight:bold;font-size:13px;border-top:2px solid #111;border-bottom:none}
.notes{background:#f8f8f8;padding:10px;border-radius:6px;font-size:11px;color:#555;margin-top:8px}
.footer{margin-top:24px;text-align:center;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:12px}
</style></head><body>
<div class="header">
  <div class="biz">
    <h1>${bizName}</h1>
    ${bizAddr ? `<p>${bizAddr}</p>` : ''}
    ${bizPhone ? `<p>Tel: ${bizPhone}</p>` : ''}
  </div>
  <div class="rem">
    <h2>REMITO</h2>
    <p>${remito.number}</p>
    <p>Tipo: ${TYPE_LABELS[remito.type] || remito.type}</p>
    <p>Fecha: ${new Date(remito.created_at).toLocaleDateString('es-AR')}</p>
  </div>
</div>
${remito.recipient ? `<div class="recipient"><strong>Destinatario</strong><p>${remito.recipient}${remito.address ? ' · ' + remito.address : ''}</p></div>` : ''}
<table>
<thead><tr><th>Producto</th><th style="text-align:center">Talle</th><th style="text-align:right">Cant.</th><th style="text-align:right">Precio</th></tr></thead>
<tbody>${rows}
${total > 0 ? `<tr class="total-row"><td colspan="3">Total</td><td style="text-align:right">${fmt(total)}</td></tr>` : ''}
</tbody></table>
${remito.notes ? `<div class="notes"><strong>Notas:</strong> ${remito.notes}</div>` : ''}
<div class="footer">Generado por ${bizName} · DELPA Gestión PRO</div>
${bizContactFooterHtml(biz)}
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),900)}<\/script>
</body></html>`

  const w = window.open('', '_blank', 'width=800,height=700')
  w.document.write(html)
  w.document.close()
}

const inputCls = 'bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none transition-colors'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

function RemitoModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ type: 'venta', recipient: '', address: '', notes: '' })
  const [items, setItems] = useState([{ name: '', size: '', qty: 1, unit_price: '' }])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({ type: 'venta', recipient: '', address: '', notes: '' })
      setItems([{ name: '', size: '', qty: 1, unit_price: '' }])
    }
  }, [open])

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(p => [...p, { name: '', size: '', qty: 1, unit_price: '' }])
  const removeItem = (i) => setItems(p => p.filter((_, idx) => idx !== i))

  const submit = async () => {
    const validItems = items.filter(it => it.name && it.qty > 0)
    if (!validItems.length) { toast.error('Agregá al menos un producto'); return }
    setLoading(true)
    try {
      const r = await api.remito.create({ ...form, items: validItems })
      if (r.ok) { toast.success(`Remito ${r.number} creado`); onCreated() }
      else toast.error(r.error)
    } catch { toast.error('Error al crear remito') }
    finally { setLoading(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h3 className="font-semibold text-white text-sm flex items-center gap-2"><FileBox size={15} className="text-accent" />Nuevo Remito</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xs no-drag">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Tipo</label>
              <select value={form.type} onChange={e => f('type', e.target.value)} className={`${inputCls} w-full`}>
                <option value="venta">Venta</option>
                <option value="transferencia">Transferencia</option>
                <option value="devolucion">Devolución</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Destinatario</label>
              <input value={form.recipient} onChange={e => f('recipient', e.target.value)} placeholder="Nombre / empresa" className={`${inputCls} w-full`} />
            </div>
            <div>
              <label className={labelCls}>Dirección</label>
              <input value={form.address} onChange={e => f('address', e.target.value)} placeholder="Dirección" className={`${inputCls} w-full`} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls} style={{ marginBottom: 0 }}>Productos</label>
              <button onClick={addItem} className="text-xs text-accent hover:underline no-drag">+ Agregar</button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={it.name} onChange={e => setItem(i, 'name', e.target.value)}
                    placeholder="Producto" className={`${inputCls} col-span-4`} />
                  <input value={it.size} onChange={e => setItem(i, 'size', e.target.value)}
                    placeholder="Talle" className={`${inputCls} col-span-2`} />
                  <input type="number" min="1" value={it.qty} onChange={e => setItem(i, 'qty', Number(e.target.value))}
                    placeholder="Cant." className={`${inputCls} col-span-2`} />
                  <input type="number" min="0" value={it.unit_price} onChange={e => setItem(i, 'unit_price', e.target.value)}
                    placeholder="Precio" className={`${inputCls} col-span-3`} />
                  <button onClick={() => removeItem(i)} className="col-span-1 text-zinc-600 hover:text-red-400 transition-colors no-drag flex justify-center">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Notas</label>
            <textarea value={form.notes} onChange={e => f('notes', e.target.value)} rows={2}
              placeholder="Observaciones..." className={`${inputCls} w-full resize-none`} />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 no-drag py-2.5 rounded-xl border border-border text-zinc-400 text-sm hover:text-white hover:border-zinc-500 transition-colors">
              Cancelar
            </button>
            <button onClick={submit} disabled={loading}
              className="flex-1 no-drag py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors disabled:opacity-50">
              {loading ? 'Creando...' : 'Crear Remito'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RemitoDetailModal({ remito, onClose, onStatusChange }) {
  const [loading, setLoading] = useState(false)
  const [biz, setBiz] = useState({})

  useEffect(() => {
    api.settings.getAll().then(a => setBiz(a)).catch(() => {})
  }, [])

  if (!remito) return null

  const changeStatus = async (status) => {
    setLoading(true)
    try {
      const r = await api.remito.updateStatus({ id: remito.id, status, applyStock: true })
      if (r.ok) { toast.success(`Remito marcado como ${STATUS_LABELS[status]}`); onStatusChange() }
      else toast.error(r.error)
    } catch { toast.error('Error') }
    finally { setLoading(false) }
  }

  const shareWhatsApp = () => {
    const lines = [`*Remito ${remito.number}*`, `Tipo: ${TYPE_LABELS[remito.type] || remito.type}`]
    if (remito.recipient) lines.push(`Para: ${remito.recipient}`)
    ;(remito.items || []).forEach(it => lines.push(`• ${it.name} T.${it.size} × ${it.qty}`))
    if (remito.notes) lines.push(`Notas: ${remito.notes}`)
    const text = encodeURIComponent(lines.join('\n'))
    window.electron.invoke('shell:openExternal', `https://wa.me/?text=${text}`)
  }

  const items = remito.items || []
  const total = items.reduce((s, it) => s + (it.qty * (it.unit_price || 0)), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card">
          <div>
            <h3 className="font-semibold text-white text-sm">{remito.number}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{TYPE_LABELS[remito.type] || remito.type} · {fmtDate(remito.created_at)}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xs no-drag">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={remito.status} />
            {remito.recipient && <span className="text-xs text-zinc-400">{remito.recipient}</span>}
            {remito.address && <span className="text-xs text-zinc-600">· {remito.address}</span>}
          </div>

          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-zinc-500 font-medium">Producto</th>
                  <th className="text-center px-2 py-2 text-zinc-500 font-medium">Talle</th>
                  <th className="text-right px-2 py-2 text-zinc-500 font-medium">Cant.</th>
                  <th className="text-right px-3 py-2 text-zinc-500 font-medium">Precio</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 text-white">{it.name}</td>
                    <td className="px-2 py-2 text-center text-zinc-400">{it.size}</td>
                    <td className="px-2 py-2 text-right text-zinc-300">{it.qty}</td>
                    <td className="px-3 py-2 text-right text-zinc-300">{it.unit_price ? fmtMoney(it.unit_price) : '—'}</td>
                  </tr>
                ))}
                {total > 0 && (
                  <tr className="bg-white/[0.02]">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs text-zinc-500 font-medium">Total</td>
                    <td className="px-3 py-2 text-right text-accent font-semibold text-sm">{fmtMoney(total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {remito.notes && (
            <div className="bg-surface rounded-xl border border-border p-3">
              <p className="text-xs text-zinc-500 mb-1">Notas</p>
              <p className="text-sm text-zinc-300">{remito.notes}</p>
            </div>
          )}

          {remito.status === 'pendiente' && (
            <div className="flex gap-2">
              <button onClick={() => changeStatus('entregado')} disabled={loading}
                className="flex-1 no-drag flex items-center justify-center gap-1.5 py-2 rounded-xl bg-green-600/80 text-white text-sm font-medium hover:bg-green-600 transition-colors disabled:opacity-50">
                <CheckCircle size={13} /> Marcar entregado
              </button>
              <button onClick={() => changeStatus('rechazado')} disabled={loading}
                className="flex-1 no-drag flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-600/20 text-red-400 border border-red-500/30 text-sm hover:bg-red-600/30 transition-colors disabled:opacity-50">
                <XCircle size={13} /> Rechazar
              </button>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => printRemito(remito, biz)}
              className="flex-1 no-drag flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border text-zinc-400 text-sm hover:text-white hover:border-zinc-500 transition-colors">
              <Printer size={13} /> Imprimir PDF
            </button>
            <button onClick={shareWhatsApp}
              className="flex-1 no-drag flex items-center justify-center gap-1.5 py-2 rounded-xl border border-green-600/40 text-green-400 text-sm hover:bg-green-600/10 transition-colors">
              <MessageCircle size={13} /> WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Remitos() {
  const [data, setData] = useState({ remitos: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.remito.list({ page, limit: 25, status })
      setData(r)
    } catch { toast.error('Error al cargar remitos') }
    finally { setLoading(false) }
  }, [page, status])

  useEffect(() => { load() }, [load])

  const openDetail = async (row) => {
    try {
      const full = await api.remito.get(row.id)
      setDetail(full)
    } catch { toast.error('Error al cargar remito') }
  }

  const deleteRemito = async (id) => {
    if (!window.confirm('¿Eliminar este remito?')) return
    await api.remito.delete(id)
    toast.success('Remito eliminado')
    load()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      className="p-6 space-y-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Remitos</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{data.total} remito{data.total !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="no-drag flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors">
          <Plus size={15} /> Nuevo remito
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="entregado">Entregado</option>
          <option value="rechazado">Rechazado</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-border text-[10px] text-zinc-500 uppercase tracking-wider">
          <div className="col-span-2">Número</div>
          <div className="col-span-1">Tipo</div>
          <div className="col-span-3">Destinatario</div>
          <div className="col-span-2">Items</div>
          <div className="col-span-2">Estado</div>
          <div className="col-span-1">Fecha</div>
          <div className="col-span-1"></div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-zinc-600 text-sm">Cargando...</div>
        ) : data.remitos.length === 0 ? (
          <div className="p-12 text-center">
            <FileBox size={32} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">No hay remitos</p>
            <p className="text-zinc-700 text-xs mt-1">Creá tu primer remito con el botón de arriba</p>
          </div>
        ) : (
          data.remitos.map((r, i) => (
            <div key={r.id}
              className={`grid grid-cols-12 gap-2 px-4 py-3 border-b border-border/50 last:border-0 cursor-pointer transition-colors hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}
              onClick={() => openDetail(r)}
            >
              <div className="col-span-2 text-accent text-xs font-mono font-semibold">{r.number}</div>
              <div className="col-span-1 text-zinc-400 text-xs">{TYPE_LABELS[r.type] || r.type}</div>
              <div className="col-span-3 text-white text-xs truncate">{r.recipient || <span className="text-zinc-600">—</span>}</div>
              <div className="col-span-2 text-zinc-500 text-xs">{r.item_count ?? 0} ítem{r.item_count !== 1 ? 's' : ''}</div>
              <div className="col-span-2"><StatusBadge status={r.status} /></div>
              <div className="col-span-1 text-zinc-600 text-xs">{fmtDate(r.created_at)}</div>
              <div className="col-span-1 flex items-center justify-end gap-1">
                <button onClick={e => { e.stopPropagation(); deleteRemito(r.id) }}
                  className="text-zinc-700 hover:text-red-400 transition-colors no-drag p-1">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {data.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="no-drag px-3 py-1.5 rounded-lg border border-border text-xs text-zinc-400 hover:text-white disabled:opacity-30 transition-colors">
            Anterior
          </button>
          <span className="text-xs text-zinc-500">{page} / {data.pages}</span>
          <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages}
            className="no-drag px-3 py-1.5 rounded-lg border border-border text-xs text-zinc-400 hover:text-white disabled:opacity-30 transition-colors">
            Siguiente
          </button>
        </div>
      )}

      <RemitoModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />
      <RemitoDetailModal remito={detail} onClose={() => setDetail(null)} onStatusChange={() => { setDetail(null); load() }} />
    </motion.div>
  )
}
