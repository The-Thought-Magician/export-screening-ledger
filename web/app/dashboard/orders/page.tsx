'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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

interface Order {
  id: string
  reference: string
  destination_country?: string
  end_use?: string
  value_cents?: number
  gate_status: string
  block_reasons?: string[]
  created_at?: string
}

interface Party {
  id: string
  name: string
  country?: string
  status?: string
}

const GATE_STATUSES = ['draft', 'blocked', 'pending_review', 'released', 'overridden']
const ROLE_OPTIONS = ['consignee', 'end_user', 'intermediary', 'freight_forwarder', 'purchaser']

function fmtMoney(cents?: number): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function gateLabel(s: string): string {
  return s.replace(/_/g, ' ')
}

export default function OrdersPage() {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [orders, setOrders] = useState<Order[]>([])
  const [parties, setParties] = useState<Party[]>([])

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [query, setQuery] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    reference: '',
    destination_country: '',
    end_use: '',
    value: '',
  })
  const [selectedParties, setSelectedParties] = useState<{ party_id: string; role_on_order: string }[]>([])

  const loadOrders = useCallback(async (wsId: string, soft = false) => {
    if (soft) setRefreshing(true)
    setError(null)
    try {
      const res = await api.listOrders(wsId, statusFilter ? { gate_status: statusFilter } : undefined)
      setOrders(Array.isArray(res) ? res : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders')
    } finally {
      setRefreshing(false)
    }
  }, [statusFilter])

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
        const [ordersRes, partiesRes] = await Promise.all([
          api.listOrders(wsId),
          api.listParties(wsId),
        ])
        if (cancelled) return
        setOrders(Array.isArray(ordersRes) ? ordersRes : [])
        setParties(Array.isArray(partiesRes) ? partiesRes : [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load orders')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Re-fetch when the status filter changes (after initial load).
  useEffect(() => {
    if (workspaceId) loadOrders(workspaceId, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(
      (o) =>
        o.reference?.toLowerCase().includes(q) ||
        o.destination_country?.toLowerCase().includes(q) ||
        o.end_use?.toLowerCase().includes(q),
    )
  }, [orders, query])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of orders) c[o.gate_status] = (c[o.gate_status] ?? 0) + 1
    return c
  }, [orders])

  const blockedCount = (counts.blocked ?? 0) + (counts.pending_review ?? 0)

  function openCreate() {
    setForm({ reference: '', destination_country: '', end_use: '', value: '' })
    setSelectedParties([])
    setFormError(null)
    setModalOpen(true)
  }

  function addPartyRow() {
    const firstUnused = parties.find((p) => !selectedParties.some((sp) => sp.party_id === p.id))
    setSelectedParties((rows) => [...rows, { party_id: firstUnused?.id ?? '', role_on_order: 'end_user' }])
  }

  async function submit() {
    if (!workspaceId) return
    if (!form.reference.trim()) {
      setFormError('Reference is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        workspace_id: workspaceId,
        reference: form.reference.trim(),
        destination_country: form.destination_country.trim() || undefined,
        end_use: form.end_use.trim() || undefined,
        value_cents: form.value ? Math.round(parseFloat(form.value) * 100) : undefined,
        parties: selectedParties.filter((p) => p.party_id),
      }
      const created = await api.createOrder(payload)
      setModalOpen(false)
      if (created?.id) {
        router.push(`/dashboard/orders/${created.id}`)
      } else {
        await loadOrders(workspaceId, true)
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create order')
    } finally {
      setSaving(false)
    }
  }

  async function remove(o: Order) {
    if (!workspaceId) return
    if (!confirm(`Delete order ${o.reference}?`)) return
    try {
      await api.deleteOrder(o.id)
      await loadOrders(workspaceId, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete order')
    }
  }

  if (loading) return <FullPageSpinner label="Loading orders..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Orders</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Export orders with their compliance gate status. Gates evaluate party screening, embargoes, and end-use rules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshing && <Spinner />}
          <Button onClick={openCreate}>New order</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total orders" value={orders.length} />
        <Stat label="Blocked / pending" value={blockedCount} tone={blockedCount ? 'red' : 'default'} />
        <Stat label="Released" value={counts.released ?? 0} tone="green" />
        <Stat label="Overridden" value={counts.overridden ?? 0} tone={counts.overridden ? 'amber' : 'default'} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter('')}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                statusFilter === '' ? 'bg-lime-500/10 text-lime-400' : 'text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              All
            </button>
            {GATE_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1.5 text-sm capitalize transition-colors ${
                  statusFilter === s ? 'bg-lime-500/10 text-lime-400' : 'text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {gateLabel(s)} {counts[s] ? <span className="text-zinc-600">({counts[s]})</span> : null}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reference, country, end use..."
            className="w-64 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={orders.length === 0 ? 'No orders yet' : 'No matching orders'}
                description={
                  orders.length === 0
                    ? 'Create your first export order to run it through the compliance gate.'
                    : 'Adjust your search or filter to find orders.'
                }
                icon="📦"
                action={orders.length === 0 ? <Button onClick={openCreate}>New order</Button> : undefined}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reference</TH>
                  <TH>Destination</TH>
                  <TH>End use</TH>
                  <TH>Value</TH>
                  <TH>Gate</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/dashboard/orders/${o.id}`} className="font-medium text-zinc-100 hover:text-lime-400">
                        {o.reference}
                      </Link>
                    </TD>
                    <TD>{o.destination_country || '—'}</TD>
                    <TD className="max-w-[14rem] truncate text-zinc-400">{o.end_use || '—'}</TD>
                    <TD className="tabular-nums">{fmtMoney(o.value_cents)}</TD>
                    <TD>
                      <div className="flex flex-col gap-1">
                        <Badge tone={statusTone(o.gate_status)}>{gateLabel(o.gate_status)}</Badge>
                        {o.block_reasons && o.block_reasons.length > 0 && (
                          <span className="text-xs text-red-400/80">{o.block_reasons.length} block reason(s)</span>
                        )}
                      </div>
                    </TD>
                    <TD className="text-zinc-500">{fmtDate(o.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/orders/${o.id}`}>
                          <Button variant="secondary" className="px-3 py-1">Open</Button>
                        </Link>
                        <Button variant="danger" className="px-3 py-1" onClick={() => remove(o)}>Delete</Button>
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New export order"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Creating...' : 'Create order'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Reference *</label>
            <input
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              placeholder="PO-2026-0042"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Destination country</label>
              <input
                value={form.destination_country}
                onChange={(e) => setForm((f) => ({ ...f, destination_country: e.target.value }))}
                placeholder="Germany"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Value (USD)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder="25000"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">End use</label>
            <input
              value={form.end_use}
              onChange={(e) => setForm((f) => ({ ...f, end_use: e.target.value }))}
              placeholder="Commercial telecom infrastructure"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-lime-500 focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Parties on order</label>
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={addPartyRow} disabled={parties.length === 0}>
                + Add party
              </Button>
            </div>
            {parties.length === 0 ? (
              <p className="text-xs text-zinc-600">No parties available. Add parties first to attach them to an order.</p>
            ) : selectedParties.length === 0 ? (
              <p className="text-xs text-zinc-600">No parties attached. The order will be created without parties.</p>
            ) : (
              <div className="space-y-2">
                {selectedParties.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={row.party_id}
                      onChange={(e) =>
                        setSelectedParties((rows) => rows.map((r, j) => (j === i ? { ...r, party_id: e.target.value } : r)))
                      }
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
                    >
                      {parties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.country ? `(${p.country})` : ''}
                        </option>
                      ))}
                    </select>
                    <select
                      value={row.role_on_order}
                      onChange={(e) =>
                        setSelectedParties((rows) => rows.map((r, j) => (j === i ? { ...r, role_on_order: e.target.value } : r)))
                      }
                      className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setSelectedParties((rows) => rows.filter((_, j) => j !== i))}
                      className="px-2 text-zinc-500 hover:text-red-400"
                      aria-label="Remove party"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
