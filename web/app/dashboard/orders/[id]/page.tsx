'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface OrderParty {
  id?: string
  party_id: string
  role_on_order?: string
  name?: string
  country?: string
  status?: string
}

interface OrderGate {
  gate_status?: string
  block_reasons?: string[]
  checks?: { label: string; passed: boolean; detail?: string }[]
}

interface OrderDetail {
  id: string
  reference: string
  destination_country?: string
  end_use?: string
  value_cents?: number
  gate_status: string
  block_reasons?: string[]
  override_reason?: string | null
  override_by?: string | null
  overridden_at?: string | null
  created_at?: string
  updated_at?: string
  parties?: OrderParty[]
  gate?: OrderGate
}

function fmtMoney(cents?: number): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString()
}

function gateLabel(s?: string): string {
  return (s ?? '').replace(/_/g, ' ')
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string
  const router = useRouter()

  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ reference: '', destination_country: '', end_use: '', value: '' })
  const [editError, setEditError] = useState<string | null>(null)

  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [overrideError, setOverrideError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.getOrder(id)
      setOrder(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load order')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  function openEdit() {
    if (!order) return
    setEditForm({
      reference: order.reference ?? '',
      destination_country: order.destination_country ?? '',
      end_use: order.end_use ?? '',
      value: order.value_cents != null ? String(order.value_cents / 100) : '',
    })
    setEditError(null)
    setEditOpen(true)
  }

  async function saveEdit() {
    if (!order) return
    if (!editForm.reference.trim()) {
      setEditError('Reference is required')
      return
    }
    setBusy('edit')
    setEditError(null)
    try {
      const updated = await api.updateOrder(order.id, {
        reference: editForm.reference.trim(),
        destination_country: editForm.destination_country.trim() || undefined,
        end_use: editForm.end_use.trim() || undefined,
        value_cents: editForm.value ? Math.round(parseFloat(editForm.value) * 100) : undefined,
      })
      setOrder(updated)
      setEditOpen(false)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to update order')
    } finally {
      setBusy(null)
    }
  }

  async function evaluate() {
    if (!order) return
    setBusy('evaluate')
    setError(null)
    try {
      const updated = await api.evaluateOrder(order.id)
      setOrder(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to evaluate gate')
    } finally {
      setBusy(null)
    }
  }

  async function submitOverride() {
    if (!order) return
    if (overrideReason.trim().length < 5) {
      setOverrideError('A justification of at least 5 characters is required')
      return
    }
    setBusy('override')
    setOverrideError(null)
    try {
      await api.overrideOrder(order.id, { override_reason: overrideReason.trim() })
      setOverrideOpen(false)
      setOverrideReason('')
      await load()
    } catch (e) {
      setOverrideError(e instanceof Error ? e.message : 'Failed to override order')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <FullPageSpinner label="Loading order..." />

  if (error && !order) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/orders" className="text-sm text-lime-400 hover:text-lime-300">← Back to orders</Link>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      </div>
    )
  }

  if (!order) return null

  const gate = order.gate ?? {}
  const checks = gate.checks ?? []
  const blockReasons = order.block_reasons ?? gate.block_reasons ?? []
  const isGated = order.gate_status === 'blocked' || order.gate_status === 'pending_review'
  const parties = order.parties ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/orders" className="text-sm text-lime-400 hover:text-lime-300">← Back to orders</Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-xl font-semibold text-zinc-100">{order.reference}</h1>
            <Badge tone={statusTone(order.gate_status)}>{gateLabel(order.gate_status)}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {order.destination_country || 'No destination'} · {order.end_use || 'No declared end use'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {busy && <Spinner />}
          <Button variant="secondary" onClick={openEdit}>Edit</Button>
          <Button variant="secondary" onClick={evaluate} disabled={busy === 'evaluate'}>
            {busy === 'evaluate' ? 'Evaluating...' : 'Re-evaluate gate'}
          </Button>
          {isGated && (
            <Button onClick={() => { setOverrideReason(''); setOverrideError(null); setOverrideOpen(true) }}>
              Override gate
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Gate status" value={gateLabel(order.gate_status)} tone={isGated ? 'red' : order.gate_status === 'released' ? 'green' : 'default'} />
        <Stat label="Value" value={fmtMoney(order.value_cents)} />
        <Stat label="Parties" value={parties.length} />
        <Stat label="Block reasons" value={blockReasons.length} tone={blockReasons.length ? 'red' : 'default'} />
      </div>

      {order.gate_status === 'overridden' && (
        <Card className="border-lime-500/40">
          <CardBody>
            <div className="flex items-start gap-3">
              <span className="text-lg">⚠️</span>
              <div>
                <div className="text-sm font-semibold text-lime-400">Gate overridden</div>
                <p className="mt-1 text-sm text-zinc-300">{order.override_reason || 'No justification recorded'}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  By {order.override_by || 'unknown'} · {fmtDateTime(order.overridden_at)}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Gate evaluation</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {blockReasons.length > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-400">Block reasons</div>
                <ul className="space-y-1 text-sm text-red-300">
                  {blockReasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span>•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {checks.length > 0 ? (
              <div className="space-y-2">
                {checks.map((c, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                    <div>
                      <div className="text-sm text-zinc-200">{c.label}</div>
                      {c.detail && <div className="text-xs text-zinc-500">{c.detail}</div>}
                    </div>
                    <Badge tone={c.passed ? 'green' : 'red'}>{c.passed ? 'pass' : 'fail'}</Badge>
                  </div>
                ))}
              </div>
            ) : blockReasons.length === 0 ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
                No blocking conditions detected. Re-evaluate to refresh against the latest party statuses, embargoes, and end-use rules.
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Order details</h2>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-zinc-500">Reference</dt>
              <dd className="text-zinc-200">{order.reference}</dd>
              <dt className="text-zinc-500">Destination</dt>
              <dd className="text-zinc-200">{order.destination_country || '—'}</dd>
              <dt className="text-zinc-500">End use</dt>
              <dd className="text-zinc-200">{order.end_use || '—'}</dd>
              <dt className="text-zinc-500">Value</dt>
              <dd className="text-zinc-200 tabular-nums">{fmtMoney(order.value_cents)}</dd>
              <dt className="text-zinc-500">Created</dt>
              <dd className="text-zinc-200">{fmtDateTime(order.created_at)}</dd>
              <dt className="text-zinc-500">Updated</dt>
              <dd className="text-zinc-200">{fmtDateTime(order.updated_at)}</dd>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Parties on order</h2>
        </CardHeader>
        <CardBody className="p-0">
          {parties.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">No parties attached to this order.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Party</TH>
                  <TH>Role</TH>
                  <TH>Country</TH>
                  <TH>Screening status</TH>
                </TR>
              </THead>
              <TBody>
                {parties.map((p, i) => (
                  <TR key={p.id ?? p.party_id ?? i}>
                    <TD>
                      <Link href={`/dashboard/parties/${p.party_id}`} className="font-medium text-zinc-100 hover:text-lime-400">
                        {p.name || p.party_id}
                      </Link>
                    </TD>
                    <TD className="capitalize text-zinc-400">{(p.role_on_order ?? '').replace(/_/g, ' ') || '—'}</TD>
                    <TD>{p.country || '—'}</TD>
                    <TD>{p.status ? <Badge tone={statusTone(p.status)}>{p.status.replace(/_/g, ' ')}</Badge> : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit order"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy === 'edit'}>{busy === 'edit' ? 'Saving...' : 'Save changes'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {editError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{editError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Reference *</label>
            <input
              value={editForm.reference}
              onChange={(e) => setEditForm((f) => ({ ...f, reference: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Destination</label>
              <input
                value={editForm.destination_country}
                onChange={(e) => setEditForm((f) => ({ ...f, destination_country: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Value (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editForm.value}
                onChange={(e) => setEditForm((f) => ({ ...f, value: e.target.value }))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">End use</label>
            <input
              value={editForm.end_use}
              onChange={(e) => setEditForm((f) => ({ ...f, end_use: e.target.value }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-zinc-600">Saving re-evaluates the compliance gate against the updated details.</p>
        </div>
      </Modal>

      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override compliance gate"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={submitOverride} disabled={busy === 'override'}>
              {busy === 'override' ? 'Releasing...' : 'Release with override'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {overrideError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{overrideError}</div>
          )}
          <div className="rounded-lg border border-lime-500/30 bg-lime-500/10 px-3 py-2 text-sm text-lime-300">
            Overriding releases a gated order despite outstanding block reasons. The justification is written to the immutable
            audit ledger and attributed to you.
          </div>
          {blockReasons.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Outstanding block reasons</div>
              <ul className="space-y-1 text-sm text-red-300">
                {blockReasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Justification *</label>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={4}
              placeholder="Document the compliance rationale for releasing this order..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
