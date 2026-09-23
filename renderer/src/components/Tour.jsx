import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

const ACCENT = '#e91e8c'
const CARD_W = 360
const PAD = 8

// Motor de tour guiado con overlay + spotlight. Navega entre módulos y espera a
// que aparezca el elemento (data-tour="..."); si no aparece, muestra el paso al centro.
export default function Tour({ open, steps = [], onClose }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => { if (open) { setI(0); setRect(null) } }, [open])

  const posicionar = useCallback(() => {
    const step = steps[i]
    if (!step) return
    if (step.center || !step.sel) { setRect(null); return }
    const el = document.querySelector(step.sel)
    if (el) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }) } catch {}
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
  }, [i, steps])

  // Al cambiar de paso: navegar si hace falta y buscar el elemento (con reintentos).
  useEffect(() => {
    if (!open) return
    const step = steps[i]
    if (!step) return
    if (step.route && location.pathname !== step.route) { navigate(step.route); return }
    if (step.center || !step.sel) { setRect(null); return }
    let tries = 0, timer
    const buscar = () => {
      const el = document.querySelector(step.sel)
      if (el) { posicionar(); return }
      if (tries++ < 12) timer = setTimeout(buscar, 150)
      else setRect(null) // fallback: centrado
    }
    buscar()
    return () => clearTimeout(timer)
  }, [open, i, location.pathname, steps, navigate, posicionar])

  useEffect(() => {
    if (!open) return
    const onR = () => posicionar()
    window.addEventListener('resize', onR)
    return () => window.removeEventListener('resize', onR)
  }, [open, posicionar])

  if (!open || steps.length === 0) return null

  const step = steps[i]
  const ultimo = i === steps.length - 1
  const skip = () => onClose?.('skip')
  const finish = () => onClose?.('done')

  let cardStyle
  if (rect) {
    const vw = window.innerWidth, vh = window.innerHeight
    let left = rect.left + rect.width + 16
    if (left + CARD_W > vw - 12) left = rect.left - CARD_W - 16
    if (left < 12) left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12)
    let top = Math.min(Math.max(12, rect.top), vh - 260)
    cardStyle = { position: 'fixed', left, top, width: CARD_W, zIndex: 100000 }
  } else {
    cardStyle = { position: 'fixed', left: '50%', top: '50%', width: CARD_W, transform: 'translate(-50%, -50%)', zIndex: 100000 }
  }

  return (
    <div className="fixed inset-0" style={{ zIndex: 99990 }}>
      {/* Bloquea clics sobre la app durante el tour */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* Spotlight con box-shadow gigante, o backdrop plano si es paso centrado */}
      {rect ? (
        <div className="absolute rounded-xl" style={{
          top: rect.top - PAD, left: rect.left - PAD,
          width: rect.width + PAD * 2, height: rect.height + PAD * 2,
          boxShadow: `0 0 0 9999px rgba(0,0,0,0.75)`, border: `2px solid ${ACCENT}`,
          transition: 'all .2s ease', pointerEvents: 'none',
        }} />
      ) : (
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.75)' }} />
      )}

      {/* Card del paso */}
      <div style={{ ...cardStyle, background: '#181818', border: `1px solid ${ACCENT}` }} className="rounded-2xl p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: ACCENT }}>Paso {i + 1} de {steps.length}</span>
          <button onClick={skip} title="Cerrar" className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-white"><X size={16} /></button>
        </div>
        <h3 className="text-lg font-bold text-white">{step.title}</h3>
        <p className="mt-1 whitespace-pre-line text-sm text-zinc-300">{step.body}</p>

        <div className="mt-4 flex items-center gap-1.5">
          {steps.map((_, k) => (
            <span key={k} className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 20 : 6, background: k === i ? ACCENT : '#3f3f46' }} />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button onClick={skip} className="text-xs font-medium text-zinc-500 hover:text-zinc-300">Saltar tour</button>
          <div className="flex gap-2">
            {i > 0 && (
              <button onClick={() => setI((n) => n - 1)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-transparent px-3 py-1.5 text-sm font-semibold text-zinc-200 hover:bg-white/5">
                <ChevronLeft size={15} /> Anterior
              </button>
            )}
            {ultimo ? (
              <button onClick={finish} className="rounded-lg px-4 py-1.5 text-sm font-bold text-white" style={{ background: ACCENT }}>{step.finish || 'Finalizar'}</button>
            ) : (
              <button onClick={() => setI((n) => n + 1)} className="inline-flex items-center gap-1 rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ background: ACCENT }}>
                Siguiente <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
