import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, X, Rocket, PartyPopper } from 'lucide-react'
import { api } from '@/lib/api'

const ACCENT = '#e91e8c'

// Confetti liviano sin dependencias: ~40 piezas cayendo ~1.3s.
function Confetti() {
  const colors = ['#e91e8c', '#22c55e', '#f59e0b', '#3b82f6', '#a855f7']
  const pieces = Array.from({ length: 40 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.3, dur: 0.9 + Math.random() * 0.6,
    color: colors[i % colors.length], rot: Math.random() * 360,
  }))
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 100002, overflow: 'hidden' }}>
      <style>{`@keyframes confFall{0%{transform:translateY(-20px) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:0}}`}</style>
      {pieces.map((p, i) => (
        <span key={i} style={{
          position: 'absolute', top: 0, left: `${p.left}%`, width: 8, height: 12, background: p.color,
          borderRadius: 2, transform: `rotate(${p.rot}deg)`,
          animation: `confFall ${p.dur}s ${p.delay}s ease-in forwards`,
        }} />
      ))}
    </div>
  )
}

export default function OnboardingChecklist() {
  const [data, setData] = useState(null)       // { tasks, completedCount, total, dismissed }
  const [visible, setVisible] = useState(true)
  const [confetti, setConfetti] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const prevCount = useRef(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const [status, drive] = await Promise.all([
        api.onboarding.status(),
        api.googledrive.status().catch(() => ({ connected: false })),
      ])
      // El paso "drive" no se puede chequear por SQL → se resuelve con googledrive.status
      const tasks = status.tasks.map((t) => t.external === 'drive' ? { ...t, completed: !!drive.connected } : t)
      const completedCount = tasks.filter((t) => t.completed).length
      const merged = { ...status, tasks, completedCount }
      // Confetti al completar un paso nuevo (no en la primera carga)
      if (prevCount.current != null && completedCount > prevCount.current) {
        setConfetti(true); setTimeout(() => setConfetti(false), 1400)
        if (completedCount === merged.total) setCelebrate(true)
      }
      prevCount.current = completedCount
      setData(merged)
    } catch {}
  }, [])

  useEffect(() => {
    load()
    const onOpen = () => { setVisible(true) }
    const onRefresh = () => load()
    window.addEventListener('onboarding:open', onOpen)
    window.addEventListener('onboarding:refresh', onRefresh)
    // Recargar al volver el foco a la ventana (después de configurar algo)
    window.addEventListener('focus', onRefresh)
    return () => {
      window.removeEventListener('onboarding:open', onOpen)
      window.removeEventListener('onboarding:refresh', onRefresh)
      window.removeEventListener('focus', onRefresh)
    }
  }, [load])

  if (!data) return null
  const { tasks, completedCount, total } = data
  const pct = Math.round((completedCount / total) * 100)
  const allDone = completedCount === total

  // La card desaparece cuando está todo completo o si la minimizaron (salvo reapertura).
  const hidden = allDone || !visible || data.dismissed
  const minimizar = async () => { setVisible(false); try { await api.onboarding.dismiss() } catch {} }

  return (
    <>
      {confetti && <Confetti />}

      {celebrate && (
        <div className="fixed inset-0 z-[100003] flex items-center justify-center bg-black/60 p-4" onClick={() => setCelebrate(false)}>
          <div className="w-full max-w-sm rounded-2xl border p-6 text-center" style={{ background: '#181818', borderColor: ACCENT }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: ACCENT + '22', color: ACCENT }}>
              <PartyPopper size={28} />
            </div>
            <h3 className="text-xl font-bold text-white">¡Tu tienda está lista al 100%! 🎉</h3>
            <p className="mt-2 text-sm text-zinc-400">Completaste toda la configuración inicial. Ya podés aprovechar DELPA al máximo.</p>
            <button onClick={() => setCelebrate(false)} className="mt-4 w-full rounded-lg py-2.5 text-sm font-bold text-white" style={{ background: ACCENT }}>¡Genial!</button>
          </div>
        </div>
      )}

      {!hidden && (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm" data-tour="onboarding">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: ACCENT + '22', color: ACCENT }}><Rocket size={18} /></div>
              <div>
                <h3 className="font-semibold text-white">Configurá tu tienda</h3>
                <p className="text-xs text-zinc-500">{completedCount} de {total} completados · {pct}%</p>
              </div>
            </div>
            <button onClick={minimizar} title="Ocultar por ahora" className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-white"><X size={16} /></button>
          </div>

          {/* Barra de progreso animada */}
          <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: ACCENT }} />
          </div>

          <div className="space-y-1.5">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5">
                <span className={`flex items-center gap-2 text-sm ${t.completed ? 'text-zinc-400' : 'text-zinc-200'}`}>
                  {t.completed
                    ? <CheckCircle2 size={17} className="text-green-500 shrink-0" />
                    : <Circle size={17} className="text-zinc-600 shrink-0" />}
                  <span className={t.completed ? 'line-through' : ''}>{t.label}</span>
                </span>
                {!t.completed && (
                  <button onClick={() => navigate(t.route)} className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90" style={{ background: ACCENT }}>
                    Hacer →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
