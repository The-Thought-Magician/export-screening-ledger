'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'

interface ListEntry {
  id: string
  name?: string
  aliases?: string[]
  entity_type?: string
  country?: string
  address?: string
  program_codes?: string[]
  remarks?: string
  source_ref?: string
}

interface MatchDetail {
  id: string
  workspace_id?: string
  screening_id?: string
  party_id?: string
  party_name?: string
  list_entry_id?: string
  list_version_id?: string
  list_name?: string
  matched_name?: string
  score?: number
  score_breakdown?: Record<string, number> | null
  decision?: string
  decision_reason?: string | null
  reviewer_id?: string | null
  decided_at?: string | null
  created_at?: string
  list_entry?: ListEntry | null
}

const DECISIONS: { value: string; label: string; tone: 'green' | 'red' | 'amber' }[] = [
  { value: 'cleared', label: 'Clear (false positive)', tone: 'green' },
  { value: 'blocked', label: 'Block (true match)', tone: 'red' },
  { value: 'escalated', label: 'Escalate for review', tone: 'amber' },
]

function pct(s?: number): string {
  if (typeof s !== 'number') return '—'
  return `${Math.round(s * 100)}%`
}

export default function MatchDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()

  const [match, setMatch] = useState<MatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // adjudicate form
  const [decision, setDecision] = useState('cleared')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // allowlist
  const [allowOpen, setAllowOpen] = useState(false)
  const [allowReason, setAllowReason] = useState('')
  const [allowExpires, setAllowExpires] = useState('')
  const [allowSubmitting, setAllowSubmitting] = useState(false)
  const [allowError, setAllowError] = useState<string | null>(null)
  const [allowDone, setAllowDone] = useState(false)

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const m = (await api.getMatch(id)) as MatchDetail
      setMatch(m)
      if (m.decision && m.decision !== 'pending') setDecision(m.decision)
      if (m.decision_reason) setReason(m.decision_reason)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load match')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const breakdown = useMemo(() => {
    const b = match?.score_breakdown
    if (!b || typeof b !== 'object') return []
    return Object.entries(b)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({ key: k, value: v as number }))
  }, [match])

  const entry = match?.list_entry ?? null
  const pending = (match?.decision ?? 'pending') === 'pending'

  async function adjudicate() {
    if (!id || !reason.trim()) {
      setActionError('A decision reason is required.')
      return
    }
    setSubmitting(true)
    setActionError(null)
    try {
      await api.adjudicateMatch(id, { decision, reason: reason.trim() })
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to record decision')
    } finally {
      setSubmitting(false)
    }
  }

  async function createAllowlist() {
    if (!match || !match.party_id) return
    if (!allowReason.trim()) {
      setAllowError('A reason is required.')
      return
    }
    setAllowSubmitting(true)
    setAllowError(null)
    try {
      await api.createAllowlistEntry({
        workspace_id: match.workspace_id,
        party_id: match.party_id,
        list_entry_id: match.list_entry_id ?? null,
        reason: allowReason.trim(),
        expires_at: allowExpires ? new Date(allowExpires).toISOString() : null,
      })
      setAllowDone(true)
      setAllowOpen(false)
      setAllowReason('')
      setAllowExpires('')
    } catch (e) {
      setAllowError(e instanceof Error ? e.message : 'Failed to add allowlist entry')
    } finally {
      setAllowSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label="Loading match..." />
      </div>
    )
  }

  if (error || !match) {
    return (
      <EmptyState
        title="Match not found"
        description={error ?? 'This match may have been removed.'}
        action={
          <Link href="/dashboard/matches">
            <Button>Back to matches</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-600">
          <Link href="/dashboard/matches" className="hover:text-amber-400">
            Matches
          </Link>
          <span>/</span>
          <span className="text-zinc-400">Detail</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-zinc-100">
            {match.party_name ?? 'Party'} <span className="text-zinc-600">vs</span>{' '}
            {match.matched_name ?? 'List entry'}
          </h1>
          <Badge tone={statusTone(match.decision ?? 'pending')}>{match.decision ?? 'pending'}</Badge>
        </div>
        <p className="text-sm text-zinc-500">
          {match.list_name ? `Hit against ${match.list_name}. ` : ''}Composite score{' '}
          <span className="font-semibold text-amber-400">{pct(match.score)}</span>.
        </p>
      </div>

      {allowDone && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          Allowlist entry created. This false positive will be suppressed on future screenings.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: score + entry */}
        <div className="space-y-6 lg:col-span-2">
          {/* Score breakdown */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-200">Score breakdown</h2>
              <span className="text-2xl font-semibold tabular-nums text-amber-400">{pct(match.score)}</span>
            </CardHeader>
            <CardBody>
              {breakdown.length === 0 ? (
                <p className="text-sm text-zinc-500">No component breakdown was recorded for this match.</p>
              ) : (
                <div className="space-y-3">
                  {breakdown.map((b) => {
                    const w = Math.max(0, Math.min(1, b.value))
                    return (
                      <div key={b.key}>
                        <div className="flex items-center justify-between text-sm">
                          <span className="capitalize text-zinc-300">{b.key.replace(/_/g, ' ')}</span>
                          <span className="font-medium tabular-nums text-zinc-400">{pct(b.value)}</span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400"
                            style={{ width: `${Math.round(w * 100)}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* List entry */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Matched list entry</h2>
            </CardHeader>
            <CardBody>
              {!entry ? (
                <p className="text-sm text-zinc-500">List entry details are not available.</p>
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Field label="Name" value={entry.name} />
                  <Field label="Entity type" value={entry.entity_type} />
                  <Field label="Country" value={entry.country} />
                  <Field label="Source ref" value={entry.source_ref} />
                  <Field
                    label="Aliases"
                    value={entry.aliases && entry.aliases.length ? entry.aliases.join(', ') : undefined}
                  />
                  <Field
                    label="Programs"
                    value={
                      entry.program_codes && entry.program_codes.length
                        ? entry.program_codes.join(', ')
                        : undefined
                    }
                  />
                  <div className="sm:col-span-2">
                    <Field label="Address" value={entry.address} />
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Remarks" value={entry.remarks} />
                  </div>
                </dl>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right: adjudicate + meta */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">
                {pending ? 'Adjudicate' : 'Revise decision'}
              </h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="space-y-2">
                {DECISIONS.map((d) => (
                  <label
                    key={d.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                      decision === d.value
                        ? 'border-amber-500/60 bg-amber-500/5'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="decision"
                      value={d.value}
                      checked={decision === d.value}
                      onChange={() => setDecision(d.value)}
                      className="accent-amber-500"
                    />
                    <span className="text-sm text-zinc-200">{d.label}</span>
                  </label>
                ))}
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Document the rationale for the audit ledger..."
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
                />
              </div>

              {actionError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {actionError}
                </div>
              )}

              <Button onClick={adjudicate} disabled={submitting} className="w-full">
                {submitting ? <Spinner label="Saving..." /> : 'Record decision'}
              </Button>

              <button
                type="button"
                onClick={() => {
                  setAllowDone(false)
                  setAllowReason(reason || 'Confirmed false positive')
                  setAllowOpen(true)
                }}
                className="w-full text-center text-sm text-zinc-400 hover:text-amber-400"
              >
                Add to allowlist (suppress future hits)
              </button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Details</h2>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Meta label="Party">
                {match.party_id ? (
                  <Link href={`/dashboard/parties/${match.party_id}`} className="text-amber-400 hover:underline">
                    {match.party_name ?? match.party_id}
                  </Link>
                ) : (
                  '—'
                )}
              </Meta>
              <Meta label="Screening">
                {match.screening_id ? (
                  <Link
                    href={`/dashboard/screenings/${match.screening_id}`}
                    className="text-amber-400 hover:underline"
                  >
                    View run
                  </Link>
                ) : (
                  '—'
                )}
              </Meta>
              <Meta label="Reviewer">{match.reviewer_id ?? 'Not yet reviewed'}</Meta>
              <Meta label="Decided">
                {match.decided_at ? new Date(match.decided_at).toLocaleString() : '—'}
              </Meta>
              <Meta label="Created">
                {match.created_at ? new Date(match.created_at).toLocaleString() : '—'}
              </Meta>
              {match.decision_reason && (
                <Meta label="Reason on record">
                  <span className="text-zinc-300">{match.decision_reason}</span>
                </Meta>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal
        open={allowOpen}
        onClose={() => setAllowOpen(false)}
        title="Add to allowlist"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAllowOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createAllowlist} disabled={allowSubmitting}>
              {allowSubmitting ? <Spinner label="Saving..." /> : 'Suppress match'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Suppress this party / list-entry pairing so it stops surfacing as a match on future screenings.
            This is recorded in the ledger.
          </p>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Reason</label>
            <textarea
              value={allowReason}
              onChange={(e) => setAllowReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Expires (optional)
            </label>
            <input
              type="date"
              value={allowExpires}
              onChange={(e) => setAllowExpires(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
          {allowError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {allowError}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-200">{value && value !== '' ? value : '—'}</dd>
    </div>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="text-right text-sm text-zinc-300">{children}</span>
    </div>
  )
}
