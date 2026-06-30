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

interface ReportRow {
  id: string
  workspace_id: string
  report_type: string
  name: string
  params?: Record<string, unknown> | null
  snapshot?: Record<string, unknown> | null
  created_by?: string | null
  created_at?: string
}

interface ReportSnapshot {
  type?: string
  generated_at?: string
  summary?: Record<string, number | string>
  rows?: Array<Record<string, unknown>>
  [k: string]: unknown
}

const REPORT_TYPES = [
  {
    value: 'open_matches',
    label: 'Open Matches',
    desc: 'Pending and escalated screening matches awaiting adjudication.',
  },
  {
    value: 'blocked_orders',
    label: 'Blocked Orders',
    desc: 'Orders held at the export gate, grouped by block reason.',
  },
  {
    value: 'rescreen_compliance',
    label: 'Re-screen Compliance',
    desc: 'Parties due or overdue for re-screening against current cadence.',
  },
  {
    value: 'reviewer_activity',
    label: 'Reviewer Activity',
    desc: 'Adjudication throughput and decisions by reviewer.',
  },
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

function typeLabel(t: string) {
  return REPORT_TYPES.find((r) => r.value === t)?.label ?? t
}

function prettyKey(k: string) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export default function ReportsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [saved, setSaved] = useState<ReportRow[]>([])

  // Generation
  const [activeType, setActiveType] = useState<string>('open_matches')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null)

  // Save modal
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // View saved snapshot
  const [viewing, setViewing] = useState<ReportRow | null>(null)

  const loadSaved = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const data = await api.listReports(wsId)
      setSaved(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
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
        await loadSaved(wsId)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadSaved])

  async function runReport(type: string) {
    if (!workspaceId) return
    setActiveType(type)
    setGenerating(true)
    setGenError(null)
    setSnapshot(null)
    try {
      const data = (await api.generateReport(workspaceId, type)) as ReportSnapshot
      setSnapshot(data ?? {})
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  function openSave() {
    setSaveName(`${typeLabel(activeType)} — ${new Date().toLocaleDateString()}`)
    setSaveError(null)
    setSaveOpen(true)
  }

  async function saveSnapshot() {
    if (!workspaceId || !snapshot) return
    if (!saveName.trim()) {
      setSaveError('A name is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await api.saveReport({
        workspace_id: workspaceId,
        report_type: activeType,
        name: saveName.trim(),
        params: {},
        snapshot,
      })
      setSaveOpen(false)
      await loadSaved(workspaceId)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save report')
    } finally {
      setSaving(false)
    }
  }

  // Derive a renderable summary + rows from an arbitrary snapshot shape.
  const view = useMemo(() => deriveView(snapshot), [snapshot])

  if (loading) return <FullPageSpinner label="Loading reports..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Reports</h1>
        <p className="text-sm text-zinc-500">
          Generate pre-built compliance reports on demand and save point-in-time snapshots to the record.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Report type picker */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {REPORT_TYPES.map((r) => (
          <button
            key={r.value}
            onClick={() => runReport(r.value)}
            disabled={generating}
            className={`rounded-xl border px-4 py-4 text-left transition-colors disabled:opacity-60 ${
              activeType === r.value
                ? 'border-amber-500/60 bg-amber-500/10'
                : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-100">{r.label}</span>
              {activeType === r.value && generating && <Spinner />}
            </div>
            <p className="mt-1 text-xs text-zinc-500">{r.desc}</p>
          </button>
        ))}
      </div>

      {/* Generated report */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">{typeLabel(activeType)}</h2>
            {view?.generatedAt && <p className="text-xs text-zinc-500">Generated {fmtDate(view.generatedAt)}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => runReport(activeType)} disabled={generating}>
              {generating ? <Spinner /> : 'Regenerate'}
            </Button>
            <Button onClick={openSave} disabled={!snapshot || generating}>
              Save Snapshot
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {genError && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {genError}
            </div>
          )}
          {generating && !snapshot ? (
            <div className="py-10 text-center">
              <Spinner label="Generating report..." />
            </div>
          ) : !snapshot ? (
            <EmptyState
              title="No report generated yet"
              description="Pick a report type above to generate a live snapshot."
              action={<Button onClick={() => runReport(activeType)}>Generate {typeLabel(activeType)}</Button>}
            />
          ) : (
            <SnapshotView view={view} />
          )}
        </CardBody>
      </Card>

      {/* Saved reports */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Saved Snapshots ({saved.length})</h2>
        </CardHeader>
        <CardBody className="p-0">
          {saved.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No saved snapshots"
                description="Generate a report and save it to preserve a point-in-time record for auditors."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Saved By</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {saved.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium text-zinc-100">{r.name}</TD>
                    <TD>
                      <Badge tone="neutral">{typeLabel(r.report_type)}</Badge>
                    </TD>
                    <TD className="text-zinc-500">{r.created_by || '—'}</TD>
                    <TD className="text-zinc-500">{fmtDate(r.created_at)}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => setViewing(r)}>
                        View
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Save modal */}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save Report Snapshot"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveSnapshot} disabled={saving}>
              {saving ? <Spinner /> : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {saveError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {saveError}
            </div>
          )}
          <div>
            <label className={labelCls}>Report Type</label>
            <Badge tone="amber">{typeLabel(activeType)}</Badge>
          </div>
          <div>
            <label className={labelCls}>Snapshot Name</label>
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Q2 open matches review"
              className={inputCls}
            />
          </div>
          <p className="text-xs text-zinc-500">
            Saves the current generated data as an immutable snapshot tied to this workspace.
          </p>
        </div>
      </Modal>

      {/* View saved snapshot */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name} footer={<Button onClick={() => setViewing(null)}>Close</Button>}>
        {viewing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Badge tone="neutral">{typeLabel(viewing.report_type)}</Badge>
              <span>{fmtDate(viewing.created_at)}</span>
            </div>
            <SnapshotView view={deriveView((viewing.snapshot as ReportSnapshot) ?? null)} />
          </div>
        )}
      </Modal>
    </div>
  )
}

interface DerivedView {
  generatedAt?: string
  summary: Array<[string, string]>
  columns: string[]
  rows: Array<Record<string, unknown>>
  raw: ReportSnapshot | null
}

function deriveView(snapshot: ReportSnapshot | null): DerivedView | null {
  if (!snapshot) return null
  const summaryObj = isRecord(snapshot.summary) ? snapshot.summary : pickScalars(snapshot)
  const summary: Array<[string, string]> = Object.entries(summaryObj).map(([k, v]) => [
    prettyKey(k),
    typeof v === 'number' ? v.toLocaleString() : String(v),
  ])

  // find the first array of records to use as table rows
  let rows: Array<Record<string, unknown>> = []
  if (Array.isArray(snapshot.rows)) {
    rows = snapshot.rows.filter(isRecord)
  } else {
    for (const v of Object.values(snapshot)) {
      if (Array.isArray(v) && v.length > 0 && isRecord(v[0])) {
        rows = v.filter(isRecord)
        break
      }
    }
  }

  const columns = rows.length > 0 ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 8) : []

  return {
    generatedAt: typeof snapshot.generated_at === 'string' ? snapshot.generated_at : undefined,
    summary,
    columns,
    rows,
    raw: snapshot,
  }
}

function pickScalars(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'rows' || k === 'generated_at' || k === 'type') continue
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v
  }
  return out
}

function cellValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const STATUS_KEYS = new Set(['status', 'decision', 'gate_status', 'state'])

function SnapshotView({ view }: { view: DerivedView | null }) {
  if (!view) return null
  const maxBar = Math.max(1, ...view.summary.map(([, v]) => Number(v.replace(/,/g, '')) || 0))

  return (
    <div className="space-y-5">
      {view.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {view.summary.map(([k, v]) => (
            <Stat key={k} label={k} value={v} />
          ))}
        </div>
      )}

      {view.summary.length > 1 && (
        <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          {view.summary.map(([k, v]) => {
            const n = Number(v.replace(/,/g, '')) || 0
            return (
              <div key={k} className="flex items-center gap-3">
                <div className="w-40 shrink-0 truncate text-xs text-zinc-400">{k}</div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${(n / maxBar) * 100}%` }} />
                </div>
                <div className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-300">{v}</div>
              </div>
            )
          })}
        </div>
      )}

      {view.rows.length > 0 ? (
        <Table>
          <THead>
            <TR>
              {view.columns.map((c) => (
                <TH key={c}>{prettyKey(c)}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {view.rows.slice(0, 200).map((row, i) => (
              <TR key={i}>
                {view.columns.map((c) => (
                  <TD key={c}>
                    {STATUS_KEYS.has(c) && typeof row[c] === 'string' ? (
                      <Badge tone={statusTone(String(row[c]))}>{cellValue(row[c])}</Badge>
                    ) : (
                      <span className="text-zinc-300">{cellValue(row[c])}</span>
                    )}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : view.summary.length === 0 ? (
        <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
          {JSON.stringify(view.raw, null, 2)}
        </pre>
      ) : (
        <p className="text-sm text-zinc-500">No detail rows in this report.</p>
      )}
    </div>
  )
}
