'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'esl.workspace_id'

const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly', 'annual']

// Default scoring weights the engine understands. Used to seed the editor when
// the active policy does not specify a full set.
const DEFAULT_WEIGHTS: Record<string, number> = {
  name: 0.5,
  alias: 0.2,
  country: 0.15,
  address: 0.1,
  identifier: 0.05,
}

const WEIGHT_LABELS: Record<string, string> = {
  name: 'Name similarity',
  alias: 'Alias similarity',
  country: 'Country match',
  address: 'Address match',
  identifier: 'Identifier match',
}

interface Policy {
  id?: string
  workspace_id?: string
  version?: number
  match_threshold?: number
  auto_clear_floor?: number
  weights?: Record<string, number>
  four_eyes?: boolean
  default_cadence?: string
  is_active?: boolean
  created_by?: string
  created_at?: string
}

interface PolicyDetail {
  policy?: Policy | null
  active?: Policy | null
  history?: Policy[]
  versions?: Policy[]
  [k: string]: unknown
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

// Extract the active policy and version history from whatever shape the API returns.
function normalize(detail: PolicyDetail | Policy | null): { active: Policy | null; history: Policy[] } {
  if (!detail) return { active: null, history: [] }
  const d = detail as PolicyDetail
  const active = (d.active ?? d.policy ?? (d as Policy)) as Policy | null
  const history = (d.history ?? d.versions ?? []) as Policy[]
  const hasActiveShape = active && (typeof active.match_threshold === 'number' || typeof active.version === 'number')
  return { active: hasActiveShape ? active : null, history: Array.isArray(history) ? history : [] }
}

export default function PolicyPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [active, setActive] = useState<Policy | null>(null)
  const [history, setHistory] = useState<Policy[]>([])

  const [threshold, setThreshold] = useState(0.85)
  const [autoClearFloor, setAutoClearFloor] = useState(0.4)
  const [fourEyes, setFourEyes] = useState(true)
  const [cadence, setCadence] = useState('monthly')
  const [weights, setWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS)

  const hydrate = useCallback((p: Policy | null) => {
    setThreshold(typeof p?.match_threshold === 'number' ? p.match_threshold : 0.85)
    setAutoClearFloor(typeof p?.auto_clear_floor === 'number' ? p.auto_clear_floor : 0.4)
    setFourEyes(p?.four_eyes ?? true)
    setCadence(p?.default_cadence ?? 'monthly')
    const w = p?.weights && Object.keys(p.weights).length ? p.weights : DEFAULT_WEIGHTS
    setWeights({ ...DEFAULT_WEIGHTS, ...w })
  }, [])

  const load = useCallback(
    async (wsId: string) => {
      setError(null)
      try {
        const detail = await api.getPolicy(wsId)
        const { active: a, history: h } = normalize(detail)
        setActive(a)
        setHistory(h)
        hydrate(a)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load policy')
      }
    },
    [hydrate],
  )

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
        await load(wsId)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const weightTotal = useMemo(
    () => Object.values(weights).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
    [weights],
  )
  const weightsBalanced = Math.abs(weightTotal - 1) < 0.001

  const normalizeWeights = () => {
    if (weightTotal <= 0) return
    const next: Record<string, number> = {}
    for (const [k, v] of Object.entries(weights)) next[k] = Math.round((v / weightTotal) * 1000) / 1000
    setWeights(next)
  }

  const dirty = useMemo(() => {
    if (!active) return true
    if ((active.match_threshold ?? 0.85) !== threshold) return true
    if ((active.auto_clear_floor ?? 0.4) !== autoClearFloor) return true
    if ((active.four_eyes ?? true) !== fourEyes) return true
    if ((active.default_cadence ?? 'monthly') !== cadence) return true
    const aw = { ...DEFAULT_WEIGHTS, ...(active.weights ?? {}) }
    for (const k of Object.keys(weights)) if ((aw[k] ?? 0) !== weights[k]) return true
    return false
  }, [active, threshold, autoClearFloor, fourEyes, cadence, weights])

  const save = async () => {
    if (!workspaceId) return
    if (autoClearFloor >= threshold) {
      setError('Auto-clear floor must be below the match threshold.')
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.savePolicy({
        workspace_id: workspaceId,
        match_threshold: threshold,
        auto_clear_floor: autoClearFloor,
        weights,
        four_eyes: fourEyes,
        default_cadence: cadence,
      })
      await load(workspaceId)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save policy')
    } finally {
      setSaving(false)
    }
  }

  const resetToActive = () => hydrate(active)

