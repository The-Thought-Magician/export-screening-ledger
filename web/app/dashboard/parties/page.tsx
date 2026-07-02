'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

const WS_KEY = 'esl.workspace_id'

interface Workspace {
  id: string
  name: string
}

interface Party {
  id: string
  name: string
  party_type?: string
  country?: string
  status?: string
  tags?: string[]
  last_screened_at?: string | null
  created_at?: string
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'unscreened', label: 'Unscreened' },
  { value: 'clear', label: 'Clear' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'needs_rescreen', label: 'Needs re-screen' },
]

// Minimal RFC-4180-ish CSV parser handling quoted fields and embedded commas/newlines.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((f) => f.trim() !== '')) rows.push(row)
  }
  return rows
}

interface ParsedImport {
  rows: Record<string, string>[]
  headers: string[]
}

function csvToRows(text: string): ParsedImport {
  const grid = parseCsv(text)
  if (!grid.length) return { rows: [], headers: [] }
  const headers = grid[0].map((h) => h.trim().toLowerCase())
  const rows = grid.slice(1).map((line) => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      obj[h] = (line[idx] ?? '').trim()
    })
    return obj
  })
  return { rows, headers }
}

export default function PartiesRegister() {
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [hasWorkspace, setHasWorkspace] = useState<boolean | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')

  const [deleting, setDeleting] = useState<Party | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<ParsedImport | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<{ created: number; errors: unknown[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (wsId: string, opts?: { status?: string; q?: string }) => {
    const rows: Party[] = (await api.listParties(wsId, opts)) ?? []
    setParties(rows)
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const ws: Workspace[] = (await api.listWorkspaces()) ?? []
      if (!ws.length) {
        setHasWorkspace(false)
        return
      }
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
      const chosen = ws.find((w) => w.id === stored)?.id ?? ws[0].id
      setWorkspaceId(chosen)
      if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, chosen)
      setHasWorkspace(true)
      await load(chosen)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load parties')
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    void init()
  }, [init])

  // Server-side filter on status + q; debounced via the query input form submit.
  const applyFilters = useCallback(
    async (nextStatus: string, nextQuery: string) => {
      if (!workspaceId) return
      setLoading(true)
      setError(null)
      try {
        await load(workspaceId, { status: nextStatus || undefined, q: nextQuery || undefined })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to filter parties')
      } finally {
        setLoading(false)
      }
    },
    [workspaceId, load]
  )

  useEffect(() => {
    if (!workspaceId) return
    const t = setTimeout(() => {
      void applyFilters(status, query)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query, workspaceId])

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteParty(deleting.id)
      setParties((prev) => prev.filter((p) => p.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete party')
    } finally {
      setDeleteBusy(false)
    }
  }

  const onFile = async (file: File) => {
    const text = await file.text()
    setImportResult(null)
    setImportPreview(csvToRows(text))
  }

  const runImport = async () => {
    if (!importPreview || !workspaceId) return
    setImportBusy(true)
    setError(null)
    try {
      const rows = importPreview.rows.map((r) => ({
        name: r.name,
        party_type: r.party_type || r.type || undefined,
        country: r.country || undefined,
        address: r.address || undefined,
        notes: r.notes || undefined,
        tags: r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : undefined,
      }))
      const res = await api.importParties({ workspace_id: workspaceId, rows })
      setImportResult({ created: res?.created ?? 0, errors: res?.errors ?? [] })
      await load(workspaceId, { status: status || undefined, q: query || undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImportBusy(false)
    }
  }

  const closeImport = () => {
    setImportOpen(false)
    setImportPreview(null)
    setImportResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of parties) c[p.status ?? 'unscreened'] = (c[p.status ?? 'unscreened'] ?? 0) + 1
    return c
  }, [parties])

  if (loading && hasWorkspace === null) return <FullPageSpinner label="Loading parties..." />

  if (hasWorkspace === false) {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Party register</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {parties.length} part{parties.length === 1 ? 'y' : 'ies'} in this workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Link href="/dashboard/parties/new">
            <Button>Add party</Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => {
              const active = status === f.value
              const n = f.value ? counts[f.value] : parties.length
              return (
                <button
                  key={f.value || 'all'}
                  onClick={() => setStatus(f.value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-lime-500/40 bg-lime-500/10 text-lime-400'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {f.label}
                  {f.value && typeof n === 'number' && n > 0 ? (
                    <span className="ml-1.5 text-zinc-500">{n}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, country, identifier..."
            className="w-full max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner label="Loading..." />
            </div>
          ) : parties.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<span>🔍</span>}
                title={query || status ? 'No matching parties' : 'No parties yet'}
                description={
                  query || status
                    ? 'Try clearing the filters or search term.'
                    : 'Add a party manually or import a CSV to start screening.'
                }
                action={
                  query || status ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery('')
                        setStatus('')
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Link href="/dashboard/parties/new">
                      <Button>Add party</Button>
                    </Link>
                  )
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH>Country</TH>
                  <TH>Status</TH>
                  <TH>Last screened</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {parties.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link
                        href={`/dashboard/parties/${p.id}`}
                        className="font-medium text-zinc-100 hover:text-lime-400"
                      >
                        {p.name}
                      </Link>
                      {p.tags && p.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.tags.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </TD>
                    <TD className="capitalize">{p.party_type ?? '—'}</TD>
                    <TD>{p.country ?? '—'}</TD>
                    <TD>
                      <Badge tone={statusTone(p.status)}>
                        {(p.status ?? 'unscreened').replace(/_/g, ' ')}
                      </Badge>
                    </TD>
                    <TD className="text-zinc-500">
                      {p.last_screened_at
                        ? new Date(p.last_screened_at).toLocaleDateString()
                        : 'Never'}
                    </TD>
                    <TD className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link href={`/dashboard/parties/${p.id}`}>
                          <Button variant="ghost" className="px-2 py-1 text-xs">
                            View
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                          onClick={() => setDeleting(p)}
                        >
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

      <Modal
        open={!!deleting}
        onClose={() => (deleteBusy ? null : setDeleting(null))}
        title="Delete party"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? <Spinner label="Deleting..." /> : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          Delete <span className="font-medium text-zinc-100">{deleting?.name}</span>? This removes the
          party and its aliases. Ledger entries are retained.
        </p>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => (importBusy ? null : closeImport())}
        title="Import parties from CSV"
        footer={
          importResult ? (
            <Button onClick={closeImport}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeImport} disabled={importBusy}>
                Cancel
              </Button>
              <Button
                onClick={runImport}
                disabled={importBusy || !importPreview || importPreview.rows.length === 0}
              >
                {importBusy ? (
                  <Spinner label="Importing..." />
                ) : (
                  `Import ${importPreview?.rows.length ?? 0} row${importPreview?.rows.length === 1 ? '' : 's'}`
                )}
              </Button>
            </>
          )
        }
      >
        {importResult ? (
          <div className="space-y-2 text-sm">
            <p className="text-emerald-400">
              Imported {importResult.created} part{importResult.created === 1 ? 'y' : 'ies'}.
            </p>
            {importResult.errors.length > 0 && (
              <div>
                <p className="text-lime-400">{importResult.errors.length} row(s) skipped:</p>
                <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-xs text-zinc-400">
                  {importResult.errors.map((er, i) => (
                    <li key={i}>{typeof er === 'string' ? er : JSON.stringify(er)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Upload a CSV with a header row. Recognized columns:{' '}
              <code className="text-lime-400">name</code> (required),{' '}
              <code className="text-lime-400">party_type</code>,{' '}
              <code className="text-lime-400">country</code>,{' '}
              <code className="text-lime-400">address</code>,{' '}
              <code className="text-lime-400">notes</code>,{' '}
              <code className="text-lime-400">tags</code> (semicolon-separated).
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
              className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-lime-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-950 hover:file:bg-lime-400"
            />
            {importPreview && (
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
                  Preview ({importPreview.rows.length} rows)
                </p>
                <div className="max-h-48 overflow-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-900/80 text-zinc-500">
                      <tr>
                        {importPreview.headers.map((h) => (
                          <th key={h} className="px-2 py-1 text-left font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {importPreview.rows.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          {importPreview.headers.map((h) => (
                            <td key={h} className="px-2 py-1 text-zinc-300">
                              {r[h]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {importPreview.rows.length > 0 && !importPreview.headers.includes('name') && (
                  <p className="mt-2 text-xs text-lime-400">
                    No "name" column detected — rows may be rejected.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
