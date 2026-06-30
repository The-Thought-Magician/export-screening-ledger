'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

const WS_KEY = 'esl.workspace_id'

interface Workspace {
  id: string
  name: string
  slug?: string
}

interface Metrics {
  parties_by_status?: Record<string, number>
  total_parties?: number
  open_matches?: number
  overdue_rescreens?: number
  blocked_orders?: number
  throughput?: number
  screenings_total?: number
  matches_total?: number
  [k: string]: unknown
}

interface TrendPoint {
  date?: string
  label?: string
  [k: string]: unknown
}

interface Trends {
  screenings?: TrendPoint[]
  matches?: TrendPoint[]
  decisions?: TrendPoint[]
  series?: { name: string; points: TrendPoint[] }[]
  [k: string]: unknown
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// Normalizes a trends payload into a list of named series of {label, value}.
function normalizeTrends(t: Trends | null): { name: string; points: { label: string; value: number }[] }[] {
  if (!t) return []
  if (Array.isArray(t.series)) {
    return t.series.map((s) => ({
      name: s.name,
      points: (s.points ?? []).map((p, i) => ({
        label: String(p.label ?? p.date ?? i + 1),
        value: num((p as Record<string, unknown>).value ?? (p as Record<string, unknown>).count),
      })),
    }))
  }
  const out: { name: string; points: { label: string; value: number }[] }[] = []
  for (const key of ['screenings', 'matches', 'decisions'] as const) {
    const arr = t[key]
    if (Array.isArray(arr) && arr.length) {
      out.push({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        points: arr.map((p, i) => ({
          label: String(p.label ?? p.date ?? i + 1),
          value: num((p as Record<string, unknown>).value ?? (p as Record<string, unknown>).count),
        })),
      })
    }
  }
  return out
}

function Sparkline({ points }: { points: { label: string; value: number }[] }) {
  if (!points.length) {
    return <div className="flex h-32 items-center justify-center text-xs text-zinc-600">No data</div>
  }
  const w = 480
  const h = 120
  const pad = 8
  const max = Math.max(1, ...points.map((p) => p.value))
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0
  const coords = points.map((p, i) => {
    const x = pad + step * i
    const y = h - pad - (p.value / max) * (h - pad * 2)
    return { x, y, ...p }
  })
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${h - pad} L${coords[0].x.toFixed(1)},${h - pad} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" preserveAspectRatio="none">
      <path d={area} fill="rgb(245 158 11 / 0.12)" />
      <path d={line} fill="none" stroke="rgb(245 158 11)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={2.5} fill="rgb(245 158 11)" />
      ))}
    </svg>
  )
}

const STATUS_ORDER = ['clear', 'flagged', 'blocked', 'needs_rescreen', 'unscreened']

