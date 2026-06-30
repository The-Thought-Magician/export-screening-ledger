'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ExportBundle {
  id: string
  workspace_id: string
  scope: string
  filters?: Record<string, unknown> | null
  manifest_hash: string
  entry_count: number
  payload?: Record<string, unknown> | null
  generated_by?: string | null
  created_at?: string
}

const SCOPES = [
  { value: 'full', label: 'Full audit bundle', desc: 'Every ledger event, screening, match decision and order in the workspace.' },
  { value: 'screenings', label: 'Screenings & matches', desc: 'Screening runs and their resulting match decisions.' },
  { value: 'orders', label: 'Orders & gate decisions', desc: 'All orders with gate evaluations and overrides.' },
  { value: 'ledger', label: 'Ledger only', desc: 'The hash-chained activity ledger.' },
  { value: 'parties', label: 'Party register', desc: 'All screened parties with current statuses.' },
]

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40'
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500'

function fmtDate(d?: string) {
  if (!d) return '—'
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return d
  return t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function shortHash(h?: string) {
  if (!h) return '—'
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h
}

function scopeTone(scope: string) {
  switch (scope) {
    case 'full':
      return 'amber' as const
    case 'ledger':
      return 'blue' as const
    case 'orders':
      return 'orange' as const
    default:
      return 'neutral' as const
  }
}

export default function ExportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [exports, setExports] = useState<ExportBundle[]>([])
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<string>('all')

  // Generate modal
  const [genOpen, setGenOpen] = useState(false)
  const [genScope, setGenScope] = useState('full')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [generating, setGenerating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Detail modal
  const [detail, setDetail] = useState<ExportBundle | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const data = await api.listExports(wsId)
      setExports(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load exports')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const ws = await api.listWorkspaces()
        const list = Array.isArray(ws) ? ws : []
        if (cancelled) return
        if (list.length === 0) {
          setError('No workspace found. Create a workspace first.')
          setLoading(false)
          return
        }
        const wsId = list[0].id
        setWorkspaceId(wsId)
        await load(wsId)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return exports.filter((e) => {
      if (scopeFilter !== 'all' && e.scope !== scopeFilter) return false
      if (!q) return true
      return (
        e.scope?.toLowerCase().includes(q) ||
        e.manifest_hash?.toLowerCase().includes(q) ||
        (e.generated_by ?? '').toLowerCase().includes(q)
      )
    })
  }, [exports, search, scopeFilter])

  const stats = useMemo(() => {
    const total = exports.length
    const entries = exports.reduce((s, e) => s + (e.entry_count || 0), 0)
    const fullCount = exports.filter((e) => e.scope === 'full').length
    const last = exports
      .map((e) => e.created_at)
      .filter(Boolean)
      .sort()
      .pop()
    return { total, entries, fullCount, last: last ? fmtDate(last) : '—' }
  }, [exports])

  const scopeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of exports) m.set(e.scope, (m.get(e.scope) ?? 0) + 1)
    return m
  }, [exports])

  function openGenerate() {
    setGenScope('full')
    setFilterStatus('')
    setFilterFrom('')
    setFilterTo('')
    setFormError(null)
    setGenOpen(true)
  }

  async function generate() {
    if (!workspaceId) return
    setGenerating(true)
    setFormError(null)
    try {
      const filters: Record<string, unknown> = {}
      if (filterStatus.trim()) filters.status = filterStatus.trim()
      if (filterFrom) filters.from = filterFrom
      if (filterTo) filters.to = filterTo
      await api.createExport({
        workspace_id: workspaceId,
        scope: genScope,
        filters,
      })
      setGenOpen(false)
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to generate export')
    } finally {
      setGenerating(false)
    }
  }

  async function openDetail(e: ExportBundle) {
    setDetail(e)
    setDetailLoading(true)
    try {
      const full = await api.getExport(e.id)
      if (full) setDetail(full)
    } catch {
      // keep summary if detail fails
    } finally {
      setDetailLoading(false)
    }
  }

  function downloadBundle(e: ExportBundle) {
    const blob = new Blob([JSON.stringify(e, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-${e.scope}-${e.id}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (loading) return <FullPageSpinner label="Loading export bundles..." />

  const maxScope = Math.max(1, ...Array.from(scopeCounts.values()))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Audit Exports</h1>
          <p className="text-sm text-zinc-500">
            Generate tamper-evident export bundles for auditors and regulators. Each bundle carries a manifest hash.
          </p>
        </div>
        <Button onClick={openGenerate}>Generate Export</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total Bundles" value={stats.total} />
        <Stat label="Records Captured" value={stats.entries.toLocaleString()} tone="amber" />
        <Stat label="Full Audit Bundles" value={stats.fullCount} />
        <Stat label="Last Generated" value={<span className="text-base">{stats.last}</span>} />
      </div>

      {exports.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Bundles by Scope</h2>
          </CardHeader>
          <CardBody className="space-y-2">
            {Array.from(scopeCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([scope, count]) => (
                <div key={scope} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 text-xs text-zinc-400">
                    <Badge tone={scopeTone(scope)}>{scope}</Badge>
                  </div>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${(count / maxScope) * 100}%` }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-sm tabular-nums text-zinc-300">{count}</div>
                </div>
              ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by scope, hash, author..."
              className={`${inputCls} sm:max-w-xs`}
            />
            <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className={`${inputCls} sm:max-w-[14rem]`}>
              <option value="all">All scopes</option>
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={openGenerate}>Generate Export</Button>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={exports.length === 0 ? 'No exports yet' : 'No matching bundles'}
                description={
                  exports.length === 0
                    ? 'Generate an audit export to produce a tamper-evident bundle with a manifest hash.'
                    : 'No bundles match your filters.'
                }
                action={exports.length === 0 ? <Button onClick={openGenerate}>Generate Export</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Scope</TH>
                  <TH>Manifest Hash</TH>
                  <TH className="text-right">Records</TH>
                  <TH>Generated By</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <Badge tone={scopeTone(e.scope)}>{e.scope}</Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-xs text-zinc-400" title={e.manifest_hash}>
                        {shortHash(e.manifest_hash)}
                      </span>
                    </TD>
                    <TD className="text-right tabular-nums text-zinc-200">{(e.entry_count ?? 0).toLocaleString()}</TD>
                    <TD className="text-zinc-500">{e.generated_by || '—'}</TD>
                    <TD className="text-zinc-500">{fmtDate(e.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => openDetail(e)}>
                          View
                        </Button>
                        <Button variant="secondary" onClick={() => downloadBundle(e)}>
                          Download
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Generate modal */}
      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate Audit Export"
        footer={
          <>
            <Button variant="secondary" onClick={() => setGenOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={generating}>
              {generating ? <Spinner label="Building bundle..." /> : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div>
            <label className={labelCls}>Scope</label>
            <div className="space-y-2">
              {SCOPES.map((s) => (
                <label
                  key={s.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    genScope === s.value
                      ? 'border-amber-500/60 bg-amber-500/10'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    value={s.value}
                    checked={genScope === s.value}
                    onChange={() => setGenScope(s.value)}
                    className="mt-1 h-4 w-4 accent-amber-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-100">{s.label}</span>
                    <span className="block text-xs text-zinc-500">{s.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Optional Filters</div>
            <div>
              <label className={labelCls}>Status</label>
              <input
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                placeholder="e.g. blocked, flagged (leave blank for all)"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>From</label>
                <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>To</label>
                <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Export Bundle"
        footer={
          <>
            {detail && (
              <Button variant="secondary" onClick={() => downloadBundle(detail)}>
                Download JSON
              </Button>
            )}
            <Button onClick={() => setDetail(null)}>Close</Button>
          </>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className={labelCls}>Scope</div>
                <Badge tone={scopeTone(detail.scope)}>{detail.scope}</Badge>
              </div>
              <div>
                <div className={labelCls}>Records</div>
                <div className="tabular-nums text-zinc-200">{(detail.entry_count ?? 0).toLocaleString()}</div>
              </div>
              <div className="col-span-2">
                <div className={labelCls}>Manifest Hash</div>
                <code className="block break-all rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-amber-400">
                  {detail.manifest_hash || '—'}
                </code>
              </div>
              <div>
                <div className={labelCls}>Generated By</div>
                <div className="text-zinc-300">{detail.generated_by || '—'}</div>
              </div>
              <div>
                <div className={labelCls}>Created</div>
                <div className="text-zinc-300">{fmtDate(detail.created_at)}</div>
              </div>
            </div>

            {detail.filters && Object.keys(detail.filters).length > 0 && (
              <div>
                <div className={labelCls}>Filters</div>
                <pre className="max-h-32 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
                  {JSON.stringify(detail.filters, null, 2)}
                </pre>
              </div>
            )}

            <div>
              <div className={labelCls}>Payload {detailLoading && <Spinner />}</div>
              <pre className="max-h-64 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400">
                {detail.payload ? JSON.stringify(detail.payload, null, 2) : detailLoading ? 'Loading…' : 'No payload preview available.'}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
