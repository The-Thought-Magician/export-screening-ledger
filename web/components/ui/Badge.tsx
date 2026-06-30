import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'amber' | 'green' | 'red' | 'blue' | 'zinc' | 'orange'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  neutral: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  zinc: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  red: 'bg-red-500/15 text-red-400 border-red-500/30',
  blue: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
}

// Maps common domain status strings to a tone so pages can pass a raw status.
export function statusTone(status?: string): Tone {
  switch ((status ?? '').toLowerCase()) {
    case 'clear':
    case 'cleared':
    case 'released':
    case 'active':
    case 'ok':
      return 'green'
    case 'flagged':
    case 'pending':
    case 'pending_review':
    case 'needs_rescreen':
    case 'escalated':
    case 'draft':
      return 'amber'
    case 'blocked':
    case 'overridden':
    case 'error':
      return 'red'
    case 'unscreened':
      return 'zinc'
    default:
      return 'neutral'
  }
}

export function Badge({ tone = 'neutral', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