export default function DashboardOverview() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [trends, setTrends] = useState<Trends | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const loadWorkspaces = useCallback(async () => {
    const ws: Workspace[] = (await api.listWorkspaces()) ?? []
    setWorkspaces(ws)
    if (!ws.length) {
      setWorkspaceId('')
      return ''
    }
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
    const chosen = ws.find((w) => w.id === stored)?.id ?? ws[0].id
    setWorkspaceId(chosen)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, chosen)
    return chosen
  }, [])

  const loadData = useCallback(async (wsId: string) => {
    const [m, t] = await Promise.all([api.getMetrics(wsId), api.getTrends(wsId)])
    setMetrics(m)
    setTrends(t)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const wsId = await loadWorkspaces()
      if (wsId) await loadData(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [loadWorkspaces, loadData])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const switchWorkspace = async (id: string) => {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
    setLoading(true)
    setError(null)
    try {
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const seed = async () => {
    setSeeding(true)
    setError(null)
    try {
      const res = await api.seedDemo({})
      const newId = res?.workspace_id
      if (newId && typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, newId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed demo data')
    } finally {
      setSeeding(false)
    }
  }

  const byStatus = useMemo(() => {
    const raw = metrics?.parties_by_status ?? {}
    const entries = STATUS_ORDER.filter((s) => s in raw).map((s) => [s, num(raw[s])] as const)
    for (const [k, v] of Object.entries(raw)) {
      if (!STATUS_ORDER.includes(k)) entries.push([k, num(v)])
    }
    return entries
  }, [metrics])

  const totalParties = useMemo(() => {
    if (typeof metrics?.total_parties === 'number') return metrics.total_parties
    return byStatus.reduce((a, [, v]) => a + v, 0)
  }, [metrics, byStatus])

  const series = useMemo(() => normalizeTrends(trends), [trends])

  if (loading) return <FullPageSpinner label="Loading overview..." />

  const hasWorkspace = workspaces.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Overview</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Compliance posture across parties, matches, re-screens, and order gates.
          </p>
        </div>
        {hasWorkspace && (
          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-wide text-zinc-500">Workspace</label>
            <select
              value={workspaceId}
              onChange={(e) => void switchWorkspace(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!hasWorkspace ? (
        <EmptyState
          icon={<span>🗂️</span>}
          title="No workspace yet"
          description="Seed a synthetic demo workspace to explore the screening ledger with parties, lists, near-match decoys, orders, and decisions."
          action={
            <Button onClick={seed} disabled={seeding}>
              {seeding ? <Spinner label="Seeding..." /> : 'Seed demo workspace'}
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Parties" value={totalParties} />
            <Stat
              label="Open matches"
              value={num(metrics?.open_matches)}
              tone={num(metrics?.open_matches) > 0 ? 'amber' : 'default'}
              hint="Pending or escalated"
            />
            <Stat
              label="Overdue re-screens"
              value={num(metrics?.overdue_rescreens)}
              tone={num(metrics?.overdue_rescreens) > 0 ? 'amber' : 'default'}
            />
            <Stat
              label="Blocked orders"
              value={num(metrics?.blocked_orders)}
              tone={num(metrics?.blocked_orders) > 0 ? 'red' : 'default'}
            />
            <Stat
              label="Throughput"
              value={num(metrics?.throughput ?? metrics?.screenings_total)}
              hint="Screenings run"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Parties by status</h2>
                <Link href="/dashboard/parties" className="text-xs text-amber-400 hover:text-amber-300">
                  View register
                </Link>
              </CardHeader>
              <CardBody className="space-y-3">
                {byStatus.length === 0 ? (
                  <p className="text-sm text-zinc-500">No parties recorded.</p>
                ) : (
                  byStatus.map(([status, count]) => {
                    const pct = totalParties > 0 ? Math.round((count / totalParties) * 100) : 0
                    return (
                      <div key={status}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <Badge tone={statusTone(status)}>{status.replace(/_/g, ' ')}</Badge>
                          <span className="tabular-nums text-zinc-400">
                            {count} <span className="text-zinc-600">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-amber-500/70"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })
                )}
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <h2 className="text-sm font-semibold text-zinc-200">Activity trends</h2>
              </CardHeader>
              <CardBody className="space-y-6">
                {series.length === 0 ? (
                  <p className="text-sm text-zinc-500">No trend data available yet.</p>
                ) : (
                  series.map((s) => (
                    <div key={s.name}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          {s.name}
                        </span>
                        <span className="text-xs tabular-nums text-zinc-500">
                          {s.points.reduce((a, p) => a + p.value, 0)} total
                        </span>
                      </div>
                      <Sparkline points={s.points} />
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/dashboard/parties/new">
              <Button>Add party</Button>
            </Link>
            <Link href="/dashboard/screenings/run">
              <Button variant="secondary">Run screening</Button>
            </Link>
            <Button variant="ghost" onClick={seed} disabled={seeding}>
              {seeding ? <Spinner label="Seeding..." /> : 'Seed another demo workspace'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
