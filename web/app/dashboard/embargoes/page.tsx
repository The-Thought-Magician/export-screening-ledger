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

interface Embargo {
  id: string
  workspace_id: string
  country_code: string
  country_name: string
  embargo_type: string
  notes?: string | null
  is_active: boolean
  created_at?: string
}

interface EndUseRule {
  id: string
  workspace_id: string
  label: string
  keyword: string
  category: string
  action: string
  notes?: string | null
  is_active: boolean
  created_at?: string
}

const EMBARGO_TYPES = ['comprehensive', 'arms', 'sectoral', 'targeted', 'partial']
const ENDUSE_CATEGORIES = ['military', 'nuclear', 'missile', 'chemical_biological', 'surveillance', 'other']
const ENDUSE_ACTIONS = ['block', 'flag', 'review']

function actionTone(action: string) {
  switch (action) {
    case 'block':
      return 'red' as const
    case 'flag':
      return 'amber' as const
    case 'review':
      return 'blue' as const
    default:
      return 'neutral' as const
  }
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-lime-500/60 focus:outline-none focus:ring-1 focus:ring-lime-500/40'
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500'

export default function EmbargoesPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [embargoes, setEmbargoes] = useState<Embargo[]>([])
  const [endUses, setEndUses] = useState<EndUseRule[]>([])

  const [tab, setTab] = useState<'embargoes' | 'enduses'>('embargoes')
  const [embSearch, setEmbSearch] = useState('')
  const [euSearch, setEuSearch] = useState('')

  // Embargo modal
  const [embModalOpen, setEmbModalOpen] = useState(false)
  const [editEmb, setEditEmb] = useState<Embargo | null>(null)
  const [embForm, setEmbForm] = useState({
    country_code: '',
    country_name: '',
    embargo_type: 'comprehensive',
    notes: '',
    is_active: true,
  })

  // End use modal
  const [euModalOpen, setEuModalOpen] = useState(false)
  const [editEu, setEditEu] = useState<EndUseRule | null>(null)
  const [euForm, setEuForm] = useState({
    label: '',
    keyword: '',
    category: 'military',
    action: 'block',
    notes: '',
    is_active: true,
  })

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const [emb, eu] = await Promise.all([api.listEmbargoes(wsId), api.listEndUses(wsId)])
      setEmbargoes(Array.isArray(emb) ? emb : [])
      setEndUses(Array.isArray(eu) ? eu : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
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
        await load(wsId)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const filteredEmbargoes = useMemo(() => {
    const q = embSearch.trim().toLowerCase()
    if (!q) return embargoes
    return embargoes.filter(
      (e) =>
        e.country_name?.toLowerCase().includes(q) ||
        e.country_code?.toLowerCase().includes(q) ||
        e.embargo_type?.toLowerCase().includes(q),
    )
  }, [embargoes, embSearch])

  const filteredEndUses = useMemo(() => {
    const q = euSearch.trim().toLowerCase()
    if (!q) return endUses
    return endUses.filter(
      (e) =>
        e.label?.toLowerCase().includes(q) ||
        e.keyword?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q),
    )
  }, [endUses, euSearch])

  const stats = useMemo(() => {
    return {
      embTotal: embargoes.length,
      embActive: embargoes.filter((e) => e.is_active).length,
      euTotal: endUses.length,
      euBlocking: endUses.filter((e) => e.action === 'block' && e.is_active).length,
    }
  }, [embargoes, endUses])

  // ---- Embargo handlers ----
  function openCreateEmbargo() {
    setEditEmb(null)
    setEmbForm({ country_code: '', country_name: '', embargo_type: 'comprehensive', notes: '', is_active: true })
    setFormError(null)
    setEmbModalOpen(true)
  }

  function openEditEmbargo(e: Embargo) {
    setEditEmb(e)
    setEmbForm({
      country_code: e.country_code,
      country_name: e.country_name,
      embargo_type: e.embargo_type,
      notes: e.notes ?? '',
      is_active: e.is_active,
    })
    setFormError(null)
    setEmbModalOpen(true)
  }

  async function saveEmbargo() {
    if (!workspaceId) return
    if (!embForm.country_code.trim() || !embForm.country_name.trim()) {
      setFormError('Country code and name are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body = {
        workspace_id: workspaceId,
        country_code: embForm.country_code.trim().toUpperCase(),
        country_name: embForm.country_name.trim(),
        embargo_type: embForm.embargo_type,
        notes: embForm.notes.trim() || null,
        is_active: embForm.is_active,
      }
      if (editEmb) {
        await api.updateEmbargo(editEmb.id, body)
      } else {
        await api.createEmbargo(body)
      }
      setEmbModalOpen(false)
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save embargo')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEmbargoActive(e: Embargo) {
    if (!workspaceId) return
    try {
      await api.updateEmbargo(e.id, {
        workspace_id: workspaceId,
        country_code: e.country_code,
        country_name: e.country_name,
        embargo_type: e.embargo_type,
        notes: e.notes ?? null,
        is_active: !e.is_active,
      })
      await load(workspaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update embargo')
    }
  }

  async function removeEmbargo(e: Embargo) {
    if (!workspaceId) return
    if (!confirm(`Delete embargo for ${e.country_name}?`)) return
    try {
      await api.deleteEmbargo(e.id)
      await load(workspaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete embargo')
    }
  }

  // ---- End use handlers ----
  function openCreateEndUse() {
    setEditEu(null)
    setEuForm({ label: '', keyword: '', category: 'military', action: 'block', notes: '', is_active: true })
    setFormError(null)
    setEuModalOpen(true)
  }

  function openEditEndUse(e: EndUseRule) {
    setEditEu(e)
    setEuForm({
      label: e.label,
      keyword: e.keyword,
      category: e.category,
      action: e.action,
      notes: e.notes ?? '',
      is_active: e.is_active,
    })
    setFormError(null)
    setEuModalOpen(true)
  }

  async function saveEndUse() {
    if (!workspaceId) return
    if (!euForm.label.trim() || !euForm.keyword.trim()) {
      setFormError('Label and keyword are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body = {
        workspace_id: workspaceId,
        label: euForm.label.trim(),
        keyword: euForm.keyword.trim(),
        category: euForm.category,
        action: euForm.action,
        notes: euForm.notes.trim() || null,
        is_active: euForm.is_active,
      }
      if (editEu) {
        await api.updateEndUse(editEu.id, body)
      } else {
        await api.createEndUse(body)
      }
      setEuModalOpen(false)
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save end-use rule')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEndUseActive(e: EndUseRule) {
    if (!workspaceId) return
    try {
      await api.updateEndUse(e.id, {
        workspace_id: workspaceId,
        label: e.label,
        keyword: e.keyword,
        category: e.category,
        action: e.action,
        notes: e.notes ?? null,
        is_active: !e.is_active,
      })
      await load(workspaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule')
    }
  }

  async function removeEndUse(e: EndUseRule) {
    if (!workspaceId) return
    if (!confirm(`Delete end-use rule "${e.label}"?`)) return
    try {
      await api.deleteEndUse(e.id)
      await load(workspaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule')
    }
  }

  if (loading) return <FullPageSpinner label="Loading embargo controls..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Embargoes &amp; End Uses</h1>
        <p className="text-sm text-zinc-500">
          Country embargo controls and prohibited end-use rules applied at the order gate.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Embargoed Countries" value={stats.embTotal} hint={`${stats.embActive} active`} />
        <Stat label="Active Embargoes" value={stats.embActive} tone="red" />
        <Stat label="End-Use Rules" value={stats.euTotal} />
        <Stat label="Blocking Rules" value={stats.euBlocking} tone="amber" hint="action = block" />
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        <button
          onClick={() => setTab('embargoes')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'embargoes'
              ? 'border-lime-500 text-lime-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-200'
          }`}
        >
          Embargoed Countries ({embargoes.length})
        </button>
        <button
          onClick={() => setTab('enduses')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'enduses'
              ? 'border-lime-500 text-lime-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-200'
          }`}
        >
          End-Use Rules ({endUses.length})
        </button>
      </div>

      {tab === 'embargoes' && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={embSearch}
              onChange={(e) => setEmbSearch(e.target.value)}
              placeholder="Search countries..."
              className={`${inputCls} sm:max-w-xs`}
            />
            <Button onClick={openCreateEmbargo}>Add Country</Button>
          </CardHeader>
          <CardBody className="p-0">
            {filteredEmbargoes.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title={embargoes.length === 0 ? 'No embargoed countries' : 'No matches'}
                  description={
                    embargoes.length === 0
                      ? 'Add a country to enforce embargo controls during order screening.'
                      : 'No countries match your search.'
                  }
                  action={
                    embargoes.length === 0 ? <Button onClick={openCreateEmbargo}>Add Country</Button> : undefined
                  }
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Country</TH>
                    <TH>Code</TH>
                    <TH>Type</TH>
                    <TH>Notes</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredEmbargoes.map((e) => (
                    <TR key={e.id}>
                      <TD className="font-medium text-zinc-100">{e.country_name}</TD>
                      <TD>
                        <span className="font-mono text-xs text-zinc-400">{e.country_code}</span>
                      </TD>
                      <TD>
                        <Badge tone={e.embargo_type === 'comprehensive' ? 'red' : 'amber'}>{e.embargo_type}</Badge>
                      </TD>
                      <TD className="max-w-xs truncate text-zinc-500">{e.notes || '—'}</TD>
                      <TD>
                        <button onClick={() => toggleEmbargoActive(e)} title="Toggle active">
                          <Badge tone={e.is_active ? 'green' : 'zinc'}>{e.is_active ? 'active' : 'inactive'}</Badge>
                        </button>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => openEditEmbargo(e)}>
                            Edit
                          </Button>
                          <Button variant="ghost" className="text-red-400" onClick={() => removeEmbargo(e)}>
                            Delete
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'enduses' && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={euSearch}
              onChange={(e) => setEuSearch(e.target.value)}
              placeholder="Search rules..."
              className={`${inputCls} sm:max-w-xs`}
            />
            <Button onClick={openCreateEndUse}>Add Rule</Button>
          </CardHeader>
          <CardBody className="p-0">
            {filteredEndUses.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title={endUses.length === 0 ? 'No end-use rules' : 'No matches'}
                  description={
                    endUses.length === 0
                      ? 'Define keyword rules that flag or block prohibited end uses.'
                      : 'No rules match your search.'
                  }
                  action={endUses.length === 0 ? <Button onClick={openCreateEndUse}>Add Rule</Button> : undefined}
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Label</TH>
                    <TH>Keyword</TH>
                    <TH>Category</TH>
                    <TH>Action</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredEndUses.map((e) => (
                    <TR key={e.id}>
                      <TD className="font-medium text-zinc-100">{e.label}</TD>
                      <TD>
                        <span className="font-mono text-xs text-lime-400">{e.keyword}</span>
                      </TD>
                      <TD>
                        <Badge tone="neutral">{e.category}</Badge>
                      </TD>
                      <TD>
                        <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                      </TD>
                      <TD>
                        <button onClick={() => toggleEndUseActive(e)} title="Toggle active">
                          <Badge tone={e.is_active ? 'green' : 'zinc'}>{e.is_active ? 'active' : 'inactive'}</Badge>
                        </button>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => openEditEndUse(e)}>
                            Edit
                          </Button>
                          <Button variant="ghost" className="text-red-400" onClick={() => removeEndUse(e)}>
                            Delete
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* Embargo modal */}
      <Modal
        open={embModalOpen}
        onClose={() => setEmbModalOpen(false)}
        title={editEmb ? 'Edit Embargoed Country' : 'Add Embargoed Country'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEmbModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEmbargo} disabled={saving}>
              {saving ? <Spinner /> : editEmb ? 'Save Changes' : 'Add Country'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Country Code</label>
              <input
                value={embForm.country_code}
                onChange={(e) => setEmbForm({ ...embForm, country_code: e.target.value })}
                placeholder="IR"
                maxLength={3}
                className={`${inputCls} uppercase`}
              />
            </div>
            <div>
              <label className={labelCls}>Country Name</label>
              <input
                value={embForm.country_name}
                onChange={(e) => setEmbForm({ ...embForm, country_name: e.target.value })}
                placeholder="Iran"
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Embargo Type</label>
            <select
              value={embForm.embargo_type}
              onChange={(e) => setEmbForm({ ...embForm, embargo_type: e.target.value })}
              className={inputCls}
            >
              {EMBARGO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={embForm.notes}
              onChange={(e) => setEmbForm({ ...embForm, notes: e.target.value })}
              placeholder="Regulatory basis, scope, exemptions..."
              rows={3}
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={embForm.is_active}
              onChange={(e) => setEmbForm({ ...embForm, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-lime-500"
            />
            Active (enforced at order gate)
          </label>
        </div>
      </Modal>

      {/* End-use modal */}
      <Modal
        open={euModalOpen}
        onClose={() => setEuModalOpen(false)}
        title={editEu ? 'Edit End-Use Rule' : 'Add End-Use Rule'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEuModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveEndUse} disabled={saving}>
              {saving ? <Spinner /> : editEu ? 'Save Changes' : 'Add Rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div>
            <label className={labelCls}>Label</label>
            <input
              value={euForm.label}
              onChange={(e) => setEuForm({ ...euForm, label: e.target.value })}
              placeholder="Military procurement"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Keyword (matched against order end-use text)</label>
            <input
              value={euForm.keyword}
              onChange={(e) => setEuForm({ ...euForm, keyword: e.target.value })}
              placeholder="missile"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <select
                value={euForm.category}
                onChange={(e) => setEuForm({ ...euForm, category: e.target.value })}
                className={inputCls}
              >
                {ENDUSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Action</label>
              <select
                value={euForm.action}
                onChange={(e) => setEuForm({ ...euForm, action: e.target.value })}
                className={inputCls}
              >
                {ENDUSE_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={euForm.notes}
              onChange={(e) => setEuForm({ ...euForm, notes: e.target.value })}
              placeholder="Context, regulatory citation..."
              rows={3}
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={euForm.is_active}
              onChange={(e) => setEuForm({ ...euForm, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-lime-500"
            />
            Active (enforced at order gate)
          </label>
        </div>
      </Modal>
    </div>
  )
}
