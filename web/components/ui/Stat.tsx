import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'amber' | 'red' | 'green'
}

const valueTones = {
  default: 'text-zinc-100',
  amber: 'text-lime-400',
  red: 'text-red-400',
  green: 'text-emerald-400',
}

export function Stat({ label, value, hint, tone = 'default' }: StatProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${valueTones[tone]}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export default Stat
