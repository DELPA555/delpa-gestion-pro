import { cn } from '@/lib/utils'

export function SkeletonPulse({ className }) {
  return <div className={cn('animate-pulse bg-white/[0.06] rounded', className)} />
}

export function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <SkeletonPulse className="h-3 w-20" />
      <SkeletonPulse className="h-7 w-32" />
      <SkeletonPulse className="h-3 w-24" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  const widths = ['w-full', 'w-3/4', 'w-1/2', 'w-2/3', 'w-5/6']
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonPulse
              key={j}
              className={cn('h-3 flex-1', widths[(i + j) % widths.length])}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export default SkeletonTable
