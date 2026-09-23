import { useEffect, useState } from 'react'
import { Gamepad2, X } from 'lucide-react'
import { api } from '@/lib/api'

// Banner amarillo mientras el modo entrenamiento está activo. Las ventas de práctica
// no afectan datos reales. Se apaga desde acá o desde el menú de ayuda.
export default function TrainingBanner() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    api.training.status().then((s) => setActive(!!s.active)).catch(() => {})
    const onChange = (e) => setActive(!!e.detail)
    window.addEventListener('training:changed', onChange)
    return () => window.removeEventListener('training:changed', onChange)
  }, [])

  if (!active) return null

  const salir = async () => {
    try { await api.training.toggle(false) } catch {}
    setActive(false)
    window.dispatchEvent(new CustomEvent('training:changed', { detail: false }))
  }

  return (
    <div className="shrink-0 flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-black">
      <Gamepad2 size={15} className="shrink-0" />
      <span className="text-xs font-bold uppercase tracking-wide">Modo entrenamiento activo — las ventas son de práctica y no se guardan</span>
      <button onClick={salir} className="ml-2 inline-flex items-center gap-1 rounded-md bg-black/15 px-2 py-0.5 text-xs font-semibold hover:bg-black/25">
        <X size={12} /> Salir
      </button>
    </div>
  )
}
