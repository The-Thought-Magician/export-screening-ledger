'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'esl.workspace_id'

const PARTY_STATUSES = ['unscreened', 'clear', 'flagged', 'blocked', 'needs_rescreen']

interface SegmentFilters {
  status?: string
  country?: string
  party_type?: string
  tag?: string
  q?: string
  [k: string]: unknown
}

interface Segment {
  id: string
  workspace_id: string
  name: string
  filters: SegmentFilters
  created_by?: string
  created_at?: string
}

interface Party {
  id: string
  name: string
  party_type?: string
  country?: string
  status?: string
  tags?: string[]
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function describeFilters(f: SegmentFilters): string {
  const parts: string[] = []
  if (f.status) parts.push(`status = ${f.status}`)
  if (f.country) parts.push(`country = ${f.country}`)
  if (f.party_type) parts.push(`type = ${f.party_type}`)
  if (f.tag) parts.push(`tag = ${f.tag}`)
  if (f.q) parts.push(`matches “${f.q}”`)
  return parts.length ? parts.join(' · ') : 'All parties'
}

// Apply a saved segment's filters to the in-memory party list so we can show a count
// without a dedicated backend endpoint. Mirrors the documented party filter fields.
function applyFilters(parties: Party[], f: SegmentFilters): Party[] {
  const q = (f.q ?? '').trim().toLowerCase()
  const tag = (f.tag ?? '').trim().toLowerCase()
  return parties.filter((p) => {
    if (f.status && (p.status ?? '') !== f.status) return false
    if (f.country && (p.country ?? '').toLowerCase() !== f.country.toLowerCase()) return false
    if (f.party_type && (p.party_type ?? '').toLowerCase() !== f.party_type.toLowerCase()) return false
    if (tag && !(p.tags ?? []).some((t) => String(t).toLowerCase() === tag)) return false
    if (q && !p.name.toLowerCase().includes(q)) return false
    return true
  })
}

const EMPTY_FORM = { name: '', status: '', country: '', party_type: '', tag: '', q: '' }

export default function SegmentsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [segments, setSegments] = useState<Segment[]>([])
  const [parties, setParties] = useState<Party[]>([])

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [previewId, setPreviewId] = useState<string | null>(null)

