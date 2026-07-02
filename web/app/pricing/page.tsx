'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const included = [
  'Unlimited parties, lists, and list versions',
  'Deterministic fuzzy matching with explainable scores',
  'Structured Cleared / Blocked / Escalated adjudication',
  'Re-screen cadence and overdue queue',
  'Order & transaction gate with override-with-justification',
  'Embargo and end-use rule enforcement',
  'Hash-chained immutable decision ledger',
  'One-click defensible audit exports',
  'Metrics dashboard and saved reports',
  'Synthetic demo data seeder',
]

export default function Pricing() {
  const [plan, setPlan] = useState<string>('Free')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.getBillingPlan()
        if (cancelled) return
        const name = res?.plan?.name ?? res?.subscription?.plan_id ?? 'Free'
        setPlan(typeof name === 'string' ? name : 'Free')
      } catch {
        // public page: ignore (unauthenticated visitors get 401 from the proxy)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-lg font-bold">
          <span className="inline-block h-6 w-6 rounded bg-lime-500" />
          ExportScreening<span className="text-lime-400">Ledger</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-zinc-300 hover:text-zinc-100">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-lime-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-lime-400"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Pricing</h1>
        <p className="mt-4 text-zinc-400">
          Every feature is free while ExportScreeningLedger is in early access. No card required.
        </p>

        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-lime-500/30 bg-zinc-900 p-8 text-left">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Free</h2>
            <span className="rounded-md border border-lime-500/30 bg-lime-500/10 px-2 py-0.5 text-xs font-medium text-lime-400">
              All features
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-4xl font-black">$0</span>
            <span className="text-zinc-500">/ month</span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            {loaded ? `Your current plan: ${plan}.` : 'Loading current plan...'}
          </p>

          <ul className="mt-6 space-y-2">
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="mt-0.5 text-lime-400">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <Link
            href="/auth/sign-up"
            className="mt-8 block rounded-lg bg-lime-500 py-3 text-center text-sm font-semibold text-zinc-950 hover:bg-lime-400"
          >
            Start free
          </Link>
        </div>

        <p className="mt-10 text-sm text-zinc-600">
          Paid plans with team seats and SSO are coming. Everything you build now carries forward.
        </p>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-600">
        <p>ExportScreeningLedger</p>
      </footer>
    </main>
  )
}
