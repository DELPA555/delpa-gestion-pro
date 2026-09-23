// Botón ❓ que dispara el mini-tour de un módulo (window event 'tour:start').
// Uso: <HelpButton module="caja" /> en el header del módulo.
export default function HelpButton({ module, label = 'Ayuda', className = '' }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent('tour:start', { detail: { module } }))}
      title={`Ayuda de ${label}`}
      className={`no-drag flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-2.5 py-2 rounded-lg border border-border hover:bg-white/5 transition-colors ${className}`}
    >
      ❓ <span className="hidden sm:inline">Ayuda</span>
    </button>
  )
}
