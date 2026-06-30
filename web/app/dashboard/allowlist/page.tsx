'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface AllowlistEntry {
  id: string
  workspace_id: string
  party_id: string
  party_name?: string | null
  list_entry_id?: string | null
  list_entry_name?: string | null
  reason: string
  expires_at?: string | null
  created_by?: string | null
  created_at?: string
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40'

function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function isExpired(s?: string | null) {
  if (!s) return false
  const d = new Date(s)
  if (isNaN(d.getTime())) return false
  return d.getTime() < Date.now()
}

export default function AllowlistPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<AllowlistEntry[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'expired'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const res = await api.listAllowlist(wsId)
      setEntries(Array.isArray(res) ? res : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load allowlist')
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

  const stats = useMemo(() => {
    const expired = entries.filter((e) => isExpired(e.expires_at)).length
    return {
      total: entries.length,
      active: entries.length - expired,
      expired,
      scoped: entries.filter((e) => e.list_entry_id).length,
    }
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      const expired = isExpired(e.expires_at)
      if (filter === 'active' && expired) return false
      if (filter === 'expired' && !expired) return false
      if (!q) return true
      return (
        (e.party_name ?? '').toLowerCase().includes(q) ||
        (e.list_entry_name ?? '').toLowerCase().includes(q) ||
        (e.reason ?? '').toLowerCase().includes(q) ||
        e.party_id.toLowerCase().includes(q)
      )
    })
  }, [entries, search, filter])

  async function remove(e: AllowlistEntry) {
    if (!workspaceId) return
    if (!confirm(`Remove suppression for ${e.party_name || e.party_id}? This party can match again on the next screening.`))
      return
    setBusyId(e.id)
    try {
      await api.deleteAllowlistEntry(e.id)
      await load(workspaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove entry')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <FullPageSpinner label="Loading allowlist..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Allowlist</h1>
        <p className="text-sm text-zinc-500">
          Suppressed false positives. Entries here prevent a party (optionally a specific list entry) from being flagged
          on future screenings.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Suppressions" value={stats.total} />
        <Stat label="Active" value={stats.active} tone="green" />
        <Stat label="Expired" value={stats.expired} tone={stats.expired > 0 ? 'amber' : 'default'} />
        <Stat label="Entry-Scoped" value={stats.scoped} hint="tied to a specific list entry" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search party, reason, list entry..."
            className={`${inputCls} sm:max-w-sm`}
          />
          <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {(['all', 'active', 'expired'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  filter === f ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={entries.length === 0 ? 'No suppressed false positives' : 'No matches'}
                description={
                  entries.length === 0
                    ? 'Suppressions are created from the match detail screen when a reviewer marks a match as a false positive.'
                    : 'No allowlist entries match the current filter.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Party</TH>
                  <TH>Scope</TH>
                  <TH>Reason</TH>
                  <TH>Expires</TH>
                  <TH>Suppressed</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => {
                  const expired = isExpired(e.expires_at)
                  return (
                    <TR key={e.id}>
                      <TD className="font-medium text-zinc-100">
                        {e.party_name || <span className="font-mono text-xs text-zinc-500">{e.party_id}</span>}
                      </TD>
                      <TD>
                        {e.list_entry_id ? (
                          <Badge tone="blue">{e.list_entry_name || 'specific entry'}</Badge>
                        ) : (
                          <Badge tone="neutral">all lists</Badge>
                        )}
                      </TD>
                      <TD className="max-w-sm truncate text-zinc-400">{e.reason || '—'}</TD>
                      <TD>
                        {e.expires_at ? (
                          <span className={expired ? 'text-red-400' : 'text-zinc-300'}>
                            {fmtDate(e.expires_at)}
                            {expired && ' (expired)'}
                          </span>
                        ) : (
                          <Badge tone="zinc">never</Badge>
                        )}
                      </TD>
                      <TD className="text-zinc-500">{fmtDate(e.created_at)}</TD>
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          className="text-red-400"
                          disabled={busyId === e.id}
                          onClick={() => remove(e)}
                        >
                          {busyId === e.id ? 'Removing...' : 'Remove'}
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
