import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

const ACCENT = '#e91e8c'
const PAD = 6

// Motor de tour guiado ROBUSTO. La card SIEMPRE va centrada en pantalla (nunca
// anclada al elemento), así que jamás queda fuera de vista ni "pantalla negra".
// Si el elemento data-tour existe y es visible, dibujamos un recuadro brillante a
// su alrededor y scrolleamos hasta él; si no existe (otro módulo, tarda en montar,
// o tiene tamaño 0), simplemente mostramos la card centrada sin spotlight.
export default function Tour({ open, steps = [], onClose }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => { if (open) { setI(0); setRect(null) } }, [open])

  const step = steps[i]

  // Ubica el elemento resaltado del paso actual (o null si no aplica/no existe).
  const locate = useCallback(() => {
    const s = steps[i]
    if (!s || s.center || !s.sel) { setRect(null); return }
    const el = document.querySelector(s.sel)
    if (!el) { setRect(null); return }
    try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }) } catch {}
    const r = el.getBoundingClientRect()
    // Guard clave: un elemento con tamaño 0 (oculto / aún no pintado) devuelve
    // {0,0,0,0} → NO dibujamos spotlight, card centrada. Evita el spotlight roto.
    if (r.width > 0 && r.height > 0) {
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    } else {
      setRect(null)
    }
  }, [i, steps])

  // Al cambiar de paso: navegar si hace falta y buscar el elemento (con reintentos).
  useEffect(() => {
    if (!open || !step) return
    console.log(`[Tour] paso ${i + 1}/${steps.length}: "${step.title}" · sel=${step.sel || '(centrado)'} · route=${step.route || '-'}`)
    if (step.route && location.pathname !== step.route) { navigate(step.route); return }
    if (step.center || !step.sel) { setRect(null); return }
    let tries = 0, timer
    const find = () => {
      const el = document.querySelector(step.sel)
      if (el) { locate(); return }
      if (tries++ < 12) { timer = setTimeout(find, 150) }
      else { console.log(`[Tour] elemento no encontrado (${step.sel}) → card centrada, sin spotlight`); setRect(null) }
    }
    find()
    return () => clearTimeout(timer)
  }, [open, i, location.pathname, step, steps.length, navigate, locate])

  // Mantener el recuadro alineado al hacer resize o scroll.
  useEffect(() => {
    if (!open) return
    const onMove = () => locate()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => { window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true) }
  }, [open, locate])

  // Escape cierra; flechas navegan.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.('skip') }
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, steps.length, onClose])

  if (!open || steps.length === 0 || !step) return null

  const ultimo = i === steps.length - 1
  const skip = () => onClose?.('skip')
  const finish = () => onClose?.('done')

  return (
    <>
      {/* Backdrop plano — NO intercepta clics (la app sigue usable por debajo) */}
      <div className="fixed inset-0" style={{ zIndex: 9000, background: 'rgba(0,0,0,0.75)', pointerEvents: 'none' }} />

      {/* Recuadro brillante alrededor del elemento (solo si existe y es visible) */}
      {rect && (
        <div
          className="fixed rounded-xl"
          style={{
            zIndex: 9000,
            top: rect.top - PAD, left: rect.left - PAD,
            width: rect.width + PAD * 2, height: rect.height + PAD * 2,
            outline: `3px solid ${ACCENT}`,
            boxShadow: '0 0 0 3px rgba(233,30,140,0.35), 0 0 26px 8px rgba(233,30,140,0.55)',
            background: 'rgba(255,255,255,0.06)',
            transition: 'all .2s ease',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Card SIEMPRE centrada — clickeable */}
      <div
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
          width: '90%', maxWidth: 480, zIndex: 9001,
          background: '#181818', border: `1px solid ${ACCENT}`, pointerEvents: 'auto',
        }}
        className="rounded-2xl p-8 shadow-2xl"
      >
        <div className="mb-2 flex items-start justify-between gap-4">
          <span className="text-xs font-semibold" style={{ color: ACCENT }}>Paso {i + 1} de {steps.length}</span>
          <button onClick={skip} title="Saltar tour (Esc)"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-white/10 hover:text-white">
            <X size={14} /> Saltar tour
          </button>
        </div>

        <h3 className="text-xl font-bold text-white leading-snug">{step.title}</h3>
        <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">{step.body}</p>

        <div className="mt-5 flex items-center gap-1.5">
          {steps.map((_, k) => (
            <span key={k} className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 20 : 6, background: k === i ? ACCENT : '#3f3f46' }} />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <button
            onClick={() => setI((n) => n - 1)}
            disabled={i === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={15} /> Anterior
          </button>
          {ultimo ? (
            <button onClick={finish} className="rounded-lg px-5 py-2 text-sm font-bold text-white" style={{ background: ACCENT }}>{step.finish || 'Finalizar'}</button>
          ) : (
            <button onClick={() => setI((n) => n + 1)} className="inline-flex items-center gap-1 rounded-lg px-5 py-2 text-sm font-semibold text-white" style={{ background: ACCENT }}>
              Siguiente <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </>
  )
}
