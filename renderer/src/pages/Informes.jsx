import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { FileText, RefreshCw, Send, Mail, Calendar, CalendarDays, Clock, Printer, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import PageHeader from '@/components/shared/PageHeader'

function fmtDate(s) {
  if (!s) return ''
  try { return new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

export default function Informes() {
  const [kind, setKind] = useState('week')
  const [current, setCurrent] = useState(null)   // informe mostrado (con html)
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const iframeRef = useRef(null)

  const loadList = useCallback(async (k) => {
    const rows = await api.informes.list(k).catch(() => [])
    setList(rows || [])
    return rows || []
  }, [])

  const loadLatest = useCallback(async (k) => {
    setLoading(true)
    try {
      const latest = await api.informes.latest(k).catch(() => null)
      setCurrent(latest)
      await loadList(k)
    } finally { setLoading(false) }
  }, [loadList])

  useEffect(() => { loadLatest(kind) }, [kind, loadLatest])

  const openReport = async (id) => {
    const row = await api.informes.get(id).catch(() => null)
    if (row) setCurrent(row)
  }

  const generate = async () => {
    setGenerating(true)
    try {
      const r = await api.informes.generate(kind)
      if (r?.ok) {
        toast.success('Informe generado')
        const row = await api.informes.get(r.id).catch(() => null)
        if (row) setCurrent(row)
        await loadList(kind)
      } else {
        toast.error(r?.error || 'No se pudo generar el informe')
      }
    } catch (e) { toast.error(e.message) }
    finally { setGenerating(false) }
  }

  const send = async () => {
    if (!current) { toast.error('Generá un informe primero'); return }
    setSending(true)
    try {
      const r = await api.informes.send(kind, current.id)
      if (r?.ok) {
        toast.success(`Enviado a ${r.to}${r.cc ? ` (cc ${r.cc})` : ''}`)
        await loadLatest(kind)
      } else {
        toast.error(r?.error || 'No se pudo enviar (revisá la config de email)')
      }
    } catch (e) { toast.error(e.message) }
    finally { setSending(false) }
  }

  const printReport = () => {
    const html = current?.html
    if (!html) return
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) { toast.error('Permití las ventanas emergentes'); return }
    w.document.write(html)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 space-y-4">
      <PageHeader title="Informes" subtitle="Resúmenes semanales y mensuales del negocio" />

      {/* Tabs kind */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-0.5">
          {[['week', 'Informe semanal', Calendar], ['month', 'Informe mensual', CalendarDays]].map(([id, lbl, Icon]) => (
            <button key={id} onClick={() => setKind(id)}
              className={`no-drag flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${kind === id ? 'bg-accent text-black' : 'text-zinc-400 hover:text-white'}`}>
              <Icon size={13} /> {lbl}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={generate} disabled={generating}
            className="no-drag flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-accent text-black hover:bg-accent/90 transition-colors disabled:opacity-50">
            {generating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Generar ahora
          </button>
          <button onClick={send} disabled={sending || !current}
            className="no-drag flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-surface border border-border text-zinc-200 hover:border-accent/50 transition-colors disabled:opacity-40">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviar por email
          </button>
          <button onClick={printReport} disabled={!current}
            className="no-drag flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-surface border border-border text-zinc-400 hover:text-white transition-colors disabled:opacity-40">
            <Printer size={13} /> Imprimir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Visor del informe */}
        <div className="bg-card border border-border rounded-xl overflow-hidden min-h-[560px]">
          {loading ? (
            <div className="h-[560px] flex items-center justify-center text-zinc-600 text-sm">
              <Loader2 size={16} className="animate-spin mr-2" /> Cargando…
            </div>
          ) : current?.html ? (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className="text-accent shrink-0" />
                  <span className="text-sm text-white truncate">{current.title || current.period_label}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-zinc-500 shrink-0">
                  <span className="flex items-center gap-1"><Clock size={11} /> {fmtDate(current.created_at)}</span>
                  {current.sent_at
                    ? <span className="flex items-center gap-1 text-green-400"><Mail size={11} /> Enviado</span>
                    : <span className="flex items-center gap-1 text-zinc-600"><Mail size={11} /> No enviado</span>}
                </div>
              </div>
              <iframe
                ref={iframeRef}
                title="informe"
                srcDoc={current.html}
                className="w-full"
                style={{ height: 900, border: 'none', background: '#0a0a0a' }}
              />
            </>
          ) : (
            <div className="h-[560px] flex flex-col items-center justify-center text-center px-6">
              <FileText size={32} className="text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-400">Todavía no hay ningún informe {kind === 'week' ? 'semanal' : 'mensual'} generado.</p>
              <p className="text-xs text-zinc-600 mt-1">Tocá <b className="text-accent">Generar ahora</b> para crear el primero.</p>
            </div>
          )}
        </div>

        {/* Historial */}
        <div className="bg-card border border-border rounded-xl overflow-hidden h-fit">
          <div className="px-4 py-2.5 border-b border-border">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Historial</h3>
          </div>
          <div className="divide-y divide-border max-h-[540px] overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-zinc-600">Sin informes guardados</p>
            ) : list.map(r => (
              <button key={r.id} onClick={() => openReport(r.id)}
                className={`no-drag w-full text-left px-4 py-2.5 transition-colors hover:bg-white/5 ${current?.id === r.id ? 'bg-accent/10' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-200 truncate">{r.period_label}</span>
                  {r.sent_at && <Mail size={11} className="text-green-400 shrink-0" />}
                </div>
                <span className="text-[10px] text-zinc-600">{fmtDate(r.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-zinc-600">
        Los informes se guardan localmente y se pueden ver sin internet. El envío automático se configura en
        <span className="text-zinc-400"> Configuración → Email → Informes</span>.
      </p>
    </motion.div>
  )
}
