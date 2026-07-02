'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'esl.workspace_id'

interface Party {
  id: string
  name: string
  party_type?: string
  country?: string
  status?: string
  last_screened_at?: string | null
  next_due_at?: string | null
}

interface RescreenSchedule {
  id: string
  workspace_id: string
  party_id: string | null
  cadence: string
  next_due_at: string | null
  last_run_at: string | null
  on_change: boolean
  on_new_version: boolean
  created_at?: string
}

const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly', 'annual']

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function daysFromNow(d?: string | null): number | null {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return Math.round((dt.getTime() - Date.now()) / 86_400_000)
}

export default function RescreenPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [due, setDue] = useState<Party[]>([])
  const [schedules, setSchedules] = useState<RescreenSchedule[]>([])

  const [tab, setTab] = useState<'queue' | 'schedules'>('queue')
  const [query, setQuery] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RescreenSchedule | null>(null)
  const [form, setForm] = useState({ cadence: 'monthly', on_change: true, on_new_version: true, next_due_at: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const loadData = useCallback(async (wsId: string, soft = false) => {
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [dueRes, schedRes] = await Promise.all([
        api.getRescreenDue(wsId),
        api.listRescreenSchedules(wsId),
      ])
      setDue(Array.isArray(dueRes) ? dueRes : [])
      setSchedules(Array.isArray(schedRes) ? schedRes : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load re-screen data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let wsId = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        if (!wsId) {
          const ws = await api.listWorkspaces()
          wsId = Array.isArray(ws) && ws.length ? ws[0].id : null
          if (wsId && typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, wsId)
        }
        if (cancelled) return
        if (!wsId) {
          setError('No workspace found. Create or seed a workspace first.')
          setLoading(false)
          return
        }
        setWorkspaceId(wsId)
        await loadData(wsId)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadData])

  const filteredDue = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return due
    return due.filter((p) => p.name?.toLowerCase().includes(q) || p.country?.toLowerCase().includes(q))
  }, [due, query])

  const overdueCount = useMemo(
    () => due.filter((p) => { const d = daysFromNow(p.next_due_at); return d !== null && d < 0 }).length,
    [due],
  )
  const dueSoonCount = useMemo(
    () => due.filter((p) => { const d = daysFromNow(p.next_due_at); return d !== null && d >= 0 && d <= 7 }).length,
    [due],
  )

  const workspaceDefault = useMemo(() => schedules.find((s) => !s.party_id) ?? null, [schedules])

  function openCreate() {
    setEditing(null)
    setForm({ cadence: 'monthly', on_change: true, on_new_version: true, next_due_at: '' })
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(s: RescreenSchedule) {
    setEditing(s)
    setForm({
      cadence: s.cadence ?? 'monthly',
      on_change: !!s.on_change,
      on_new_version: !!s.on_new_version,
      next_due_at: s.next_due_at ? s.next_due_at.slice(0, 10) : '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submit() {
    if (!workspaceId) return
    setSaving(true)
    setFormError(null)
    try {
      const payload: Record<string, unknown> = {
        cadence: form.cadence,
        on_change: form.on_change,
        on_new_version: form.on_new_version,
      }
      if (form.next_due_at) payload.next_due_at = new Date(form.next_due_at).toISOString()
      if (editing) {
        await api.updateRescreenSchedule(editing.id, payload)
      } else {
        await api.saveRescreenSchedule({ workspace_id: workspaceId, party_id: null, ...payload })
      }
      setModalOpen(false)
      await loadData(workspaceId, true)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  async function remove(s: RescreenSchedule) {
    if (!workspaceId) return
    if (!confirm('Delete this re-screen schedule?')) return
    try {
      await api.deleteRescreenSchedule(s.id)
      await loadData(workspaceId, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete schedule')
    }
  }

  if (loading) return <FullPageSpinner label="Loading re-screen queue..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Re-screening</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Parties due or overdue for re-screening, plus the cadence schedules that drive them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshing && <Spinner />}
          <Button variant="secondary" onClick={() => workspaceId && loadData(workspaceId, true)}>
            Refresh
          </Button>
          <Button onClick={openCreate}>New schedule</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Due / overdue" value={due.length} tone={due.length ? 'amber' : 'default'} />
        <Stat label="Overdue" value={overdueCount} tone={overdueCount ? 'red' : 'default'} />
        <Stat label="Due within 7d" value={dueSoonCount} tone={dueSoonCount ? 'amber' : 'default'} />
        <Stat label="Schedules" value={schedules.length} />
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {([
          ['queue', `Due queue (${due.length})`],
          ['schedules', `Schedules (${schedules.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-b-2 border-lime-500 text-lime-400'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-200">Due / overdue queue</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search party or country..."
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
            />
          </CardHeader>
          <CardBody className="p-0">
            {filteredDue.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title={due.length === 0 ? 'Nothing due' : 'No matching parties'}
                  description={
                    due.length === 0
                      ? 'All parties are within their re-screening cadence. New items appear here when a schedule comes due or a list version changes.'
                      : 'Adjust your search to see due parties.'
                  }
                  icon="⏱"
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Party</TH>
                    <TH>Country</TH>
                    <TH>Status</TH>
                    <TH>Last screened</TH>
                    <TH>Due</TH>
                    <TH className="text-right">Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredDue.map((p) => {
                    const dd = daysFromNow(p.next_due_at)
                    const overdue = dd !== null && dd < 0
                    return (
                      <TR key={p.id}>
                        <TD>
                          <Link href={`/dashboard/parties/${p.id}`} className="font-medium text-zinc-100 hover:text-lime-400">
                            {p.name}
                          </Link>
                          {p.party_type && <div className="text-xs text-zinc-600">{p.party_type}</div>}
                        </TD>
                        <TD>{p.country || '—'}</TD>
                        <TD>
                          {p.status ? <Badge tone={statusTone(p.status)}>{p.status.replace(/_/g, ' ')}</Badge> : '—'}
                        </TD>
                        <TD className="text-zinc-400">{fmtDate(p.last_screened_at)}</TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <span className={overdue ? 'text-red-400' : 'text-zinc-300'}>{fmtDate(p.next_due_at)}</span>
                            {dd !== null && (
                              <Badge tone={overdue ? 'red' : dd <= 7 ? 'amber' : 'zinc'}>
                                {overdue ? `${Math.abs(dd)}d overdue` : dd === 0 ? 'today' : `in ${dd}d`}
                              </Badge>
                            )}
                          </div>
                        </TD>
                        <TD className="text-right">
                          <Link href={`/dashboard/parties/${p.id}`}>
                            <Button variant="secondary" className="px-3 py-1">Open</Button>
                          </Link>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'schedules' && (
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200">Cadence schedules</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {workspaceDefault
                  ? `Workspace default cadence: ${workspaceDefault.cadence}`
                  : 'No workspace default cadence set'}
              </p>
            </div>
            <Button onClick={openCreate}>New schedule</Button>
          </CardHeader>
          <CardBody className="p-0">
            {schedules.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No schedules yet"
                  description="Create a workspace default cadence to automatically queue re-screenings. Per-party schedules are created from each party's detail page."
                  icon="🗓"
                  action={<Button onClick={openCreate}>Create default schedule</Button>}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Scope</TH>
                    <TH>Cadence</TH>
                    <TH>Triggers</TH>
                    <TH>Next due</TH>
                    <TH>Last run</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {schedules.map((s) => (
                    <TR key={s.id}>
                      <TD>
                        {s.party_id ? (
                          <Link href={`/dashboard/parties/${s.party_id}`} className="text-zinc-100 hover:text-lime-400">
                            Per-party
                          </Link>
                        ) : (
                          <Badge tone="amber">Workspace default</Badge>
                        )}
                      </TD>
                      <TD className="capitalize text-zinc-100">{s.cadence}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {s.on_change && <Badge tone="blue">on change</Badge>}
                          {s.on_new_version && <Badge tone="blue">on new version</Badge>}
                          {!s.on_change && !s.on_new_version && <span className="text-zinc-600">cadence only</span>}
                        </div>
                      </TD>
                      <TD className="text-zinc-400">{fmtDate(s.next_due_at)}</TD>
                      <TD className="text-zinc-400">{fmtDate(s.last_run_at)}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" className="px-3 py-1" onClick={() => openEdit(s)}>
                            Edit
                          </Button>
                          <Button variant="danger" className="px-3 py-1" onClick={() => remove(s)}>
                            Delete
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
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit schedule' : 'New re-screen schedule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create schedule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Cadence</label>
            <select
              value={form.cadence}
              onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            >
              {CADENCES.map((c) => (
                <option key={c} value={c} className="capitalize">{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Next due (optional)</label>
            <input
              type="date"
              value={form.next_due_at}
              onChange={(e) => setForm((f) => ({ ...f, next_due_at: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.on_change}
                onChange={(e) => setForm((f) => ({ ...f, on_change: e.target.checked }))}
                className="h-4 w-4 accent-lime-500"
              />
              Re-screen when party details change
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.on_new_version}
                onChange={(e) => setForm((f) => ({ ...f, on_new_version: e.target.checked }))}
                className="h-4 w-4 accent-lime-500"
              />
              Re-screen when a list publishes a new version
            </label>
          </div>
          {!editing && (
            <p className="text-xs text-zinc-600">
              This creates the workspace default schedule. Per-party schedules are managed from a party&apos;s detail page.
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
