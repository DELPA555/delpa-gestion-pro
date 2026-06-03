export default function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mb-4">
        {Icon && <Icon size={24} className="text-zinc-600" />}
      </div>
      <p className="text-zinc-400 font-medium text-sm">{title}</p>
      {subtitle && <p className="text-zinc-600 text-xs mt-1">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
