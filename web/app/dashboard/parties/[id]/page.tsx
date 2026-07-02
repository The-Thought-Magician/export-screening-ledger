'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Party {
  id: string
  workspace_id: string
  name: string
  party_type?: string | null
  country?: string | null
  address?: string | null
  identifiers?: Record<string, unknown> | null
  tags?: string[] | null
  status?: string | null
  notes?: string | null
  last_screened_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface Alias {
  id: string
  party_id: string
  alias: string
  created_at?: string | null
}

interface Screening {
  id: string
  party_id?: string
  trigger?: string | null
  match_count?: number | null
  status?: string | null
  created_at?: string | null
}

const STATUS_OPTIONS = ['unscreened', 'clear', 'flagged', 'blocked', 'needs_rescreen']
const PARTY_TYPES = ['individual', 'organization', 'vessel', 'aircraft']
const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly']

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString()
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export default function PartyDetailPage() {
  const params = useParams<{ id: string }>()
  const partyId = params?.id as string
  const router = useRouter()

  const [party, setParty] = useState<Party | null>(null)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [screenings, setScreenings] = useState<Screening[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit form
  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    party_type: '',
    country: '',
    address: '',
    status: '',
    tags: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)

  // Alias add
  const [newAlias, setNewAlias] = useState('')
  const [addingAlias, setAddingAlias] = useState(false)
  const [aliasErr, setAliasErr] = useState<string | null>(null)

  // Run screening
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)

  // Re-screen schedule
  const [schedOpen, setSchedOpen] = useState(false)
  const [sched, setSched] = useState({ cadence: 'weekly', on_change: true, on_new_version: true })
  const [savingSched, setSavingSched] = useState(false)
  const [schedMsg, setSchedMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!partyId) return
    setLoading(true)
    setError(null)
    try {
      const detail = await api.getParty(partyId)
      const p: Party = (detail?.party ?? detail) as Party
      setParty(p)

      // Prefer nested data from the detail endpoint, fall back to dedicated calls.
      let al = asArray<Alias>(detail?.aliases)
      if (al.length === 0) {
        try {
          al = asArray<Alias>(await api.listAliases(partyId))
        } catch {
          al = []
        }
      }
      setAliases(al)

      const sc = asArray<Screening>(detail?.screenings ?? detail?.screening_history)
      setScreenings(sc)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load party')
    } finally {
      setLoading(false)
    }
  }, [partyId])

  useEffect(() => {
    load()
  }, [load])

  const openEdit = () => {
    if (!party) return
    setForm({
      name: party.name ?? '',
      party_type: party.party_type ?? '',
      country: party.country ?? '',
      address: party.address ?? '',
      status: party.status ?? 'unscreened',
      tags: asArray<string>(party.tags).join(', '),
      notes: party.notes ?? '',
    })
    setEditErr(null)
    setEditOpen(true)
  }

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!party) return
    setSaving(true)
    setEditErr(null)
    try {
      const body = {
        name: form.name.trim(),
        party_type: form.party_type || null,
        country: form.country.trim() || null,
        address: form.address.trim() || null,
        status: form.status || null,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: form.notes.trim() || null,
      }
      await api.updateParty(party.id, body)
      setEditOpen(false)
      await load()
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const submitAlias = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!party || !newAlias.trim()) return
    setAddingAlias(true)
    setAliasErr(null)
    try {
      await api.addAlias({ party_id: party.id, alias: newAlias.trim() })
      setNewAlias('')
      try {
        setAliases(asArray<Alias>(await api.listAliases(party.id)))
      } catch {
        await load()
      }
    } catch (e) {
      setAliasErr(e instanceof Error ? e.message : 'Failed to add alias')
    } finally {
      setAddingAlias(false)
    }
  }

  const removeAlias = async (id: string) => {
    if (!confirm('Delete this alias?')) return
    try {
      await api.deleteAlias(id)
      setAliases((prev) => prev.filter((a) => a.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete alias')
    }
  }

  const runScreen = async () => {
    if (!party) return
    setRunning(true)
    setRunMsg(null)
    try {
      const res = await api.runScreening({ party_id: party.id, workspace_id: party.workspace_id })
      const mc = res?.screening?.match_count ?? res?.match_count ?? asArray(res?.matches).length
      setRunMsg(`Screening complete — ${mc ?? 0} match${mc === 1 ? '' : 'es'} found.`)
      await load()
    } catch (e) {
      setRunMsg(e instanceof Error ? e.message : 'Failed to run screening')
    } finally {
      setRunning(false)
    }
  }

  const submitSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!party) return
    setSavingSched(true)
    setSchedMsg(null)
    try {
      await api.saveRescreenSchedule({
        workspace_id: party.workspace_id,
        party_id: party.id,
        cadence: sched.cadence,
        on_change: sched.on_change,
        on_new_version: sched.on_new_version,
      })
      setSchedMsg('Re-screen schedule saved.')
      setSchedOpen(false)
    } catch (e) {
      setSchedMsg(e instanceof Error ? e.message : 'Failed to save schedule')
    } finally {
      setSavingSched(false)
    }
  }

  const deleteParty = async () => {
    if (!party) return
    if (!confirm(`Delete party "${party.name}"? This cannot be undone.`)) return
    try {
      await api.deleteParty(party.id)
      router.push('/dashboard/parties')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete party')
    }
  }

  const flaggedScreenings = useMemo(
    () => screenings.filter((s) => (s.match_count ?? 0) > 0).length,
    [screenings],
  )

  if (loading) return <FullPageSpinner label="Loading party..." />

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/parties" className="text-sm text-lime-400 hover:underline">
          ← Back to parties
        </Link>
        <EmptyState
          title="Could not load party"
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

  if (!party) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/parties" className="text-sm text-lime-400 hover:underline">
          ← Back to parties
        </Link>
        <EmptyState title="Party not found" description="This party may have been deleted." />
      </div>
    )
  }

  const tags = asArray<string>(party.tags)
  const identifiers = (party.identifiers ?? {}) as Record<string, unknown>
  const idEntries = Object.entries(identifiers)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/parties" className="text-sm text-lime-400 hover:underline">
          ← Back to parties
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-100">{party.name}</h1>
            <Badge tone={statusTone(party.status ?? undefined)}>{party.status ?? 'unscreened'}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {[party.party_type, party.country].filter(Boolean).join(' · ') || 'Screened party'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runScreen} disabled={running}>
            {running ? <Spinner label="Screening..." /> : 'Run screening'}
          </Button>
          <Button variant="secondary" onClick={openEdit}>
            Edit
          </Button>
          <Button variant="secondary" onClick={() => setSchedOpen(true)}>
            Re-screen schedule
          </Button>
          <Button variant="danger" onClick={deleteParty}>
            Delete
          </Button>
        </div>
      </div>

      {runMsg && (
        <div className="rounded-lg border border-lime-500/30 bg-lime-500/10 px-4 py-3 text-sm text-lime-300">
          {runMsg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Status" value={party.status ?? 'unscreened'} tone={
          party.status === 'blocked' ? 'red' : party.status === 'clear' ? 'green' : party.status === 'flagged' || party.status === 'needs_rescreen' ? 'amber' : 'default'
        } />
        <Stat label="Aliases" value={aliases.length} />
        <Stat label="Screenings" value={screenings.length} />
        <Stat label="Flagged runs" value={flaggedScreenings} tone={flaggedScreenings > 0 ? 'amber' : 'default'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Profile */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Profile</h2>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Detail label="Type" value={party.party_type ?? '—'} />
            <Detail label="Country" value={party.country ?? '—'} />
            <Detail label="Address" value={party.address ?? '—'} />
            <Detail label="Last screened" value={fmtDate(party.last_screened_at)} />
            <Detail label="Created" value={fmtDate(party.created_at)} />
            <Detail label="Updated" value={fmtDate(party.updated_at)} />
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tags</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.length ? (
                  tags.map((t) => (
                    <Badge key={t} tone="zinc">
                      {t}
                    </Badge>
                  ))
                ) : (
                  <span className="text-zinc-600">No tags</span>
                )}
              </div>
            </div>
            {idEntries.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Identifiers</div>
                <dl className="mt-1 space-y-1">
                  {idEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-zinc-500">{k}</dt>
                      <dd className="text-right text-zinc-300">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {party.notes && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Notes</div>
                <p className="mt-1 whitespace-pre-wrap text-zinc-300">{party.notes}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Aliases */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Aliases &amp; AKAs</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <form onSubmit={submitAlias} className="flex flex-col gap-2 sm:flex-row">
              <input
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                placeholder="Add alias or alternate spelling..."
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
              />
              <Button type="submit" disabled={addingAlias || !newAlias.trim()}>
                {addingAlias ? 'Adding...' : 'Add alias'}
              </Button>
            </form>
            {aliasErr && <p className="text-sm text-red-400">{aliasErr}</p>}
            {aliases.length === 0 ? (
              <p className="text-sm text-zinc-600">No aliases recorded. Add known AKAs to widen screening coverage.</p>
            ) : (
              <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
                {aliases.map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-zinc-200">{a.alias}</span>
                    <button
                      onClick={() => removeAlias(a.id)}
                      className="text-xs text-zinc-500 hover:text-red-400"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Screening history */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Screening history</h2>
          <Link href="/dashboard/screenings" className="text-xs text-lime-400 hover:underline">
            All screenings →
          </Link>
        </CardHeader>
        <CardBody>
          {screenings.length === 0 ? (
            <EmptyState
              title="No screenings yet"
              description="Run a screening to compare this party against your active sanctions lists."
              action={
                <Button onClick={runScreen} disabled={running}>
                  {running ? 'Screening...' : 'Run first screening'}
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Trigger</TH>
                  <TH>Matches</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {screenings.map((s) => (
                  <TR key={s.id}>
                    <TD>{fmtDate(s.created_at)}</TD>
                    <TD>{s.trigger ?? 'manual'}</TD>
                    <TD>
                      <span className={(s.match_count ?? 0) > 0 ? 'font-medium text-lime-400' : 'text-zinc-400'}>
                        {s.match_count ?? 0}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(s.status ?? undefined)}>{s.status ?? 'done'}</Badge>
                    </TD>
                    <TD className="text-right">
                      <Link href={`/dashboard/screenings/${s.id}`} className="text-xs text-lime-400 hover:underline">
                        View
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit party"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="edit-party-form" disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form id="edit-party-form" onSubmit={submitEdit} className="space-y-3">
          {editErr && <p className="text-sm text-red-400">{editErr}</p>}
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={form.party_type}
                onChange={(e) => setForm({ ...form, party_type: e.target.value })}
                className={inputCls}
              >
                <option value="">—</option>
                {PARTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={inputCls}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Country">
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Address">
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Tags (comma separated)">
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Notes">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={inputCls}
            />
          </Field>
        </form>
      </Modal>

      {/* Re-screen schedule modal */}
      <Modal
        open={schedOpen}
        onClose={() => setSchedOpen(false)}
        title="Re-screen schedule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSchedOpen(false)} disabled={savingSched}>
              Cancel
            </Button>
            <Button type="submit" form="sched-form" disabled={savingSched}>
              {savingSched ? 'Saving...' : 'Save schedule'}
            </Button>
          </>
        }
      >
        <form id="sched-form" onSubmit={submitSchedule} className="space-y-3">
          {schedMsg && <p className="text-sm text-lime-300">{schedMsg}</p>}
          <Field label="Cadence">
            <select
              value={sched.cadence}
              onChange={(e) => setSched({ ...sched, cadence: e.target.value })}
              className={inputCls}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={sched.on_change}
              onChange={(e) => setSched({ ...sched, on_change: e.target.checked })}
              className="accent-lime-500"
            />
            Re-screen automatically when this party changes
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={sched.on_new_version}
              onChange={(e) => setSched({ ...sched, on_new_version: e.target.checked })}
              className="accent-lime-500"
            />
            Re-screen when a new list version is activated
          </label>
        </form>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-lime-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-200">{value}</span>
    </div>
  )
}