  const loadData = useCallback(async (wsId: string, soft = false) => {
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [segs, ps] = await Promise.all([api.listSegments(wsId), api.listParties(wsId)])
      setSegments(Array.isArray(segs) ? segs : [])
      setParties(Array.isArray(ps) ? ps : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load segments')
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
          setError('No workspace found. Seed or create a workspace first.')
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

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 3000)
  }

  // Distinct facet values from the loaded parties to power the builder selects.
  const facets = useMemo(() => {
    const countries = new Set<string>()
    const types = new Set<string>()
    const tags = new Set<string>()
    for (const p of parties) {
      if (p.country) countries.add(p.country)
      if (p.party_type) types.add(p.party_type)
      for (const t of p.tags ?? []) if (t) tags.add(String(t))
    }
    return {
      countries: [...countries].sort(),
      types: [...types].sort(),
      tags: [...tags].sort(),
    }
  }, [parties])

  const formFilters: SegmentFilters = useMemo(
    () => ({
      status: form.status || undefined,
      country: form.country || undefined,
      party_type: form.party_type || undefined,
      tag: form.tag || undefined,
      q: form.q.trim() || undefined,
    }),
    [form],
  )

  const previewCount = useMemo(() => applyFilters(parties, formFilters).length, [parties, formFilters])

  const segmentCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of segments) m[s.id] = applyFilters(parties, s.filters ?? {}).length
    return m
  }, [segments, parties])

  const previewParties = useMemo(() => {
    if (!previewId) return []
    const seg = segments.find((s) => s.id === previewId)
    if (!seg) return []
    return applyFilters(parties, seg.filters ?? {})
  }, [previewId, segments, parties])

  const openCreate = () => {
    setForm({ ...EMPTY_FORM })
    setFormError(null)
    setOpen(true)
  }

  const save = async () => {
    if (!workspaceId) return
    if (!form.name.trim()) {
      setFormError('Segment name is required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createSegment({ workspace_id: workspaceId, name: form.name.trim(), filters: formFilters })
      setOpen(false)
      await loadData(workspaceId, true)
      flash('Segment saved.')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save segment')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: Segment) => {
    if (!workspaceId) return
    if (typeof window !== 'undefined' && !window.confirm(`Delete segment “${s.name}”?`)) return
    setError(null)
    try {
      await api.deleteSegment(s.id)
      setSegments((list) => list.filter((x) => x.id !== s.id))
      if (previewId === s.id) setPreviewId(null)
      flash('Segment deleted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete segment')
    }
  }

  if (loading) return <FullPageSpinner label="Loading segments..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Party segments</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Save reusable party filters to target screening runs, re-screen sweeps, and exports at a defined cohort.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshing && <Spinner />}
          <Button onClick={openCreate}>New segment</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Segments" value={segments.length} />
        <Stat label="Parties in register" value={parties.length} />
        <Stat
          label="Largest segment"
          value={segments.length ? Math.max(0, ...Object.values(segmentCounts)) : 0}
          hint="Parties matched"
        />
      </div>

      {segments.length === 0 ? (
        <EmptyState
          icon={<span>🧮</span>}
          title="No saved segments"
          description="Build a filter over your party register — by status, country, type, or tag — and save it for repeated screening and reporting."
          action={<Button onClick={openCreate}>New segment</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Filter</TH>
              <TH className="text-right">Parties</TH>
              <TH>Created</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {segments.map((s) => (
              <TR key={s.id}>
                <TD className="font-medium text-zinc-100">{s.name}</TD>
                <TD>
                  <span className="text-xs text-zinc-400">{describeFilters(s.filters ?? {})}</span>
                </TD>
                <TD className="text-right tabular-nums text-zinc-300">{segmentCounts[s.id] ?? 0}</TD>
                <TD className="text-zinc-500">{fmtDate(s.created_at)}</TD>
                <TD>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setPreviewId(previewId === s.id ? null : s.id)}
                      className="px-3 py-1 text-xs"
                    >
                      {previewId === s.id ? 'Hide' : 'Preview'}
                    </Button>
                    <Button variant="danger" onClick={() => void remove(s)} className="px-3 py-1 text-xs">
                      Delete
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {previewId && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">
              Preview: {segments.find((s) => s.id === previewId)?.name}
            </h2>
            <span className="text-xs text-zinc-500">{previewParties.length} parties</span>
          </CardHeader>
          <CardBody className="p-0">
            {previewParties.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500">
                No parties currently match this segment&apos;s filters.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Party</TH>
                    <TH>Type</TH>
                    <TH>Country</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {previewParties.slice(0, 50).map((p) => (
                    <TR key={p.id}>
                      <TD className="text-zinc-200">{p.name}</TD>
                      <TD className="text-zinc-400">{p.party_type ?? '—'}</TD>
                      <TD className="text-zinc-400">{p.country ?? '—'}</TD>
                      <TD>
                        <Badge tone={statusTone(p.status)}>{(p.status ?? 'unscreened').replace(/_/g, ' ')}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {previewParties.length > 50 && (
              <p className="px-5 py-3 text-xs text-zinc-500">Showing first 50 of {previewParties.length}.</p>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New segment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner label="Saving..." /> : `Save (${previewCount} parties)`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. High-risk distributors"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              >
                <option value="">Any status</option>
                {PARTY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Country</label>
              <input
                list="segment-countries"
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                placeholder="Any country"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
              <datalist id="segment-countries">
                {facets.countries.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Party type</label>
              <input
                list="segment-types"
                value={form.party_type}
                onChange={(e) => setForm((f) => ({ ...f, party_type: e.target.value }))}
                placeholder="Any type"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
              <datalist id="segment-types">
                {facets.types.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">Tag</label>
              <input
                list="segment-tags"
                value={form.tag}
                onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                placeholder="Any tag"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
              <datalist id="segment-tags">
                {facets.tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Name contains</label>
            <input
              value={form.q}
              onChange={(e) => setForm((f) => ({ ...f, q: e.target.value }))}
              placeholder="Search term"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">Live preview</span>
              <span className="tabular-nums font-medium text-lime-400">{previewCount} parties</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{describeFilters(formFilters)}</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
