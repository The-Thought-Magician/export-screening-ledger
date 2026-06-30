'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

const WS_KEY = 'esl.workspace_id'

interface Workspace {
  id: string
  name: string
}

const PARTY_TYPES = ['organization', 'individual', 'vessel', 'aircraft', 'other']

interface IdentifierRow {
  key: string
  value: string
}

export default function NewParty() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [name, setName] = useState('')
  const [partyType, setPartyType] = useState('organization')
  const [country, setCountry] = useState('')
  const [address, setAddress] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [notes, setNotes] = useState('')
  const [identifiers, setIdentifiers] = useState<IdentifierRow[]>([{ key: '', value: '' }])

  const init = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const ws: Workspace[] = (await api.listWorkspaces()) ?? []
      setWorkspaces(ws)
      if (ws.length) {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
        setWorkspaceId(ws.find((w) => w.id === stored)?.id ?? ws[0].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void init()
  }, [init])

  const setIdentifier = (idx: number, field: 'key' | 'value', val: string) => {
    setIdentifiers((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: val } : row)))
  }
  const addIdentifier = () => setIdentifiers((prev) => [...prev, { key: '', value: '' }])
  const removeIdentifier = (idx: number) =>
    setIdentifiers((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) {
      setError('No workspace selected.')
      return
    }
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const idObj: Record<string, string> = {}
      for (const row of identifiers) {
        if (row.key.trim() && row.value.trim()) idObj[row.key.trim()] = row.value.trim()
      }
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const party = await api.createParty({
        workspace_id: workspaceId,
        name: name.trim(),
        party_type: partyType,
        country: country.trim() || undefined,
        address: address.trim() || undefined,
        identifiers: Object.keys(idObj).length ? idObj : undefined,
        tags: tags.length ? tags : undefined,
        notes: notes.trim() || undefined,
      })
      if (party?.id) {
        router.push(`/dashboard/parties/${party.id}`)
      } else {
        router.push('/dashboard/parties')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create party')
      setSubmitting(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading..." />

  if (workspaces.length === 0) {
    return (
      <EmptyState
        icon={<span>🗂️</span>}
        title="No workspace yet"
        description="Create or seed a workspace from the Overview before adding parties."
        action={
          <Link href="/dashboard">
            <Button>Go to overview</Button>
          </Link>
        }
      />
    )
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40'
  const labelCls = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/parties" className="text-xs text-zinc-500 hover:text-amber-400">
            ← Back to register
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-100">New party</h1>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Party details</h2>
          </CardHeader>
          <CardBody className="space-y-5">
            {workspaces.length > 1 && (
              <div>
                <label className={labelCls}>Workspace</label>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className={inputCls}
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className={labelCls}>Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Legal or registered name"
                className={inputCls}
                required
                autoFocus
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Type</label>
                <select
                  value={partyType}
                  onChange={(e) => setPartyType(e.target.value)}
                  className={`${inputCls} capitalize`}
                >
                  {PARTY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Country</label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. DE, China, Iran"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={2}
                placeholder="Street, city, region"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Tags (comma-separated)</label>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="distributor, high-risk, eu"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Identifiers</label>
              <div className="space-y-2">
                {identifiers.map((row, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      value={row.key}
                      onChange={(e) => setIdentifier(idx, 'key', e.target.value)}
                      placeholder="Key (e.g. duns, tax_id)"
                      className={`${inputCls} flex-1`}
                    />
                    <input
                      value={row.value}
                      onChange={(e) => setIdentifier(idx, 'value', e.target.value)}
                      placeholder="Value"
                      className={`${inputCls} flex-1`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3 text-zinc-500 hover:text-red-400"
                      onClick={() => removeIdentifier(idx)}
                      disabled={identifiers.length === 1}
                      aria-label="Remove identifier"
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={addIdentifier}>
                  + Add identifier
                </Button>
              </div>
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Internal context, sourcing, risk rationale"
                className={inputCls}
              />
            </div>
          </CardBody>
        </Card>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Link href="/dashboard/parties">
            <Button type="button" variant="secondary" disabled={submitting}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Spinner label="Creating..." /> : 'Create party'}
          </Button>
        </div>
      </form>
    </div>
  )
}
