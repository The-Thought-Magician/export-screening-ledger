'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface List {
  id: string
  workspace_id: string
  name: string
  source_authority?: string | null
  list_type?: string | null
  is_active?: boolean | null
  active_version_id?: string | null
  created_at?: string | null
}

interface ListVersion {
  id: string
  list_id: string
  version_label: string
  content_hash?: string | null
  entry_count?: number | null
  published_at?: string | null
  created_at?: string | null
}

interface EntryRow {
  name: string
  country?: string
  entity_type?: string
  aliases?: string[]
  program_codes?: string[]
  remarks?: string
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString()
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

// Parse a CSV-ish textarea into entry rows.
// Format per line: name, country, entity_type, program_codes(;-separated), aliases(;-separated), remarks
function parseEntries(text: string): EntryRow[] {
  const out: EntryRow[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const cols = line.split(',').map((c) => c.trim())
    if (!cols[0]) continue
    out.push({
      name: cols[0],
      country: cols[1] || undefined,
      entity_type: cols[2] || undefined,
      program_codes: cols[3] ? cols[3].split(';').map((s) => s.trim()).filter(Boolean) : [],
      aliases: cols[4] ? cols[4].split(';').map((s) => s.trim()).filter(Boolean) : [],
      remarks: cols[5] || undefined,
    })
  }
  return out
}

export default function ListDetailPage() {
  const params = useParams<{ id: string }>()
  const listId = params?.id as string

  const [list, setList] = useState<List | null>(null)
  const [versions, setVersions] = useState<ListVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit list
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', source_authority: '', is_active: true })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)

  // Create version
  const [verOpen, setVerOpen] = useState(false)
  const [verForm, setVerForm] = useState({ version_label: '', entriesText: '' })
  const [creatingVer, setCreatingVer] = useState(false)
  const [verErr, setVerErr] = useState<string | null>(null)

  const [activating, setActivating] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!listId) return
    setLoading(true)
    setError(null)
    try {
      const detail = await api.getList(listId)
      const l: List = (detail?.list ?? detail) as List
      setList(l)

      let vers = asArray<ListVersion>(detail?.versions)
      if (vers.length === 0) {
        try {
          vers = asArray<ListVersion>(await api.listListVersions(listId))
        } catch {
          vers = []
        }
      }
      // Newest first
      vers.sort((a, b) => (new Date(b.created_at ?? 0).getTime()) - (new Date(a.created_at ?? 0).getTime()))
      setVersions(vers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load list')
    } finally {
      setLoading(false)
    }
  }, [listId])

  useEffect(() => {
    load()
  }, [load])

  const openEdit = () => {
    if (!list) return
    setEditForm({
      name: list.name ?? '',
      source_authority: list.source_authority ?? '',
      is_active: list.is_active ?? true,
    })
    setEditErr(null)
    setEditOpen(true)
  }

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!list) return
    setSavingEdit(true)
    setEditErr(null)
    try {
      await api.updateList(list.id, {
        name: editForm.name.trim(),
        source_authority: editForm.source_authority.trim() || null,
        is_active: editForm.is_active,
      })
      setEditOpen(false)
      await load()
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingEdit(false)
    }
  }

  const submitVersion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!list) return
    const entries = parseEntries(verForm.entriesText)
    if (entries.length === 0) {
      setVerErr('Add at least one entry (one per line: name, country, type, programs, aliases, remarks).')
      return
    }
    setCreatingVer(true)
    setVerErr(null)
    try {
      await api.createListVersion({
        list_id: list.id,
        version_label: verForm.version_label.trim(),
        entries,
      })
      setVerOpen(false)
      setVerForm({ version_label: '', entriesText: '' })
      await load()
    } catch (e) {
      setVerErr(e instanceof Error ? e.message : 'Failed to create version')
    } finally {
      setCreatingVer(false)
    }
  }

  const activate = async (v: ListVersion) => {
    if (!confirm(`Activate version "${v.version_label}"? Affected parties will be flagged for re-screening.`)) return
    setActivating(v.id)
    try {
      await api.activateListVersion(v.id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to activate version')
    } finally {
      setActivating(null)
    }
  }

  const totalEntries = useMemo(
    () => versions.reduce((s, v) => s + (v.entry_count ?? 0), 0),
    [versions],
  )
  const activeVersion = useMemo(
    () => versions.find((v) => v.id === list?.active_version_id) ?? null,
    [versions, list],
  )

  if (loading) return <FullPageSpinner label="Loading list..." />

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/lists" className="text-sm text-lime-400 hover:underline">
          ← Back to lists
        </Link>
        <EmptyState
          title="Could not load list"
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

  if (!list) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/lists" className="text-sm text-lime-400 hover:underline">
          ← Back to lists
        </Link>
        <EmptyState title="List not found" description="This list may have been deleted." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/lists" className="text-sm text-lime-400 hover:underline">
          ← Back to lists
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-zinc-100">{list.name}</h1>
            <Badge tone={list.is_active ? statusTone('active') : 'zinc'}>
              {list.is_active ? 'active' : 'inactive'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {[list.source_authority, list.list_type].filter(Boolean).join(' · ') || 'Screening list'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setVerOpen(true)}>+ New version</Button>
          <Button variant="secondary" onClick={openEdit}>
            Edit list
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Versions" value={versions.length} />
        <Stat
          label="Active version"
          value={activeVersion ? activeVersion.version_label : '—'}
          tone={activeVersion ? 'green' : 'default'}
        />
        <Stat label="Active entries" value={(activeVersion?.entry_count ?? 0).toLocaleString()} />
        <Stat label="Total entries" value={totalEntries.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Versions</h2>
        </CardHeader>
        <CardBody>
          {versions.length === 0 ? (
            <EmptyState
              title="No versions yet"
              description="Publish a version with entries to make this list screenable, then activate it."
              action={<Button onClick={() => setVerOpen(true)}>Create first version</Button>}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Version</TH>
                  <TH>Entries</TH>
                  <TH>Content hash</TH>
                  <TH>Published</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {versions.map((v) => {
                  const isActive = v.id === list.active_version_id
                  return (
                    <TR key={v.id}>
                      <TD>
                        <Link
                          href={`/dashboard/list-versions/${v.id}`}
                          className="font-medium text-zinc-100 hover:text-lime-400"
                        >
                          {v.version_label}
                        </Link>
                      </TD>
                      <TD className="tabular-nums">{(v.entry_count ?? 0).toLocaleString()}</TD>
                      <TD>
                        <code className="text-xs text-zinc-500">
                          {v.content_hash ? `${v.content_hash.slice(0, 12)}…` : '—'}
                        </code>
                      </TD>
                      <TD>{fmtDate(v.published_at ?? v.created_at)}</TD>
                      <TD>
                        {isActive ? (
                          <Badge tone="green">active</Badge>
                        ) : (
                          <Badge tone="zinc">archived</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-3">
                          <Link
                            href={`/dashboard/list-versions/${v.id}`}
                            className="text-xs text-lime-400 hover:underline"
                          >
                            Entries
                          </Link>
                          {!isActive && (
                            <button
                              onClick={() => activate(v)}
                              disabled={activating === v.id}
                              className="text-xs text-lime-400 hover:underline disabled:opacity-50"
                            >
                              {activating === v.id ? 'Activating...' : 'Activate'}
                            </button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit list modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit list"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button type="submit" form="edit-list-form" disabled={savingEdit}>
              {savingEdit ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form id="edit-list-form" onSubmit={submitEdit} className="space-y-3">
          {editErr && <p className="text-sm text-red-400">{editErr}</p>}
          <Field label="Name">
            <input
              required
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Source authority">
            <input
              value={editForm.source_authority}
              onChange={(e) => setEditForm({ ...editForm, source_authority: e.target.value })}
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={editForm.is_active}
              onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
              className="accent-lime-500"
            />
            List is active (included in screenings)
          </label>
        </form>
      </Modal>

      {/* Create version modal */}
      <Modal
        open={verOpen}
        onClose={() => setVerOpen(false)}
        title="New list version"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVerOpen(false)} disabled={creatingVer}>
              Cancel
            </Button>
            <Button type="submit" form="create-version-form" disabled={creatingVer}>
              {creatingVer ? <Spinner label="Publishing..." /> : 'Publish version'}
            </Button>
          </>
        }
      >
        <form id="create-version-form" onSubmit={submitVersion} className="space-y-3">
          {verErr && <p className="text-sm text-red-400">{verErr}</p>}
          <Field label="Version label">
            <input
              required
              value={verForm.version_label}
              onChange={(e) => setVerForm({ ...verForm, version_label: e.target.value })}
              placeholder="e.g. 2026-06-30 or v3"
              className={inputCls}
            />
          </Field>
          <Field label="Entries (one per line)">
            <textarea
              rows={8}
              value={verForm.entriesText}
              onChange={(e) => setVerForm({ ...verForm, entriesText: e.target.value })}
              placeholder={'name, country, entity_type, programs(;), aliases(;), remarks\nIvan Petrov, RU, individual, UKRAINE-EO13662, Ivan Petroff;I. Petrov, Designated 2022'}
              className={`${inputCls} font-mono text-xs`}
            />
          </Field>
          <p className="text-xs text-zinc-500">
            Columns: name (required), country, entity type, program codes (semicolon-separated), aliases
            (semicolon-separated), remarks. A content hash and entry count are computed on publish.
          </p>
          <p className="text-xs text-zinc-500">
            {parseEntries(verForm.entriesText).length} entr
            {parseEntries(verForm.entriesText).length === 1 ? 'y' : 'ies'} parsed.
          </p>
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
