'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  slug?: string | null
  created_by?: string | null
  created_at?: string
}

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface Subscription {
  id?: string
  user_id?: string
  plan_id?: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string
  current_period_end?: string | null
}

interface BillingPlan {
  subscription: Subscription | null
  plan: Plan | null
  stripeEnabled: boolean
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-lime-500/60 focus:outline-none focus:ring-1 focus:ring-lime-500/40'

const labelCls = 'block text-xs font-medium uppercase tracking-wide text-zinc-500 mb-1.5'

function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtPrice(cents?: number) {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}/mo`
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [billing, setBilling] = useState<BillingPlan | null>(null)

  // create workspace modal
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [creating, setCreating] = useState(false)

  // rename modal
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)

  // billing / demo busy flags
  const [billingBusy, setBillingBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  const loadWorkspaces = useCallback(async () => {
    const ws = await api.listWorkspaces()
    const list: Workspace[] = Array.isArray(ws) ? ws : []
    setWorkspaces(list)
    setActiveId((prev) => prev ?? (list[0]?.id ?? null))
    return list
  }, [])

  const loadBilling = useCallback(async () => {
    try {
      const b = await api.getBillingPlan()
      setBilling(b as BillingPlan)
    } catch (e) {
      // billing failure shouldn't block the page
      setBilling(null)
      setError((prev) => prev ?? (e instanceof Error ? e.message : 'Failed to load billing'))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        await loadWorkspaces()
        if (cancelled) return
        await loadBilling()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load settings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadWorkspaces, loadBilling])

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  )

  const isPro = useMemo(() => {
    const planId = billing?.subscription?.plan_id ?? billing?.plan?.id
    return (planId ?? '').toLowerCase() === 'pro'
  }, [billing])

  function flash(msg: string) {
    setNotice(msg)
    setError(null)
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000)
  }

  // ---- Create workspace ----
  function openCreate() {
    setNewName('')
    setNewSlug('')
    setSlugTouched(false)
    setCreateOpen(true)
  }

  async function submitCreate() {
    const name = newName.trim()
    if (!name) {
      setError('Workspace name is required')
      return
    }
    const slug = (slugTouched ? newSlug.trim() : slugify(name)) || slugify(name)
    setCreating(true)
    setError(null)
    try {
      const created = (await api.createWorkspace({ name, slug })) as Workspace
      setCreateOpen(false)
      const list = await loadWorkspaces()
      if (created?.id) setActiveId(created.id)
      else if (list.length) setActiveId(list[list.length - 1].id)
      flash(`Workspace "${name}" created`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  // ---- Rename workspace ----
  function openRename(w: Workspace) {
    setRenameTarget(w)
    setRenameName(w.name)
  }

  async function submitRename() {
    if (!renameTarget) return
    const name = renameName.trim()
    if (!name) {
      setError('Workspace name is required')
      return
    }
    setRenaming(true)
    setError(null)
    try {
      await api.updateWorkspace(renameTarget.id, { name })
      setRenameTarget(null)
      await loadWorkspaces()
      flash('Workspace renamed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename workspace')
    } finally {
      setRenaming(false)
    }
  }

  // ---- Billing ----
  async function upgrade() {
    if (!billing?.stripeEnabled) {
      setError('Billing is not configured for this deployment.')
      return
    }
    setBillingBusy(true)
    setError(null)
    try {
      const res = (await api.createCheckout({})) as { url?: string }
      if (res?.url) window.location.href = res.url
      else setError('Checkout session did not return a URL.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start checkout')
    } finally {
      setBillingBusy(false)
    }
  }

  async function manageBilling() {
    if (!billing?.stripeEnabled) {
      setError('Billing is not configured for this deployment.')
      return
    }
    setBillingBusy(true)
    setError(null)
    try {
      const res = (await api.createPortal({})) as { url?: string }
      if (res?.url) window.location.href = res.url
      else setError('Billing portal did not return a URL.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open billing portal')
    } finally {
      setBillingBusy(false)
    }
  }

  // ---- Demo reset ----
  async function confirmReset() {
    if (!activeId) return
    setResetting(true)
    setError(null)
    try {
      const res = (await api.resetDemo(activeId, {})) as { counts?: Record<string, number> }
      setResetOpen(false)
      const counts = res?.counts ?? {}
      const summary = Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
      flash(summary ? `Demo data regenerated: ${summary}` : 'Demo data regenerated')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset demo data')
    } finally {
      setResetting(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading settings..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Settings</h1>
        <p className="text-sm text-zinc-500">
          Manage workspaces, subscription and billing, and regenerate the demo dataset for screening evaluation.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          {notice}
        </div>
      )}

      {/* Overview stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Workspaces" value={workspaces.length} />
        <Stat label="Active Workspace" value={activeWorkspace ? activeWorkspace.name : '—'} />
        <Stat label="Plan" value={billing?.plan?.name ?? (isPro ? 'Pro' : 'Free')} tone={isPro ? 'amber' : 'default'} />
        <Stat
          label="Subscription"
          value={billing?.subscription?.status ? billing.subscription.status : 'none'}
          tone={billing?.subscription?.status === 'active' ? 'green' : 'default'}
        />
      </div>

      {/* Workspaces */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Workspaces</h2>
            <p className="text-xs text-zinc-500">The active workspace scopes parties, lists, screenings and orders.</p>
          </div>
          <Button onClick={openCreate}>New workspace</Button>
        </CardHeader>
        <CardBody className="p-0">
          {workspaces.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No workspaces yet"
                description="Create your first workspace to start building a screening ledger."
                action={<Button onClick={openCreate}>Create workspace</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Slug</TH>
                  <TH>Created</TH>
                  <TH>State</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {workspaces.map((w) => {
                  const active = w.id === activeId
                  return (
                    <TR key={w.id}>
                      <TD className="font-medium text-zinc-100">{w.name}</TD>
                      <TD className="font-mono text-xs text-zinc-500">{w.slug || '—'}</TD>
                      <TD className="text-zinc-500">{fmtDate(w.created_at)}</TD>
                      <TD>
                        {active ? (
                          <Badge tone="amber">active</Badge>
                        ) : (
                          <Badge tone="zinc">idle</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          {!active && (
                            <Button variant="ghost" onClick={() => setActiveId(w.id)}>
                              Set active
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => openRename(w)}>
                            Rename
                          </Button>
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

      {/* Billing */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-zinc-100">Billing &amp; Subscription</h2>
          <p className="text-xs text-zinc-500">
            {billing?.stripeEnabled
              ? 'Manage your plan through Stripe.'
              : 'Stripe is not configured for this deployment; plan shown for reference only.'}
          </p>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Current plan</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-lg font-semibold text-zinc-100">{billing?.plan?.name ?? (isPro ? 'Pro' : 'Free')}</span>
                <Badge tone={isPro ? 'amber' : 'zinc'}>{isPro ? 'PRO' : 'FREE'}</Badge>
              </div>
              <div className="mt-1 text-xs text-zinc-500">{fmtPrice(billing?.plan?.price_cents)}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Status</div>
              <div className="mt-1">
                {billing?.subscription?.status ? (
                  <Badge tone={statusTone(billing.subscription.status)}>{billing.subscription.status}</Badge>
                ) : (
                  <span className="text-sm text-zinc-500">No active subscription</span>
                )}
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                Renews / ends: {fmtDate(billing?.subscription?.current_period_end)}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Stripe</div>
              <div className="mt-1">
                <Badge tone={billing?.stripeEnabled ? 'green' : 'zinc'}>
                  {billing?.stripeEnabled ? 'enabled' : 'not configured'}
                </Badge>
              </div>
              <div className="mt-2 font-mono text-[11px] text-zinc-600 truncate">
                {billing?.subscription?.stripe_customer_id || '—'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {isPro ? (
              <Button onClick={manageBilling} disabled={billingBusy || !billing?.stripeEnabled}>
                {billingBusy ? 'Opening...' : 'Manage billing'}
              </Button>
            ) : (
              <Button onClick={upgrade} disabled={billingBusy || !billing?.stripeEnabled}>
                {billingBusy ? 'Redirecting...' : 'Upgrade to Pro'}
              </Button>
            )}
            {isPro && billing?.stripeEnabled && (
              <Button variant="secondary" onClick={manageBilling} disabled={billingBusy}>
                Update payment method
              </Button>
            )}
            {!billing?.stripeEnabled && (
              <span className="self-center text-xs text-zinc-500">
                Set Stripe keys on the backend to enable checkout and the billing portal.
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Demo data */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-zinc-100">Demo Data</h2>
          <p className="text-xs text-zinc-500">
            Regenerate a synthetic dataset (parties, lists with versions, near-match decoys, orders, screenings and
            matches) for the active workspace.
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-400">
            {activeWorkspace ? (
              <>
                Reset destroys existing screening data in{' '}
                <span className="font-medium text-zinc-200">{activeWorkspace.name}</span> and reseeds a fresh evaluation
                set. This action cannot be undone.
              </>
            ) : (
              'Select or create a workspace first.'
            )}
          </div>
          <Button
            variant="danger"
            onClick={() => setResetOpen(true)}
            disabled={!activeId || resetting}
          >
            Reset demo data
          </Button>
        </CardBody>
      </Card>

      {/* Create workspace modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New workspace"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Name</label>
            <input
              autoFocus
              className={inputCls}
              value={newName}
              placeholder="Acme Trade Compliance"
              onChange={(e) => {
                setNewName(e.target.value)
                if (!slugTouched) setNewSlug(slugify(e.target.value))
              }}
            />
          </div>
          <div>
            <label className={labelCls}>Slug</label>
            <input
              className={inputCls}
              value={newSlug}
              placeholder="acme-trade-compliance"
              onChange={(e) => {
                setSlugTouched(true)
                setNewSlug(slugify(e.target.value))
              }}
            />
            <p className="mt-1 text-xs text-zinc-600">Unique identifier used in URLs. Lowercase letters, numbers and dashes.</p>
          </div>
        </div>
      </Modal>

      {/* Rename workspace modal */}
      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename workspace"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)} disabled={renaming}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={renaming || !renameName.trim()}>
              {renaming ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        <div>
          <label className={labelCls}>Name</label>
          <input
            autoFocus
            className={inputCls}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
          />
        </div>
      </Modal>

      {/* Reset confirm modal */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset demo data"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmReset} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Reset and reseed'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-400">
          This will permanently delete the current parties, lists, screenings, matches and orders in{' '}
          <span className="font-medium text-zinc-200">{activeWorkspace?.name ?? 'this workspace'}</span> and replace them
          with a freshly generated synthetic dataset. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
