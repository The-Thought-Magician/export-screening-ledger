'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface List {
  id: string
  workspace_id: string
  name: string
  source_authority?: string | null
  list_type?: string | null
  is_active?: boolean | null
  active_version_id?: string | null
  version_count?: number | null
  entry_count?: number | null
  created_at?: string | null
}

const LIST_TYPES = ['sanctions', 'denied_persons', 'entity_list', 'pep', 'watchlist', 'internal']
const AUTHORITIES = ['OFAC', 'BIS', 'EU', 'UN', 'HMT', 'Internal']

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export default function ListsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [lists, setLists] = useState<List[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', source_authority: '', list_type: 'sanctions' })
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const wss = asArray<Workspace>(await api.listWorkspaces())
      if (wss.length === 0) {
        setWorkspaceId(null)
        setLists([])
        return
      }
      const wsId = wss[0].id
      setWorkspaceId(wsId)
      setLists(asArray<List>(await api.listLists(wsId)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lists')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lists.filter((l) => {
      if (typeFilter && (l.list_type ?? '') !== typeFilter) return false
      if (!q) return true
      return (
        l.name.toLowerCase().includes(q) ||
        (l.source_authority ?? '').toLowerCase().includes(q)
      )
    })
  }, [lists, search, typeFilter])

  const stats = useMemo(() => {
    const active = lists.filter((l) => l.is_active).length
    const entries = lists.reduce((sum, l) => sum + (l.entry_count ?? 0), 0)
    return { total: lists.length, active, entries }
  }, [lists])

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) {
      setCreateErr('No workspace available. Create a workspace first.')
      return
    }
    setCreating(true)
    setCreateErr(null)
    try {
      await api.createList({
        workspace_id: workspaceId,
        name: form.name.trim(),
        source_authority: form.source_authority.trim() || null,
        list_type: form.list_type,
      })
      setCreateOpen(false)
      setForm({ name: '', source_authority: '', list_type: 'sanctions' })
      await load()
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Failed to create list')
    } finally {
      setCreating(false)
    }
  }

  const removeList = async (l: List) => {
    if (!confirm(`Delete list "${l.name}" and all its versions? This cannot be undone.`)) return
    try {
      await api.deleteList(l.id)
      setLists((prev) => prev.filter((x) => x.id !== l.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete list')
    }
  }

  if (loading) return <FullPageSpinner label="Loading lists..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Screening lists</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Sanctions, denied-persons and watchlists used to screen your parties.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
          + New list
        </Button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <Button variant="secondary" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Lists" value={stats.total} />
        <Stat label="Active" value={stats.active} tone={stats.active > 0 ? 'green' : 'default'} />
        <Stat label="Total entries" value={stats.entries.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">All lists</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lists..."
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="">All types</option>
              {LIST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {lists.length === 0 ? (
            <EmptyState
              title={workspaceId ? 'No lists yet' : 'No workspace'}
              description={
                workspaceId
                  ? 'Create a list, then publish versions of its entries to screen parties against.'
                  : 'Create a workspace from Settings before adding screening lists.'
              }
              action={
                workspaceId ? (
                  <Button onClick={() => setCreateOpen(true)}>Create your first list</Button>
                ) : (
                  <Link href="/dashboard/settings">
                    <Button variant="secondary">Go to settings</Button>
                  </Link>
                )
              }
            />
          ) : filtered.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-zinc-600">No lists match your filters.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Authority</TH>
                  <TH>Type</TH>
                  <TH>Entries</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {filtered.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <Link href={`/dashboard/lists/${l.id}`} className="font-medium text-zinc-100 hover:text-amber-400">
                        {l.name}
                      </Link>
                    </TD>
                    <TD>{l.source_authority ?? '—'}</TD>
                    <TD>{l.list_type ?? '—'}</TD>
                    <TD className="tabular-nums">{(l.entry_count ?? 0).toLocaleString()}</TD>
                    <TD>
                      <Badge tone={l.is_active ? statusTone('active') : 'zinc'}>
                        {l.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </TD>
                    <TD>{fmtDate(l.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-3">
                        <Link href={`/dashboard/lists/${l.id}`} className="text-xs text-amber-400 hover:underline">
                          Open
                        </Link>
                        <button onClick={() => removeList(l)} className="text-xs text-zinc-500 hover:text-red-400">
                          Delete
                        </button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New screening list"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-list-form" disabled={creating}>
              {creating ? 'Creating...' : 'Create list'}
            </Button>
          </>
        }
      >
        <form id="create-list-form" onSubmit={submitCreate} className="space-y-3">
          {createErr && <p className="text-sm text-red-400">{createErr}</p>}
          <Field label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. OFAC SDN List"
              className={inputCls}
            />
          </Field>
          <Field label="Source authority">
            <input
              list="authorities"
              value={form.source_authority}
              onChange={(e) => setForm({ ...form, source_authority: e.target.value })}
              placeholder="OFAC, BIS, EU..."
              className={inputCls}
            />
            <datalist id="authorities">
              {AUTHORITIES.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
          <Field label="List type">
            <select
              value={form.list_type}
              onChange={(e) => setForm({ ...form, list_type: e.target.value })}
              className={inputCls}
            >
              {LIST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
