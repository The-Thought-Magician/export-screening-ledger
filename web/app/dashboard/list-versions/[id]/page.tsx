'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ListVersion {
  id: string
  list_id: string
  version_label: string
  content_hash?: string | null
  entry_count?: number | null
  published_at?: string | null
  created_at?: string
}

interface ListEntry {
  id: string
  list_version_id: string
  name: string
  aliases?: string[] | null
  entity_type?: string | null
  country?: string | null
  address?: string | null
  program_codes?: string[] | null
  remarks?: string | null
  source_ref?: string | null
  created_at?: string
}

interface DiffEntryChange {
  before?: Partial<ListEntry>
  after?: Partial<ListEntry>
  name?: string
  fields?: string[]
}

interface DiffResult {
  added?: ListEntry[]
  removed?: ListEntry[]
  changed?: DiffEntryChange[]
}

function shortHash(h?: string | null): string {
  if (!h) return '—'
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return d
  return date.toLocaleString()
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function csvList(v?: string[] | null): string {
  if (!v || v.length === 0) return ''
  return v.join(', ')
}

export default function ListVersionDetailPage() {
  const params = useParams<{ id: string }>()
  const versionId = params?.id

  const [version, setVersion] = useState<ListVersion | null>(null)
  const [entries, setEntries] = useState<ListEntry[]>([])
  const [siblings, setSiblings] = useState<ListVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Add-entry modal
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    entity_type: '',
    country: '',
    address: '',
    aliases: '',
    program_codes: '',
    remarks: '',
    source_ref: '',
  })

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Diff state
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffOther, setDiffOther] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)

  const load = useCallback(async () => {
    if (!versionId) return
    setLoading(true)
    setError(null)
    try {
      const [ver, ents] = await Promise.all([
        api.getListVersion(versionId),
        api.listListEntries(versionId),
      ])
      const v = (ver ?? null) as ListVersion | null
      setVersion(v)
      setEntries(asArray<ListEntry>(ents))
      // load sibling versions of the same list for diff target selection
      if (v?.list_id) {
        try {
          const sibs = await api.listListVersions(v.list_id)
          setSiblings(asArray<ListVersion>(sibs).filter((s) => s.id !== versionId))
        } catch {
          setSiblings([])
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load list version')
    } finally {
      setLoading(false)
    }
  }, [versionId])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => {
      const hay = [
        e.name,
        e.country ?? '',
        e.entity_type ?? '',
        e.address ?? '',
        csvList(e.aliases),
        csvList(e.program_codes),
        e.remarks ?? '',
        e.source_ref ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [entries, search])

  const entityTypeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) {
      const k = (e.entity_type || 'unspecified').toLowerCase()
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [entries])

  const maxTypeCount = useMemo(
    () => entityTypeCounts.reduce((mx, [, n]) => Math.max(mx, n), 0),
    [entityTypeCounts],
  )

  const resetForm = () => {
    setForm({
      name: '',
      entity_type: '',
      country: '',
      address: '',
      aliases: '',
      program_codes: '',
      remarks: '',
      source_ref: '',
    })
    setFormError(null)
  }

  const submitEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!versionId) return
    if (!form.name.trim()) {
      setFormError('Name is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body = {
        list_version_id: versionId,
        name: form.name.trim(),
        entity_type: form.entity_type.trim() || null,
        country: form.country.trim() || null,
        address: form.address.trim() || null,
        aliases: form.aliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        program_codes: form.program_codes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        remarks: form.remarks.trim() || null,
        source_ref: form.source_ref.trim() || null,
      }
      await api.createListEntry(body)
      setAddOpen(false)
      resetForm()
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add entry')
    } finally {
      setSaving(false)
    }
  }

  const removeEntry = async (id: string) => {
    if (!window.confirm('Delete this list entry? This cannot be undone.')) return
    setDeletingId(id)
    try {
      await api.deleteListEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry')
    } finally {
      setDeletingId(null)
    }
  }

  const runDiff = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!versionId || !diffOther) {
      setDiffError('Select a version to compare against.')
      return
    }
    setDiffLoading(true)
    setDiffError(null)
    setDiff(null)
    try {
      const res = await api.diffListVersion(versionId, diffOther)
      setDiff((res ?? {}) as DiffResult)
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to compute diff')
    } finally {
      setDiffLoading(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading list version..." />

  if (error && !version) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/lists" className="text-sm text-lime-400 hover:text-lime-300">
          ← Back to lists
        </Link>
        <EmptyState
          title="Could not load version"
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Link href="/dashboard/lists" className="text-lime-400 hover:text-lime-300">
            Lists
          </Link>
          <span>/</span>
          {version?.list_id ? (
            <Link
              href={`/dashboard/lists/${version.list_id}`}
              className="text-lime-400 hover:text-lime-300"
            >
              List
            </Link>
          ) : (
            <span>List</span>
          )}
          <span>/</span>
          <span className="text-zinc-300">Version</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
              {version?.version_label || 'List Version'}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Content hash <span className="font-mono text-zinc-400">{shortHash(version?.content_hash)}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDiffOpen(true)
                setDiff(null)
                setDiffError(null)
                if (!diffOther && siblings[0]) setDiffOther(siblings[0].id)
              }}
              disabled={siblings.length === 0}
              title={siblings.length === 0 ? 'No other versions to compare' : undefined}
            >
              Diff vs version
            </Button>
            <Button
              onClick={() => {
                resetForm()
                setAddOpen(true)
              }}
            >
              Add entry
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Entries" value={entries.length} />
        <Stat
          label="Declared count"
          value={version?.entry_count ?? '—'}
          tone={
            version?.entry_count != null && version.entry_count !== entries.length ? 'amber' : 'default'
          }
          hint={
            version?.entry_count != null && version.entry_count !== entries.length
              ? 'Differs from loaded'
              : undefined
          }
        />
        <Stat label="Entity types" value={entityTypeCounts.length} />
        <Stat
          label="Published"
          value={version?.published_at ? <Badge tone="green">Yes</Badge> : <Badge tone="amber">Draft</Badge>}
          hint={version?.published_at ? fmtDate(version.published_at) : 'Not published'}
        />
      </div>

      {entityTypeCounts.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Entries by entity type</h2>
          </CardHeader>
          <CardBody className="space-y-2">
            {entityTypeCounts.map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-xs text-zinc-400">{type}</div>
                <div className="h-3 flex-1 overflow-hidden rounded bg-zinc-800">
                  <div
                    className="h-full rounded bg-lime-500"
                    style={{ width: `${maxTypeCount ? (count / maxTypeCount) * 100 : 0}%` }}
                  />
                </div>
                <div className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-400">{count}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Entries <span className="text-zinc-500">({filtered.length})</span>
          </h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entries..."
            className="w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500/60 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No entries yet"
                description="Add sanctioned or denied-party entries to this list version."
                action={
                  <Button
                    onClick={() => {
                      resetForm()
                      setAddOpen(true)
                    }}
                  >
                    Add entry
                  </Button>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No matching entries" description="Adjust your search to see entries." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Country</TH>
                  <TH>Aliases</TH>
                  <TH>Programs</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id}>
                    <TD className="text-zinc-100">
                      <div className="font-medium">{e.name}</div>
                      {e.address && <div className="text-xs text-zinc-500">{e.address}</div>}
                      {e.remarks && <div className="mt-0.5 text-xs text-zinc-600">{e.remarks}</div>}
                    </TD>
                    <TD>
                      {e.entity_type ? <Badge tone="zinc">{e.entity_type}</Badge> : <span className="text-zinc-600">—</span>}
                    </TD>
                    <TD>{e.country || <span className="text-zinc-600">—</span>}</TD>
                    <TD className="max-w-[12rem] truncate text-xs text-zinc-400">
                      {csvList(e.aliases) || <span className="text-zinc-600">—</span>}
                    </TD>
                    <TD className="text-xs">
                      {(e.program_codes && e.program_codes.length > 0) ? (
                        <div className="flex flex-wrap gap-1">
                          {e.program_codes.map((p, i) => (
                            <Badge key={`${e.id}-pc-${i}`} tone="amber">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </TD>
                    <TD className="text-xs text-zinc-500">{e.source_ref || '—'}</TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                        onClick={() => removeEntry(e.id)}
                        disabled={deletingId === e.id}
                      >
                        {deletingId === e.id ? 'Deleting...' : 'Delete'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Add entry modal */}
      <Modal
        open={addOpen}
        onClose={() => {
          if (!saving) setAddOpen(false)
        }}
        title="Add list entry"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="add-entry-form" disabled={saving}>
              {saving ? 'Saving...' : 'Add entry'}
            </Button>
          </>
        }
      >
        <form id="add-entry-form" onSubmit={submitEntry} className="space-y-3">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {formError}
            </div>
          )}
          <Field label="Name" required>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="esl-input"
              placeholder="Acme Trading Co."
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entity type">
              <input
                value={form.entity_type}
                onChange={(e) => setForm({ ...form, entity_type: e.target.value })}
                className="esl-input"
                placeholder="individual / entity / vessel"
              />
            </Field>
            <Field label="Country">
              <input
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                className="esl-input"
                placeholder="IR"
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="esl-input"
            />
          </Field>
          <Field label="Aliases (comma-separated)">
            <input
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              className="esl-input"
              placeholder="Acme Co, ACME LLC"
            />
          </Field>
          <Field label="Program codes (comma-separated)">
            <input
              value={form.program_codes}
              onChange={(e) => setForm({ ...form, program_codes: e.target.value })}
              className="esl-input"
              placeholder="SDN, IRAN"
            />
          </Field>
          <Field label="Remarks">
            <input
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              className="esl-input"
            />
          </Field>
          <Field label="Source reference">
            <input
              value={form.source_ref}
              onChange={(e) => setForm({ ...form, source_ref: e.target.value })}
              className="esl-input"
              placeholder="OFAC SDN 2024-06"
            />
          </Field>
        </form>
      </Modal>

      {/* Diff modal */}
      <Modal
        open={diffOpen}
        onClose={() => {
          if (!diffLoading) setDiffOpen(false)
        }}
        title="Diff against another version"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiffOpen(false)} disabled={diffLoading}>
              Close
            </Button>
            <Button type="submit" form="diff-form" disabled={diffLoading}>
              {diffLoading ? 'Comparing...' : 'Compare'}
            </Button>
          </>
        }
      >
        <form id="diff-form" onSubmit={runDiff} className="space-y-3">
          {diffError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {diffError}
            </div>
          )}
          <Field label="Compare this version against">
            <select
              value={diffOther}
              onChange={(e) => setDiffOther(e.target.value)}
              className="esl-input"
            >
              <option value="">Select a version…</option>
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.version_label}
                </option>
              ))}
            </select>
          </Field>
        </form>

        {diffLoading && (
          <div className="py-4">
            <Spinner label="Computing diff..." />
          </div>
        )}

        {diff && !diffLoading && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2">
                <div className="text-lg font-semibold text-emerald-400">{asArray(diff.added).length}</div>
                <div className="text-xs text-zinc-500">Added</div>
              </div>
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 py-2">
                <div className="text-lg font-semibold text-red-400">{asArray(diff.removed).length}</div>
                <div className="text-xs text-zinc-500">Removed</div>
              </div>
              <div className="rounded-lg border border-lime-500/30 bg-lime-500/10 py-2">
                <div className="text-lg font-semibold text-lime-400">{asArray(diff.changed).length}</div>
                <div className="text-xs text-zinc-500">Changed</div>
              </div>
            </div>

            <DiffSection title="Added" tone="green" items={asArray<ListEntry>(diff.added).map((x) => x.name)} />
            <DiffSection title="Removed" tone="red" items={asArray<ListEntry>(diff.removed).map((x) => x.name)} />
            <DiffSection
              title="Changed"
              tone="amber"
              items={asArray<DiffEntryChange>(diff.changed).map(
                (c) => c.name || c.after?.name || c.before?.name || 'entry',
              )}
            />
          </div>
        )}
      </Modal>

      <style jsx global>{`
        .esl-input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(63 63 70);
          background: rgb(9 9 11);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(228 228 231);
        }
        .esl-input:focus {
          outline: none;
          border-color: rgba(245, 158, 11, 0.6);
        }
        .esl-input::placeholder {
          color: rgb(82 82 91);
        }
      `}</style>
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">
        {label}
        {required && <span className="text-lime-400"> *</span>}
      </span>
      {children}
    </label>
  )
}

function DiffSection({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'green' | 'red' | 'amber'
  items: string[]
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-xs text-zinc-500">{items.length}</span>
      </div>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-300">
        {items.map((name, i) => (
          <li key={`${title}-${i}`} className="truncate">
            {name}
          </li>
        ))}
      </ul>
    </div>
  )
}
