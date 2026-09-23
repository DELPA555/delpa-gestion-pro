import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HelpCircle, GraduationCap, ListChecks, BookOpen, MessageCircle, Info, Gamepad2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { SUPPORT, waLink, openExternal } from '@/lib/support'

const ACCENT = '#e91e8c'

export default function HelpMenu() {
  const [open, setOpen] = useState(false)
  const [about, setAbout] = useState(false)
  const [version, setVersion] = useState('')
  const [training, setTraining] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.updater?.version?.().then(setVersion).catch(() => {})
    api.training.status().then((s) => setTraining(!!s.active)).catch(() => {})
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    const onTr = (e) => setTraining(!!e.detail)
    window.addEventListener('training:changed', onTr)
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('training:changed', onTr) }
  }, [])

  const item = (Icon, label, onClick, extra) => (
    <button onClick={() => { setOpen(false); onClick() }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5">
      <Icon size={16} className="text-zinc-400 shrink-0" /> <span className="flex-1">{label}</span>{extra}
    </button>
  )

  const toggleTraining = async () => {
    const next = !training
    try {
      await api.training.toggle(next)
      setTraining(next)
      window.dispatchEvent(new CustomEvent('training:changed', { detail: next }))
    } catch {}
  }

  return (
    <div ref={ref} className="relative no-drag">
      <button onClick={() => setOpen((v) => !v)} title="Ayuda" className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white">
        <HelpCircle size={17} />
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[100000] w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          {item(GraduationCap, 'Ver tour completo', () => window.dispatchEvent(new CustomEvent('tour:start')))}
          {item(ListChecks, 'Ver checklist de configuración', () => { navigate('/'); window.dispatchEvent(new CustomEvent('onboarding:open')) })}
          {item(BookOpen, 'Ir a tutoriales', () => openExternal(`${SUPPORT.webUrl}/tutoriales`))}
          {item(MessageCircle, 'Soporte WhatsApp', () => openExternal(waLink('Hola, necesito ayuda con DELPA Gestión PRO')))}
          {item(Info, 'Acerca de DELPA', () => setAbout(true))}
          <div className="border-t border-border" />
          {item(Gamepad2, 'Modo entrenamiento', toggleTraining,
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${training ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-zinc-500'}`}>{training ? 'ON' : 'OFF'}</span>)}
        </div>
      )}

      {about && (
        <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/60 p-4" onClick={() => setAbout(false)}>
          <div className="w-full max-w-sm rounded-2xl border p-6 text-center" style={{ background: '#181818', borderColor: ACCENT }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setAbout(false)} className="absolute right-4 top-4 text-zinc-500 hover:text-white"><X size={18} /></button>
            <h3 className="text-lg font-bold text-white">DELPA Gestión PRO</h3>
            {version && <p className="mt-1 text-sm text-zinc-400">Versión {version}</p>}
            <div className="mt-4 space-y-1 text-sm text-zinc-300">
              <p>📱 WhatsApp: <button onClick={() => openExternal(waLink())} className="font-semibold hover:underline" style={{ color: ACCENT }}>{SUPPORT.tel || SUPPORT.phoneDisplay}</button></p>
              <p>🌐 <button onClick={() => openExternal(SUPPORT.webUrl)} className="hover:underline" style={{ color: ACCENT }}>{SUPPORT.web}</button></p>
              <p>✉️ {SUPPORT.email}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