  if (loading) return <FullPageSpinner label="Loading policy..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Screening policy</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Match thresholds, scoring weights, four-eyes review, and default re-screen cadence. Saving creates a new
            immutable policy version recorded in the ledger.
          </p>
        </div>
        {active && (
          <Badge tone="amber">v{active.version ?? 1} active</Badge>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {saved && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          Policy saved as a new version.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Match threshold" value={pct(threshold)} tone="amber" hint="Scores at or above flag a match" />
        <Stat label="Auto-clear floor" value={pct(autoClearFloor)} hint="Scores below auto-clear" />
        <Stat label="Four-eyes" value={fourEyes ? 'On' : 'Off'} tone={fourEyes ? 'green' : 'default'} />
        <Stat label="Default cadence" value={cadence} hint="Re-screen interval" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Match engine</h2>
          </CardHeader>
          <CardBody className="space-y-8">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">Match threshold</label>
                <span className="tabular-nums text-sm text-amber-400">{threshold.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Composite scores ≥ this value surface as candidate matches requiring review.
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">Auto-clear floor</label>
                <span className="tabular-nums text-sm text-zinc-300">{autoClearFloor.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={0.95}
                step={0.01}
                value={autoClearFloor}
                onChange={(e) => setAutoClearFloor(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Scores below this floor are discarded as noise and never enter the adjudication queue.
              </p>
              {autoClearFloor >= threshold && (
                <p className="mt-1 text-xs text-red-400">Floor must be below the match threshold.</p>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">Scoring weights</label>
                <span
                  className={`tabular-nums text-xs ${weightsBalanced ? 'text-emerald-400' : 'text-amber-400'}`}
                >
                  total {weightTotal.toFixed(2)}
                </span>
              </div>
              <div className="space-y-4">
                {Object.keys(DEFAULT_WEIGHTS).map((key) => {
                  const v = weights[key] ?? 0
                  const share = weightTotal > 0 ? Math.round((v / weightTotal) * 100) : 0
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-zinc-300">{WEIGHT_LABELS[key] ?? key}</span>
                        <span className="tabular-nums text-zinc-400">
                          {v.toFixed(2)} <span className="text-zinc-600">({share}%)</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={v}
                          onChange={(e) =>
                            setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))
                          }
                          className="w-full accent-amber-500"
                        />
                        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex items-center gap-3">
                {!weightsBalanced && (
                  <Button variant="secondary" onClick={normalizeWeights} className="text-xs">
                    Normalize to 1.0
                  </Button>
                )}
                <span className="text-xs text-zinc-500">
                  Weights are relative; the engine normalizes them when scoring.
                </span>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Review &amp; cadence</h2>
            </CardHeader>
            <CardBody className="space-y-5">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={fourEyes}
                  onChange={(e) => setFourEyes(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-500"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-200">Require four-eyes review</span>
                  <span className="block text-xs text-zinc-500">
                    Adjudications must be confirmed by a second reviewer before a block or clear is final.
                  </span>
                </span>
              </label>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">Default re-screen cadence</label>
                <select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
                >
                  {CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500">
                  Applied to parties without an explicit per-party schedule.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-3">
              <Button onClick={save} disabled={saving || !dirty} className="w-full">
                {saving ? <Spinner label="Saving..." /> : dirty ? 'Save new policy version' : 'No changes'}
              </Button>
              {dirty && (
                <Button variant="ghost" onClick={resetToActive} className="w-full" disabled={saving}>
                  Discard changes
                </Button>
              )}
              {active?.created_at && (
                <p className="text-center text-xs text-zinc-600">
                  Active version saved {fmtDate(active.created_at)}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Version history</h2>
        </CardHeader>
        <CardBody className="p-0">
          {history.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">
              No prior versions. The current policy is the first version.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Version</TH>
                  <TH>Threshold</TH>
                  <TH>Auto-clear</TH>
                  <TH>Four-eyes</TH>
                  <TH>Cadence</TH>
                  <TH>Saved</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((p) => (
                  <TR key={p.id ?? p.version}>
                    <TD>
                      <span className="font-medium text-zinc-200">v{p.version ?? '—'}</span>{' '}
                      {p.is_active && <Badge tone="amber">active</Badge>}
                    </TD>
                    <TD className="tabular-nums">
                      {typeof p.match_threshold === 'number' ? pct(p.match_threshold) : '—'}
                    </TD>
                    <TD className="tabular-nums">
                      {typeof p.auto_clear_floor === 'number' ? pct(p.auto_clear_floor) : '—'}
                    </TD>
                    <TD>{p.four_eyes ? 'On' : 'Off'}</TD>
                    <TD>{p.default_cadence ?? '—'}</TD>
                    <TD className="text-zinc-500">{fmtDate(p.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
