import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pagination({ page, pages, total, limit, onChange }) {
  if (pages <= 1) return null
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
      <span className="text-zinc-500">{from}-{to} de {total}</span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="px-2 text-zinc-400">{page}/{pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
