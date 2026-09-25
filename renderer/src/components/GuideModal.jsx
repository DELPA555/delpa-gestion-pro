import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react'
import { SUPPORT, waLink, openExternal } from '@/lib/support'

const ACCENT = '#e91e8c'

// Modal de guía paso a paso para usuarios sin conocimientos técnicos.
// Props:
//   open, onClose
//   headerIcon (emoji), title, subtitle
//   steps: [{ icon, title, body, warn?, tip?, action?: {label, onClick} }]
//   finishLabel (texto del botón del último paso)
export default function GuideModal({ open, onClose, headerIcon, title, subtitle, steps = [], finishLabel = '✅ Entendido' }) {
  const [i, setI] = useState(0)

  useEffect(() => { if (open) setI(0) }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, steps.length, onClose])

  if (!open || steps.length === 0) return null

  const step = steps[i]
  const ultimo = i === steps.length - 1
  const pct = Math.round(((i + 1) / steps.length) * 100)

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full flex-col overflow-hidden rounded-[20px] shadow-2xl"
        style={{ maxWidth: 560, maxHeight: '80vh', background: '#111111', border: '1px solid #252525' }}
      >
        {/* Barra de progreso */}
        <div className="h-1.5 w-full" style={{ background: '#1e1e1e' }}>
          <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: ACCENT }} />
        </div>

        {/* Header */}
        <div className="flex items-start gap-3 px-6 pt-5 pb-4" style={{ borderBottom: '1px solid #1e1e1e' }}>
          <div className="text-[40px] leading-none shrink-0" aria-hidden>{headerIcon}</div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-zinc-400 leading-relaxed">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white" title="Cerrar">
            <X size={18} />
          </button>
        </div>

        {/* Contenido del paso (scroll interno) */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-3.5">
            <div className="text-[32px] leading-none shrink-0" aria-hidden>{step.icon}</div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>Paso {i + 1} de {steps.length}</p>
                <h3 className="mt-0.5 text-base font-bold text-white">{step.title}</h3>
              </div>
              <p className="whitespace-pre-line text-[15px] text-zinc-400" style={{ lineHeight: 1.8 }}>{step.body}</p>

              {step.warn && (
                <div className="rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed" style={{ background: 'rgba(245,158,11,0.06)', borderColor: 'rgba(245,158,11,0.25)', color: '#fcd34d' }}>
                  ⚠️ {step.warn}
                </div>
              )}
              {step.tip && (
                <div className="rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed" style={{ background: 'rgba(59,130,246,0.06)', borderColor: 'rgba(59,130,246,0.25)', color: '#93c5fd' }}>
                  💡 {step.tip}
                </div>
              )}
              {step.action && (
                <button
                  onClick={step.action.onClick}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: ACCENT }}
                >
                  {step.action.label}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 space-y-3" style={{ borderTop: '1px solid #1e1e1e' }}>
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setI((n) => n - 1)}
              disabled={i === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} /> Anterior
            </button>
            {ultimo ? (
              <button onClick={onClose} className="rounded-lg px-6 py-2.5 text-sm font-bold text-white" style={{ background: ACCENT }}>{finishLabel}</button>
            ) : (
              <button onClick={() => setI((n) => n + 1)} className="inline-flex items-center gap-1.5 rounded-lg px-6 py-2.5 text-sm font-semibold text-white" style={{ background: ACCENT }}>
                Siguiente <ChevronRight size={16} />
              </button>
            )}
          </div>
          <button
            onClick={() => openExternal(waLink())}
            className="w-full text-center text-[12px] text-zinc-500 hover:text-accent transition-colors flex items-center justify-center gap-1.5"
          >
            <MessageCircle size={12} /> Necesito ayuda → {SUPPORT.phoneDisplay}
          </button>
        </div>
      </div>
    </div>
  )
}
