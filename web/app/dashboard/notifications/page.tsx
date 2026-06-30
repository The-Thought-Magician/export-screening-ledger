'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'

interface Notification {
  id: string
  workspace_id: string
  user_id: string
  kind: string
  title: string
  body?: string | null
  link?: string | null
  is_read: boolean
  created_at?: string
}

function fmtDate(d?: string) {
  if (!d) return '—'
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return d
  return t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function relative(d?: string) {
  if (!d) return ''
  const t = new Date(d).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(d)
}

function kindTone(kind: string) {
  const k = kind.toLowerCase()
  if (k.includes('block') || k.includes('alert') || k.includes('breach') || k.includes('fail')) return 'red' as const
  if (k.includes('match') || k.includes('escalat') || k.includes('rescreen') || k.includes('due') || k.includes('flag'))
    return 'amber' as const
  if (k.includes('export') || k.includes('report') || k.includes('ledger')) return 'blue' as const
  if (k.includes('clear') || k.includes('release') || k.includes('complete')) return 'green' as const
  return 'neutral' as const
}

function kindIcon(kind: string) {
  const t = kindTone(kind)
  if (t === 'red') return '⛔'
  if (t === 'amber') return '⚑'
  if (t === 'blue') return '🗎'
  if (t === 'green') return '✓'
  return '•'
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40'

export default function NotificationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [items, setItems] = useState<Notification[]>([])
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const data = await api.listNotifications(wsId)
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
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

  const kinds = useMemo(() => Array.from(new Set(items.map((i) => i.kind))).sort(), [items])
  const unreadCount = useMemo(() => items.filter((i) => !i.is_read).length, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => (tab === 'unread' ? !i.is_read : true))
      .filter((i) => (kindFilter === 'all' ? true : i.kind === kindFilter))
      .filter((i) =>
        !q
          ? true
          : i.title?.toLowerCase().includes(q) ||
            (i.body ?? '').toLowerCase().includes(q) ||
            i.kind?.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }, [items, tab, kindFilter, search])

  async function markRead(n: Notification) {
    if (!workspaceId || n.is_read) return
    setBusyId(n.id)
    // optimistic
    setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, is_read: true } : i)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark read')
      await load(workspaceId)
    } finally {
      setBusyId(null)
    }
  }

  async function markAll() {
    if (!workspaceId || unreadCount === 0) return
    setMarkingAll(true)
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })))
    try {
      await api.markAllNotificationsRead(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all read')
      await load(workspaceId)
    } finally {
      setMarkingAll(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading notifications..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Notifications</h1>
          <p className="text-sm text-zinc-500">
            Alerts for new matches, blocked orders, re-screen due dates and compliance events.
          </p>
        </div>
        <Button variant="secondary" onClick={markAll} disabled={markingAll || unreadCount === 0}>
          {markingAll ? <Spinner /> : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total" value={items.length} />
        <Stat label="Unread" value={unreadCount} tone={unreadCount ? 'amber' : 'default'} />
        <Stat label="Read" value={items.length - unreadCount} tone="green" />
        <Stat label="Kinds" value={kinds.length} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1">
            <button
              onClick={() => setTab('all')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === 'all' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              All ({items.length})
            </button>
            <button
              onClick={() => setTab('unread')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === 'unread' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications..."
              className={`${inputCls} sm:max-w-xs`}
            />
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={`${inputCls} sm:max-w-[12rem]`}>
              <option value="all">All kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={
                  items.length === 0
                    ? 'No notifications'
                    : tab === 'unread'
                      ? 'All caught up'
                      : 'No matching notifications'
                }
                description={
                  items.length === 0
                    ? 'Compliance alerts will appear here as screenings run and orders are gated.'
                    : tab === 'unread'
                      ? 'You have read every notification.'
                      : 'Try a different filter or search term.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((n) => {
                const tone = kindTone(n.kind)
                return (
                  <li
                    key={n.id}
                    className={`flex items-start gap-3 px-5 py-4 transition-colors hover:bg-zinc-900/50 ${
                      n.is_read ? 'opacity-70' : ''
                    }`}
                  >
                    <span className={`mt-0.5 text-lg ${n.is_read ? 'grayscale' : ''}`} aria-hidden>
                      {kindIcon(n.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="unread" />}
                        <span className={`text-sm ${n.is_read ? 'text-zinc-300' : 'font-semibold text-zinc-100'}`}>
                          {n.title}
                        </span>
                        <Badge tone={tone}>{n.kind}</Badge>
                      </div>
                      {n.body && <p className="mt-1 text-sm text-zinc-500">{n.body}</p>}
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-zinc-600">
                        <span title={fmtDate(n.created_at)}>{relative(n.created_at)}</span>
                        {n.link && (
                          <a href={n.link} className="text-amber-400 hover:text-amber-300">
                            Open →
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {!n.is_read && (
                        <Button variant="ghost" onClick={() => markRead(n)} disabled={busyId === n.id}>
                          {busyId === n.id ? <Spinner /> : 'Mark read'}
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
