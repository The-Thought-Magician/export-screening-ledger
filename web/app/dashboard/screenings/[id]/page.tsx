'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge, statusTone } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ScoreBreakdown {
  [key: string]: number | string | undefined
}

interface Match {
  id: string
  screening_id: string
  party_id?: string | null
  list_entry_id?: string | null
  list_version_id?: string | null
  score?: number | null
  score_breakdown?: ScoreBreakdown | null
  matched_name?: string | null
  decision?: string | null
  decision_reason?: string | null
  reviewer_id?: string | null
  decided_at?: string | null
  created_at?: string
}

interface ScreeningDetail {
  id: string
  workspace_id: string
  party_id?: string | null
  party_name?: string | null
  list_version_ids?: string[] | null
  engine_config?: Record<string, unknown> | null
  trigger?: string | null
  match_count?: number | null
  status?: string | null
  run_by?: string | null
  created_at?: string
  matches?: Match[] | null
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

function pct(score?: number | null): string {
  if (score == null) return '—'
  // scores may be 0..1 or 0..100; normalize for display
  const v = score <= 1 ? score * 100 : score
  return `${v.toFixed(1)}%`
}

function scoreTone(score?: number | null): 'red' | 'amber' | 'green' {
  if (score == null) return 'amber'
  const v = score <= 1 ? score : score / 100
  if (v >= 0.85) return 'red'
  if (v >= 0.6) return 'amber'
  return 'green'
}

export default function ScreeningDetailPage() {
  const params = useParams<{ id: string }>()
  const screeningId = params?.id

  const [screening, setScreening] = useState<ScreeningDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [decisionFilter, setDecisionFilter] = useState('all')

  const load = useCallback(async () => {
    if (!screeningId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getScreening(screeningId)
      setScreening((res ?? null) as ScreeningDetail | null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load screening')
    } finally {
      setLoading(false)
    }
  }, [screeningId])

  useEffect(() => {
    load()
  }, [load])

  const matches = useMemo(() => asArray<Match>(screening?.matches), [screening])

  const decisions = useMemo(() => {
    const set = new Set<string>()
    for (const m of matches) if (m.decision) set.add(m.decision)
    return Array.from(set).sort()
  }, [matches])

  const filteredMatches = useMemo(() => {
    if (decisionFilter === 'all') return matches
    return matches.filter((m) => (m.decision ?? '') === decisionFilter)
  }, [matches, decisionFilter])

  const decisionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const mt of matches) {
      const k = (mt.decision || 'pending').toLowerCase()
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [matches])

  const topScore = useMemo(
    () => matches.reduce((mx, m) => Math.max(mx, m.score ?? 0), 0),
    [matches],
  )

  if (loading) return <FullPageSpinner label="Loading screening..." />

  if (error && !screening) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/screenings" className="text-sm text-lime-400 hover:text-lime-300">
          ← Back to screenings
        </Link>
        <EmptyState
          title="Could not load screening"
          description={error}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  if (!screening) {
    return (
      <EmptyState title="Screening not found" description="This screening run does not exist." />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/screenings" className="text-sm text-lime-400 hover:text-lime-300">
          ← Back to screenings
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
                {screening.party_id ? (
                  <Link
                    href={`/dashboard/parties/${screening.party_id}`}
                    className="hover:text-lime-400"
                  >
                    {screening.party_name || 'Party screening'}
                  </Link>
                ) : (
                  screening.party_name || 'Screening run'
                )}
              </h1>
              {screening.status && <Badge tone={statusTone(screening.status)}>{screening.status}</Badge>}
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Run {fmtDate(screening.created_at)}
              {screening.trigger ? ` · trigger: ${screening.trigger}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Matches"
          value={matches.length}
          tone={matches.length > 0 ? 'amber' : 'green'}
        />
        <Stat label="Top score" value={pct(topScore)} tone={scoreTone(topScore) === 'green' ? 'default' : scoreTone(topScore)} />
        <Stat label="Pending" value={decisionCounts.get('pending') ?? 0} />
        <Stat label="Lists screened" value={asArray(screening.list_version_ids).length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-200">
              Resulting matches <span className="text-zinc-500">({filteredMatches.length})</span>
            </h2>
            {decisions.length > 0 && (
              <select
                value={decisionFilter}
                onChange={(e) => setDecisionFilter(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500/60 focus:outline-none"
              >
                <option value="all">All decisions</option>
                {decisions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </CardHeader>
          <CardBody className="p-0">
            {matches.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No matches"
                  description="This screening run found no entries above the match threshold. The party is clear against the screened lists."
                />
              </div>
            ) : filteredMatches.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No matches with that decision" description="Change the filter to see matches." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Matched name</TH>
                    <TH className="text-right">Score</TH>
                    <TH>Breakdown</TH>
                    <TH>Decision</TH>
                    <TH className="text-right">Review</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredMatches.map((m) => (
                    <TR key={m.id}>
                      <TD className="text-zinc-100">
                        <div className="font-medium">{m.matched_name || '—'}</div>
                        {m.decision_reason && (
                          <div className="mt-0.5 text-xs text-zinc-500">{m.decision_reason}</div>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Badge tone={scoreTone(m.score)}>{pct(m.score)}</Badge>
                      </TD>
                      <TD>
                        <ScoreBars breakdown={m.score_breakdown} />
                      </TD>
                      <TD>
                        {m.decision ? (
                          <Badge tone={statusTone(m.decision)}>{m.decision}</Badge>
                        ) : (
                          <Badge tone="amber">pending</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Link
                          href={`/dashboard/matches/${m.id}`}
                          className="text-xs text-lime-400 hover:text-lime-300"
                        >
                          Adjudicate →
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Run details</h2>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Detail label="Screening ID" value={<span className="font-mono text-xs">{screening.id}</span>} />
            <Detail label="Trigger" value={screening.trigger || '—'} />
            <Detail label="Run by" value={screening.run_by || '—'} />
            <Detail label="Created" value={fmtDate(screening.created_at)} />
            <Detail
              label="List versions"
              value={
                asArray(screening.list_version_ids).length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    {asArray<string>(screening.list_version_ids).map((id, i) => (
                      <Link
                        key={`${id}-${i}`}
                        href={`/dashboard/list-versions/${id}`}
                        className="font-mono text-xs text-lime-400 hover:text-lime-300"
                      >
                        {id.slice(0, 8)}
                      </Link>
                    ))}
                  </div>
                ) : (
                  '—'
                )
              }
            />
            {screening.engine_config && Object.keys(screening.engine_config).length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Engine config
                </div>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                  {JSON.stringify(screening.engine_config, null, 2)}
                </pre>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-right text-zinc-300">{value}</span>
    </div>
  )
}

function ScoreBars({ breakdown }: { breakdown?: ScoreBreakdown | null }) {
  if (!breakdown || typeof breakdown !== 'object') return <span className="text-zinc-600">—</span>
  const numeric = Object.entries(breakdown).filter(
    ([, v]) => typeof v === 'number' && Number.isFinite(v),
  ) as [string, number][]
  if (numeric.length === 0) return <span className="text-zinc-600">—</span>
  return (
    <div className="min-w-[8rem] space-y-1">
      {numeric.map(([k, v]) => {
        const w = v <= 1 ? v * 100 : Math.min(v, 100)
        return (
          <div key={k} className="flex items-center gap-2">
            <span className="w-16 shrink-0 truncate text-[10px] uppercase tracking-wide text-zinc-500">
              {k}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-800">
              <div className="h-full rounded bg-lime-500" style={{ width: `${w}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-zinc-500">
              {w.toFixed(0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
