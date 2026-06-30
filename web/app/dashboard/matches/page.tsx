'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Match {
  id: string
  screening_id?: string
  party_id?: string
  matched_name?: string
  party_name?: string
  list_name?: string
  score?: number
  decision?: string
  decision_reason?: string
  reviewer_id?: string | null
  decided_at?: string | null
  created_at?: string
}

const WS_KEY = 'esl.workspace_id'
const DECISIONS = ['pending', 'escalated', 'cleared', 'blocked']

async function resolveWorkspaceId(): Promise<string | null> {
  try {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
    const workspaces = (await api.listWorkspaces()) as { id: string }[]
    if (!Array.isArray(workspaces) || workspaces.length === 0) return null
    if (stored && workspaces.some((w) => w.id === stored)) return stored
    const first = workspaces[0].id
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, first)
    return first
  } catch {
    return null
  }
}

function scorePct(s?: number): string {
  if (typeof s !== 'number') return '—'
  return `${Math.round(s * 100)}%`
}

export default function MatchesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [queue, setQueue] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<'queue' | 'all'>('queue')
  const [decisionFilter, setDecisionFilter] = useState('')
  const [query, setQuery] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    const wid = await resolveWorkspaceId()
    if (!wid) {
      setWorkspaceId(null)
      setLoading(false)
      return
    }
    setWorkspaceId(wid)
    try {
      const [all, q] = await Promise.all([api.listMatches(wid), api.getMatchQueue(wid)])
      setMatches(Array.isArray(all) ? all : [])
      setQueue(Array.isArray(q) ? q : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load matches')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, escalated: 0, cleared: 0, blocked: 0 }
    matches.forEach((m) => {
      const d = m.decision ?? 'pending'
      c[d] = (c[d] ?? 0) + 1
    })
    return c
  }, [matches])

  const source = tab === 'queue' ? queue : matches

  const rows = useMemo(() => {
    return source.filter((m) => {
      if (tab === 'all' && decisionFilter && (m.decision ?? 'pending') !== decisionFilter) return false
      if (query) {
        const ql = query.toLowerCase()
        const hay = `${m.matched_name ?? ''} ${m.party_name ?? ''} ${m.list_name ?? ''}`.toLowerCase()
        if (!hay.includes(ql)) return false
      }
      return true
    })
  }, [source, tab, decisionFilter, query])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Loading matches..." />
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create or join a workspace to review matches."
        action={
          <Link href="/dashboard/settings">
            <Button>Go to settings</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Matches</h1>
          <p className="text-sm text-zinc-500">
            Adjudicate potential sanctions and watch-list hits. Every decision is written to the ledger.
          </p>
        </div>
        <Link href="/dashboard/screenings/run">
          <Button>Run a screening</Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Awaiting review" value={counts.pending + counts.escalated} tone="amber" hint="pending + escalated" />
        <Stat label="Pending" value={counts.pending} />
        <Stat label="Cleared" value={counts.cleared} tone="green" />
        <Stat label="Blocked" value={counts.blocked} tone="red" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <button
              onClick={() => setTab('queue')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === 'queue' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              Adjudication queue
              <span className="ml-2 rounded bg-black/20 px-1.5 text-xs tabular-nums">{queue.length}</span>
            </button>
            <button
              onClick={() => setTab('all')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === 'all' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              All matches
              <span className="ml-2 rounded bg-black/20 px-1.5 text-xs tabular-nums">{matches.length}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or list..."
              className="w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
            {tab === 'all' && (
              <select
                value={decisionFilter}
                onChange={(e) => setDecisionFilter(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
              >
                <option value="">All decisions</option>
                {DECISIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            <Button variant="ghost" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardBody className="p-0">
          {rows.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={tab === 'queue' ? 'Queue is clear' : 'No matches'}
                description={
                  tab === 'queue'
                    ? 'No pending or escalated matches need a decision right now.'
                    : 'No matches recorded yet. Run a screening to populate this list.'
                }
                action={
                  <Link href="/dashboard/screenings/run">
                    <Button variant="secondary">Run a screening</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Party</TH>
                  <TH>Matched name</TH>
                  <TH>List</TH>
                  <TH className="text-right">Score</TH>
                  <TH>Decision</TH>
                  <TH>When</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-medium text-zinc-200">{m.party_name ?? m.party_id ?? '—'}</TD>
                    <TD>{m.matched_name ?? '—'}</TD>
                    <TD className="text-zinc-400">{m.list_name ?? '—'}</TD>
                    <TD className="text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800 sm:inline-block">
                          <span
                            className="block h-full rounded-full bg-amber-500"
                            style={{ width: `${Math.round((m.score ?? 0) * 100)}%` }}
                          />
                        </span>
                        <span className="font-semibold tabular-nums text-amber-400">{scorePct(m.score)}</span>
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(m.decision ?? 'pending')}>{m.decision ?? 'pending'}</Badge>
                    </TD>
                    <TD className="text-xs text-zinc-500">
                      {m.decided_at
                        ? new Date(m.decided_at).toLocaleDateString()
                        : m.created_at
                          ? new Date(m.created_at).toLocaleDateString()
                          : '—'}
                    </TD>
                    <TD className="text-right">
                      <Link href={`/dashboard/matches/${m.id}`}>
                        <Button variant="secondary" className="px-3 py-1">
                          {(m.decision ?? 'pending') === 'pending' || m.decision === 'escalated'
                            ? 'Adjudicate'
                            : 'View'}
                        </Button>
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
