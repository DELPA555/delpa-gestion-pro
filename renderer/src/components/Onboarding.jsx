import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, Circle, ChevronRight, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'

export default function Onboarding() {
  const [status, setStatus] = useState(null)
  const [visible, setVisible] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const s = await api.onboarding.status()
      setStatus(s)
      if (!s.dismissed && s.completedCount < s.total) setVisible(true)
    } catch {}
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 2500)
    return () => clearTimeout(t)
  }, [load])

  const dismiss = async () => {
    setVisible(false)
    await api.onboarding.dismiss().catch(() => {})
  }

  const goTo = async (route) => {
    await api.onboarding.dismiss().catch(() => {})
    setVisible(false)
    navigate(route)
  }

  if (!visible || !status) return null

  const pct = Math.round((status.completedCount / status.total) * 100)
  const allDone = status.completedCount === status.total

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 320 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 320 }}
        transition={{ type: 'spring', damping: 22, stiffness: 250 }}
        className="fixed bottom-6 right-6 z-[150] w-80 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-accent/15 to-purple-500/10 px-4 py-3 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <div>
              <p className="text-sm font-semibold text-white">Primeros pasos</p>
              <p className="text-[10px] text-zinc-500">{status.completedCount} de {status.total} completados</p>
            </div>
          </div>
          <button onClick={dismiss} className="no-drag text-zinc-500 hover:text-white transition-colors p-1">
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-4 pt-3 pb-1">
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ delay: 0.3, duration: 0.5 }}
            />
          </div>
          <p className="text-[10px] text-zinc-600 text-right mt-0.5">{pct}%</p>
        </div>

        {/* Task list */}
        <div className="px-2 pb-2 space-y-0.5 max-h-64 overflow-y-auto">
          {status.tasks.map(task => (
            <div
              key={task.id}
              className={`flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors ${
                task.completed ? 'opacity-50' : 'hover:bg-white/[0.04]'
              }`}
            >
              {task.completed
                ? <CheckCircle size={15} className="text-accent shrink-0" />
                : <Circle size={15} className="text-zinc-600 shrink-0" />
              }
              <span className={`text-xs flex-1 ${task.completed ? 'text-zinc-500 line-through' : 'text-zinc-300'}`}>
                {task.label}
              </span>
              {!task.completed && (
                <button
                  onClick={() => goTo(task.route)}
                  className="no-drag shrink-0 flex items-center gap-0.5 text-[10px] text-accent hover:underline"
                >
                  Ir <ChevronRight size={10} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        {allDone && (
          <div className="px-4 py-3 bg-accent/10 border-t border-accent/20 text-center">
            <p className="text-xs font-semibold text-accent">🎉 ¡Completaste todos los pasos!</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Tu negocio está listo para despegar.</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
