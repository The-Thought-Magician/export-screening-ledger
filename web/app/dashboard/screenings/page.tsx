'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'esl_workspace_id'

interface Screening {
  id: string
  workspace_id: string
  party_id?: string | null
  party_name?: string | null
  list_version_ids?: string[] | null
  trigger?: string | null
  match_count?: number | null
  status?: string | null
  run_by?: string | null
  created_at?: string
}

interface Segment {
  id: string
  workspace_id: string
  name: string
  filters?: Record<string, unknown> | null
  created_at?: string
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleString()
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(WS_KEY)
    if (stored) return stored
  }
  try {
    const ws = await api.listWorkspaces()
    const list = asArray<{ id: string }>(ws)
    if (list[0]?.id) {
      if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, list[0].id)
      return list[0].id
    }
  } catch {
    /* ignore */
  }
  return null
}

export default function ScreeningsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noWorkspace, setNoWorkspace] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Run modal
  const [runOpen, setRunOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runMode, setRunMode] = useState<'all' | 'segment'>('all')
  const [segmentId, setSegmentId] = useState('')
  const [runResult, setRunResult] = useState<{ count: number; matches: number } | null>(null)

  const load = useCallback(async (wsId: string) => {
    setLoading(true)
    setError(null)
    try {
      const [scr, segs] = await Promise.all([
        api.listScreenings(wsId),
        api.listSegments(wsId).catch(() => []),
      ])
      setScreenings(asArray<Screening>(scr))
      setSegments(asArray<Segment>(segs))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load screenings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const wsId = await resolveWorkspaceId()
      if (cancelled) return
      if (!wsId) {
        setNoWorkspace(true)
        setLoading(false)
        return
      }
      setWorkspaceId(wsId)
      await load(wsId)
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const statuses = useMemo(() => {
    const set = new Set<string>()
    for (const s of screenings) if (s.status) set.add(s.status)
    return Array.from(set).sort()
  }, [screenings])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return screenings.filter((s) => {
      if (statusFilter !== 'all' && (s.status ?? '') !== statusFilter) return false
      if (!q) return true
      const hay = [s.party_name ?? '', s.party_id ?? '', s.trigger ?? '', s.id, s.status ?? '']
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [screenings, search, statusFilter])

  const totalMatches = useMemo(
    () => screenings.reduce((acc, s) => acc + (s.match_count ?? 0), 0),
    [screenings],
  )
  const withMatches = useMemo(
    () => screenings.filter((s) => (s.match_count ?? 0) > 0).length,
    [screenings],
  )

  // simple SVG sparkline of matches per run (most recent last)
  const sparkPoints = useMemo(() => {
    const ordered = [...screenings].sort(
      (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime(),
    )
    return ordered.map((s) => s.match_count ?? 0)
  }, [screenings])

  const runSegment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    setRunning(true)
    setRunError(null)
    setRunResult(null)
    try {
      const body: Record<string, unknown> = { workspace_id: workspaceId }
      if (runMode === 'segment') {
        if (!segmentId) {
          setRunError('Select a segment to screen.')
          setRunning(false)
          return
        }
        body.segment_id = segmentId
      }
      const res = await api.runSegmentScreening(body)
      const created = asArray((res as { screenings?: unknown })?.screenings)
      const matches = Number((res as { total_matches?: number })?.total_matches ?? 0)
      setRunResult({ count: created.length, matches })
      await load(workspaceId)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to run screening')
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading screenings..." />

  if (noWorkspace) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create or seed a workspace before running screenings."
        action={
          <Link href="/dashboard">
            <Button variant="secondary">Go to dashboard</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Screening Runs</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Batch screen parties against active denied-party lists.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/screenings/run">
            <Button variant="secondary">Screen one party</Button>
          </Link>
          <Button
            onClick={() => {
              setRunOpen(true)
              setRunResult(null)
              setRunError(null)
            }}
          >
            Run screening
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
          {workspaceId && (
            <button
              className="ml-3 underline hover:text-red-300"
              onClick={() => load(workspaceId)}
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total runs" value={screenings.length} />
        <Stat label="Total matches" value={totalMatches} tone={totalMatches > 0 ? 'amber' : 'default'} />
        <Stat label="Runs with hits" value={withMatches} tone={withMatches > 0 ? 'amber' : 'default'} />
        <Stat label="Saved segments" value={segments.length} />
      </div>

      {sparkPoints.length > 1 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Matches per run (chronological)</h2>
          </CardHeader>
          <CardBody>
            <Sparkline values={sparkPoints} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Runs <span className="text-zinc-500">({filtered.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search runs..."
              className="w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {screenings.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No screening runs yet"
                description="Run a screening across all parties or a saved segment to find list matches."
                action={<Button onClick={() => setRunOpen(true)}>Run screening</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No matching runs" description="Adjust filters or search." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Party</TH>
                  <TH>Trigger</TH>
                  <TH>Lists</TH>
                  <TH className="text-right">Matches</TH>
                  <TH>Status</TH>
                  <TH>Run at</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD className="text-zinc-100">
                      <div className="font-medium">{s.party_name || s.party_id || '—'}</div>
                    </TD>
                    <TD>
                      {s.trigger ? <Badge tone="zinc">{s.trigger}</Badge> : <span className="text-zinc-600">—</span>}
                    </TD>
                    <TD className="text-xs text-zinc-400">{asArray(s.list_version_ids).length || '—'}</TD>
                    <TD className="text-right">
                      <span
                        className={`tabular-nums font-medium ${
                          (s.match_count ?? 0) > 0 ? 'text-amber-400' : 'text-zinc-400'
                        }`}
                      >
                        {s.match_count ?? 0}
                      </span>
                    </TD>
                    <TD>
                      {s.status ? <Badge tone={statusTone(s.status)}>{s.status}</Badge> : <span className="text-zinc-600">—</span>}
                    </TD>
                    <TD className="text-xs text-zinc-500">{fmtDate(s.created_at)}</TD>
                    <TD className="text-right">
                      <Link
                        href={`/dashboard/screenings/${s.id}`}
                        className="text-xs text-amber-400 hover:text-amber-300"
                      >
                        View →
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={runOpen}
        onClose={() => {
          if (!running) setRunOpen(false)
        }}
        title="Run screening"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRunOpen(false)} disabled={running}>
              {runResult ? 'Close' : 'Cancel'}
            </Button>
            <Button type="submit" form="run-form" disabled={running}>
              {running ? 'Running...' : 'Run screening'}
            </Button>
          </>
        }
      >
        <form id="run-form" onSubmit={runSegment} className="space-y-4">
          {runError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {runError}
            </div>
          )}
          {runResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
              Completed {runResult.count} screening run{runResult.count === 1 ? '' : 's'} with{' '}
              {runResult.matches} total match{runResult.matches === 1 ? '' : 'es'}.
            </div>
          )}
          <div className="space-y-2">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="run-mode"
                checked={runMode === 'all'}
                onChange={() => setRunMode('all')}
                className="mt-1 accent-amber-500"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-200">All parties</span>
                <span className="block text-xs text-zinc-500">
                  Screen every party in the workspace against active lists.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="run-mode"
                checked={runMode === 'segment'}
                onChange={() => setRunMode('segment')}
                disabled={segments.length === 0}
                className="mt-1 accent-amber-500"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-200">Saved segment</span>
                <span className="block text-xs text-zinc-500">
                  {segments.length === 0
                    ? 'No saved segments available.'
                    : 'Screen only parties matching a saved filter.'}
                </span>
              </span>
            </label>
          </div>
          {runMode === 'segment' && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Segment</span>
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
              >
                <option value="">Select a segment…</option>
                {segments.map((seg) => (
                  <option key={seg.id} value={seg.id}>
                    {seg.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form>
      </Modal>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const w = 600
  const h = 80
  const max = Math.max(1, ...values)
  const n = values.length
  const step = n > 1 ? w / (n - 1) : w
  const pts = values
    .map((v, i) => `${i * step},${h - (v / max) * (h - 8) - 4}`)
    .join(' ')
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full min-w-[320px]" preserveAspectRatio="none">
        <polyline
          points={pts}
          fill="none"
          stroke="rgb(245 158 11)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        {values.map((v, i) => (
          <circle
            key={i}
            cx={i * step}
            cy={h - (v / max) * (h - 8) - 4}
            r={2.5}
            fill={v > 0 ? 'rgb(245 158 11)' : 'rgb(113 113 122)'}
          />
        ))}
      </svg>
    </div>
  )
}
