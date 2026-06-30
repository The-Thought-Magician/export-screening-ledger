interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2 text-zinc-400">
      <span
        className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-500 ${className}`}
        aria-hidden
      />
      {label && <span className="text-sm">{label}</span>}
    </span>
  )
}

export function FullPageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export default Spinner
