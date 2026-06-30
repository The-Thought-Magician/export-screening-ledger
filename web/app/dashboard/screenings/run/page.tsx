'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Party {
  id: string
  name: string
  party_type?: string
  country?: string
  status?: string
  last_screened_at?: string | null
}

const WS_KEY = 'esl.workspace_id'

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

export default function RunScreeningPage() {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null)
  const [trigger, setTrigger] = useState('manual')

  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [result, setResult] = useState<any | null>(null)

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
      const data = (await api.listParties(wid)) as Party[]
      setParties(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load parties')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    return parties.filter((p) => {
      if (statusFilter && (p.status ?? '') !== statusFilter) return false
      if (query) {
        const q = query.toLowerCase()
        if (
          !p.name.toLowerCase().includes(q) &&
          !(p.country ?? '').toLowerCase().includes(q) &&
          !(p.party_type ?? '').toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [parties, statusFilter, query])

  const selectedParty = useMemo(
    () => parties.find((p) => p.id === selectedPartyId) ?? null,
    [parties, selectedPartyId],
  )

  const statuses = useMemo(() => {
    const s = new Set<string>()
    parties.forEach((p) => p.status && s.add(p.status))
    return Array.from(s).sort()
  }, [parties])

  async function runScreening() {
    if (!selectedPartyId || !workspaceId) return
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const res = await api.runScreening({
        workspace_id: workspaceId,
        party_id: selectedPartyId,
        trigger,
      })
      setResult(res)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Screening failed')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Loading parties..." />
      </div>
    )
  }

  if (!workspaceId) {
    return (
      <EmptyState
        title="No workspace found"
        description="Create or join a workspace before running a screening."
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
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-600">
          <Link href="/dashboard/screenings" className="hover:text-amber-400">
            Screenings
          </Link>
          <span>/</span>
          <span className="text-zinc-400">Run</span>
        </div>
        <h1 className="text-2xl font-semibold text-zinc-100">Run a screening</h1>
        <p className="text-sm text-zinc-500">
          Select a party to screen against the active versions of your sanctions and watch lists. The
          deterministic match engine records every hit in the immutable ledger.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Party picker */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">Choose a party</h2>
                <p className="text-xs text-zinc-500">{filtered.length} of {parties.length} parties</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search parties..."
                  className="w-44 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filtered.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    title="No parties match"
                    description={
                      parties.length === 0
                        ? 'Add parties to the register first.'
                        : 'Adjust your search or status filter.'
                    }
                    action={
                      parties.length === 0 ? (
                        <Link href="/dashboard/parties/new">
                          <Button>Add a party</Button>
                        </Link>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <ul className="max-h-[28rem] divide-y divide-zinc-800 overflow-y-auto">
                  {filtered.map((p) => {
                    const active = p.id === selectedPartyId
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedPartyId(p.id)}
                          className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors ${
                            active ? 'bg-amber-500/10' : 'hover:bg-zinc-900/60'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span
                              className={`inline-block h-3 w-3 rounded-full border ${
                                active ? 'border-amber-400 bg-amber-400' : 'border-zinc-600'
                              }`}
                              aria-hidden
                            />
                            <span className="flex flex-col">
                              <span className={`text-sm font-medium ${active ? 'text-amber-300' : 'text-zinc-200'}`}>
                                {p.name}
                              </span>
                              <span className="text-xs text-zinc-500">
                                {[p.party_type, p.country].filter(Boolean).join(' · ') || '—'}
                              </span>
                            </span>
                          </span>
                          {p.status && <Badge tone={statusTone(p.status)}>{p.status}</Badge>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Run panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Screening run</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Selected party</div>
                {selectedParty ? (
                  <div className="mt-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <div className="text-sm font-medium text-zinc-100">{selectedParty.name}</div>
                    <div className="text-xs text-zinc-500">
                      {[selectedParty.party_type, selectedParty.country].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {selectedParty.last_screened_at && (
                      <div className="mt-1 text-xs text-zinc-600">
                        Last screened {new Date(selectedParty.last_screened_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600">Pick a party from the list.</p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Trigger</label>
                <select
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
                >
                  <option value="manual">Manual</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="rescreen">Re-screen</option>
                  <option value="list_update">List update</option>
                </select>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                The screen runs against the active version of every active list in this workspace.
              </div>

              <Button
                onClick={runScreening}
                disabled={!selectedPartyId || running}
                className="w-full"
              >
                {running ? <Spinner label="Running..." /> : 'Run screening'}
              </Button>

              {runError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {runError}
                </div>
              )}
            </CardBody>
          </Card>

          {result && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Result</h2>
                <Badge tone={statusTone(result.status)}>{result.status ?? 'done'}</Badge>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Matches</div>
                    <div
                      className={`mt-1 text-2xl font-semibold tabular-nums ${
                        (result.match_count ?? result.matches?.length ?? 0) > 0
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {result.match_count ?? result.matches?.length ?? 0}
                    </div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">Lists screened</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                      {Array.isArray(result.list_version_ids) ? result.list_version_ids.length : '—'}
                    </div>
                  </div>
                </div>

                {Array.isArray(result.matches) && result.matches.length > 0 && (
                  <ul className="space-y-2">
                    {result.matches.slice(0, 8).map((m: any) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <Link
                            href={`/dashboard/matches/${m.id}`}
                            className="block truncate text-sm font-medium text-zinc-200 hover:text-amber-400"
                          >
                            {m.matched_name ?? 'Match'}
                          </Link>
                          {m.decision && (
                            <span className="text-xs text-zinc-500">{m.decision}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-400">
                          {typeof m.score === 'number' ? `${Math.round(m.score * 100)}%` : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {result.id && (
                    <Link href={`/dashboard/screenings/${result.id}`}>
                      <Button variant="secondary">View screening</Button>
                    </Link>
                  )}
                  <Link href="/dashboard/matches">
                    <Button variant="ghost">Go to adjudication queue</Button>
                  </Link>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
