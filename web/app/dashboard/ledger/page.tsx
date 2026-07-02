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

interface LedgerEntry {
  id: string
  workspace_id: string
  seq: number
  event_type: string
  entity_type: string
  entity_id: string
  actor_id?: string | null
  payload?: Record<string, unknown> | null
  prev_hash?: string | null
  hash: string
  created_at?: string
}

interface VerifyResult {
  ok: boolean
  broken_at?: number | null
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-lime-500/60 focus:outline-none focus:ring-1 focus:ring-lime-500/40'
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500'

function eventTone(ev: string) {
  if (ev.includes('block') || ev.includes('delete') || ev.includes('override')) return 'red' as const
  if (ev.includes('flag') || ev.includes('escalat') || ev.includes('rescreen')) return 'amber' as const
  if (ev.includes('clear') || ev.includes('release') || ev.includes('activate') || ev.includes('create'))
    return 'green' as const
  if (ev.includes('screen') || ev.includes('export') || ev.includes('match')) return 'blue' as const
  return 'neutral' as const
}

function fmtTime(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function shortHash(h?: string | null) {
  if (!h) return '—'
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h
}

export default function LedgerPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])

  const [entityType, setEntityType] = useState('')
  const [eventType, setEventType] = useState('')
  const [entityId, setEntityId] = useState('')
  const [search, setSearch] = useState('')

  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [verifying, setVerifying] = useState(false)

  const [detail, setDetail] = useState<LedgerEntry | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  const load = useCallback(
    async (wsId: string, opts?: { entity_type?: string; entity_id?: string; event_type?: string }) => {
      setError(null)
      try {
        const res = await api.listLedger(wsId, {
          entity_type: opts?.entity_type || undefined,
          entity_id: opts?.entity_id || undefined,
          event_type: opts?.event_type || undefined,
        })
        const list: LedgerEntry[] = Array.isArray(res) ? res : []
        list.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
        setEntries(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load ledger')
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const ws = await api.listWorkspaces()
        const wlist = Array.isArray(ws) ? ws : []
        if (cancelled) return
        if (wlist.length === 0) {
          setError('No workspace found. Create a workspace first.')
          setLoading(false)
          return
        }
        const wsId = wlist[0].id
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

  const entityTypes = useMemo(
    () => Array.from(new Set(entries.map((e) => e.entity_type).filter(Boolean))).sort(),
    [entries],
  )
  const eventTypes = useMemo(
    () => Array.from(new Set(entries.map((e) => e.event_type).filter(Boolean))).sort(),
    [entries],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.event_type?.toLowerCase().includes(q) ||
        e.entity_type?.toLowerCase().includes(q) ||
        e.entity_id?.toLowerCase().includes(q) ||
        (e.actor_id ?? '').toLowerCase().includes(q) ||
        e.hash?.toLowerCase().includes(q),
    )
  }, [entries, search])

  const stats = useMemo(() => {
    const last = entries[0]
    return {
      total: entries.length,
      maxSeq: entries.reduce((m, e) => Math.max(m, e.seq ?? 0), 0),
      entityKinds: entityTypes.length,
      lastAt: last?.created_at,
    }
  }, [entries, entityTypes])

  async function applyFilters() {
    if (!workspaceId) return
    await load(workspaceId, { entity_type: entityType, event_type: eventType, entity_id: entityId })
  }

  async function clearFilters() {
    if (!workspaceId) return
    setEntityType('')
    setEventType('')
    setEntityId('')
    setSearch('')
    await load(workspaceId)
  }

  async function runVerify() {
    if (!workspaceId) return
    setVerifying(true)
    setVerify(null)
    try {
      const res = await api.verifyLedger(workspaceId)
      setVerify(res as VerifyResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  async function openDetail(e: LedgerEntry) {
    setDetailOpen(true)
    setDetail(e)
    setDetailLoading(true)
    try {
      const full = await api.getLedgerEntry(e.id)
      if (full) setDetail(full as LedgerEntry)
    } catch {
      // fall back to row data already shown
    } finally {
      setDetailLoading(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading audit ledger..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Audit Ledger</h1>
        <p className="text-sm text-zinc-500">
          Append-only, hash-chained record of every compliance-relevant event. Verify the chain to prove the record has
          not been tampered with.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Ledger Entries" value={stats.total} />
        <Stat label="Latest Seq" value={`#${stats.maxSeq}`} />
        <Stat label="Entity Kinds" value={stats.entityKinds} />
        <Stat label="Last Event" value={stats.lastAt ? fmtTime(stats.lastAt).split(',')[0] : '—'} hint={stats.lastAt ? fmtTime(stats.lastAt) : undefined} />
      </div>

      {/* Chain verification */}
      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-300">Hash-chain integrity</span>
            {verify == null ? (
              <Badge tone="zinc">not verified</Badge>
            ) : verify.ok ? (
              <Badge tone="green">verified intact</Badge>
            ) : (
              <Badge tone="red">broken at seq #{verify.broken_at ?? '?'}</Badge>
            )}
          </div>
          <Button onClick={runVerify} disabled={verifying}>
            {verifying ? <Spinner /> : 'Verify Chain'}
          </Button>
        </CardBody>
        {verify && !verify.ok && (
          <div className="border-t border-red-500/30 bg-red-500/10 px-5 py-3 text-sm text-red-400">
            Chain integrity check failed. The hash chain diverges at sequence #{verify.broken_at ?? '?'} — entries from
            that point may have been altered or removed.
          </div>
        )}
        {verify && verify.ok && (
          <div className="border-t border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-400">
            All {entries.length} entries form an unbroken hash chain. The audit record is intact.
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <span className="text-sm font-medium text-zinc-300">Filters</span>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={labelCls}>Entity Type</label>
              <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={inputCls}>
                <option value="">All</option>
                {entityTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Event Type</label>
              <select value={eventType} onChange={(e) => setEventType(e.target.value)} className={inputCls}>
                <option value="">All</option>
                {eventTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Entity ID</label>
              <input
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="Exact entity id"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Quick Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter loaded rows..."
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={applyFilters}>Apply Filters</Button>
            <Button variant="secondary" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Ledger table */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-300">
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={entries.length === 0 ? 'No ledger entries yet' : 'No matches'}
                description={
                  entries.length === 0
                    ? 'Compliance events (screenings, decisions, order gates, list activations) will appear here as they occur.'
                    : 'No entries match the current filters.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Seq</TH>
                  <TH>Event</TH>
                  <TH>Entity</TH>
                  <TH>Actor</TH>
                  <TH>Hash</TH>
                  <TH>Time</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id} className="cursor-pointer" onClick={() => openDetail(e)}>
                    <TD className="font-mono text-xs text-zinc-500">#{e.seq}</TD>
                    <TD>
                      <Badge tone={eventTone(e.event_type)}>{e.event_type}</Badge>
                    </TD>
                    <TD>
                      <div className="text-zinc-200">{e.entity_type}</div>
                      <div className="font-mono text-[11px] text-zinc-600">{shortHash(e.entity_id)}</div>
                    </TD>
                    <TD className="font-mono text-xs text-zinc-400">{e.actor_id ? shortHash(e.actor_id) : 'system'}</TD>
                    <TD className="font-mono text-[11px] text-lime-400/80">{shortHash(e.hash)}</TD>
                    <TD className="whitespace-nowrap text-xs text-zinc-500">{fmtTime(e.created_at)}</TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          openDetail(e)
                        }}
                      >
                        Inspect
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={detail ? `Ledger Entry #${detail.seq}` : 'Ledger Entry'}>
        {detailLoading && !detail ? (
          <Spinner label="Loading entry..." />
        ) : detail ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={labelCls}>Event</div>
                <Badge tone={eventTone(detail.event_type)}>{detail.event_type}</Badge>
              </div>
              <div>
                <div className={labelCls}>Sequence</div>
                <div className="font-mono text-zinc-200">#{detail.seq}</div>
              </div>
              <div>
                <div className={labelCls}>Entity Type</div>
                <div className="text-zinc-200">{detail.entity_type}</div>
              </div>
              <div>
                <div className={labelCls}>Actor</div>
                <div className="font-mono text-xs text-zinc-300">{detail.actor_id || 'system'}</div>
              </div>
              <div className="col-span-2">
                <div className={labelCls}>Entity ID</div>
                <div className="break-all font-mono text-xs text-zinc-300">{detail.entity_id}</div>
              </div>
              <div className="col-span-2">
                <div className={labelCls}>Timestamp</div>
                <div className="text-zinc-300">{fmtTime(detail.created_at)}</div>
              </div>
            </div>

            <div>
              <div className={labelCls}>Hash Chain</div>
              <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px]">
                <div>
                  <span className="text-zinc-600">prev: </span>
                  <span className="break-all text-zinc-400">{detail.prev_hash || '∅ (genesis)'}</span>
                </div>
                <div>
                  <span className="text-zinc-600">hash: </span>
                  <span className="break-all text-lime-400">{detail.hash}</span>
                </div>
              </div>
            </div>

            <div>
              <div className={labelCls}>Payload</div>
              <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
                {detail.payload ? JSON.stringify(detail.payload, null, 2) : '—'}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-500">No entry selected.</div>
        )}
      </Modal>
    </div>
  )
}
