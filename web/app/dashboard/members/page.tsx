'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'esl.workspace_id'

const ROLES = ['admin', 'reviewer', 'analyst', 'viewer'] as const
type Role = (typeof ROLES)[number]

const ROLE_TONE: Record<string, 'amber' | 'blue' | 'green' | 'zinc'> = {
  admin: 'amber',
  reviewer: 'blue',
  analyst: 'green',
  viewer: 'zinc',
}

const ROLE_HINT: Record<Role, string> = {
  admin: 'Full control: members, policy, overrides, deletion.',
  reviewer: 'Can adjudicate matches and manage allowlists.',
  analyst: 'Can create parties, run screenings, manage lists.',
  viewer: 'Read-only access to the ledger and registers.',
}

interface Member {
  id: string
  workspace_id: string
  user_id: string
  role: string
  created_at?: string
}

interface Invite {
  id: string
  workspace_id: string
  email: string
  role: string
  token: string
  status: string
  invited_by?: string
  created_at?: string
}

function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function MembersPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [tab, setTab] = useState<'members' | 'invites'>('members')
  const [query, setQuery] = useState('')

  // Add-member modal
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'analyst' as Role })
  const [savingMember, setSavingMember] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'analyst' as Role })
  const [savingInvite, setSavingInvite] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Accept-invite
  const [acceptToken, setAcceptToken] = useState('')
  const [accepting, setAccepting] = useState(false)

  const loadData = useCallback(async (wsId: string, soft = false) => {
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [m, inv] = await Promise.all([api.listMembers(wsId), api.listInvites(wsId)])
      setMembers(Array.isArray(m) ? m : [])
      setInvites(Array.isArray(inv) ? inv : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

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
        await loadData(wsId)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadData])

  const flash = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(null), 3000)
  }

  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of members) c[m.role] = (c[m.role] ?? 0) + 1
    return c
  }, [members])

  const pendingInvites = useMemo(
    () => invites.filter((i) => (i.status ?? 'pending').toLowerCase() === 'pending'),
    [invites],
  )

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => m.user_id.toLowerCase().includes(q) || m.role.toLowerCase().includes(q))
  }, [members, query])

  const filteredInvites = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return invites
    return invites.filter((i) => i.email.toLowerCase().includes(q) || i.role.toLowerCase().includes(q))
  }, [invites, query])

  const addMember = async () => {
    if (!workspaceId) return
    if (!memberForm.user_id.trim()) {
      setMemberError('User ID is required.')
      return
    }
    setSavingMember(true)
    setMemberError(null)
    try {
      await api.addMember({ workspace_id: workspaceId, user_id: memberForm.user_id.trim(), role: memberForm.role })
      setMemberOpen(false)
      setMemberForm({ user_id: '', role: 'analyst' })
      await loadData(workspaceId, true)
      flash('Member added.')
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to add member')
    } finally {
      setSavingMember(false)
    }
  }

  const changeRole = async (m: Member, role: string) => {
    if (!workspaceId || role === m.role) return
    setError(null)
    try {
      await api.updateMember(m.id, { role })
      setMembers((list) => list.map((x) => (x.id === m.id ? { ...x, role } : x)))
      flash('Role updated.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role')
      await loadData(workspaceId, true)
    }
  }

  const removeMember = async (m: Member) => {
    if (!workspaceId) return
    if (typeof window !== 'undefined' && !window.confirm(`Remove member ${m.user_id}?`)) return
    setError(null)
    try {
      await api.removeMember(m.id)
      setMembers((list) => list.filter((x) => x.id !== m.id))
      flash('Member removed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member')
    }
  }

  const createInvite = async () => {
    if (!workspaceId) return
    const email = inviteForm.email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteError('Enter a valid email address.')
      return
    }
    setSavingInvite(true)
    setInviteError(null)
    try {
      await api.createInvite({ workspace_id: workspaceId, email, role: inviteForm.role })
      setInviteOpen(false)
      setInviteForm({ email: '', role: 'analyst' })
      await loadData(workspaceId, true)
      setTab('invites')
      flash('Invite created.')
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Failed to create invite')
    } finally {
      setSavingInvite(false)
    }
  }

  const revokeInvite = async (inv: Invite) => {
    if (!workspaceId) return
    if (typeof window !== 'undefined' && !window.confirm(`Revoke invite for ${inv.email}?`)) return
    setError(null)
    try {
      await api.revokeInvite(inv.id)
      setInvites((list) => list.filter((x) => x.id !== inv.id))
      flash('Invite revoked.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke invite')
    }
  }

  const copyToken = async (token: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(token)
        flash('Invite token copied.')
      }
    } catch {
      /* clipboard unavailable */
    }
  }

  const acceptInvite = async () => {
    if (!workspaceId) return
    const token = acceptToken.trim()
    if (!token) return
    setAccepting(true)
    setError(null)
    try {
      await api.acceptInvite({ token })
      setAcceptToken('')
      await loadData(workspaceId, true)
      flash('Invite accepted; membership created.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to accept invite')
    } finally {
      setAccepting(false)
    }
  }

  if (loading) return <FullPageSpinner label="Loading members..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Members &amp; invites</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage who can access this workspace and what they can do. Admins can add members directly or invite by
            email.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshing && <Spinner />}
          <Button variant="secondary" onClick={() => setMemberOpen(true)}>
            Add member
          </Button>
          <Button onClick={() => setInviteOpen(true)}>Invite by email</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Members" value={members.length} />
        <Stat label="Admins" value={roleCounts.admin ?? 0} tone="amber" />
        <Stat label="Reviewers" value={roleCounts.reviewer ?? 0} />
        <Stat label="Pending invites" value={pendingInvites.length} tone={pendingInvites.length ? 'amber' : 'default'} />
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="text-sm font-medium text-zinc-300">Accept an invite</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={acceptToken}
              onChange={(e) => setAcceptToken(e.target.value)}
              placeholder="Paste invite token"
              className="min-w-[16rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
            <Button onClick={acceptInvite} disabled={accepting || !acceptToken.trim()}>
              {accepting ? <Spinner label="Accepting..." /> : 'Accept invite'}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Redeem a token sent to you to join this workspace with its assigned role.
          </p>
        </CardBody>
      </Card>

      <div className="flex items-center gap-2 border-b border-zinc-800">
        <button
          onClick={() => setTab('members')}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === 'members'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Members ({members.length})
        </button>
        <button
          onClick={() => setTab('invites')}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            tab === 'invites'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Invites ({invites.length})
        </button>
        <div className="ml-auto py-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="w-48 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
          />
        </div>
      </div>

      {tab === 'members' ? (
        members.length === 0 ? (
          <EmptyState
            icon={<span>👥</span>}
            title="No members yet"
            description="Add a teammate by user ID or invite them by email to collaborate on screening."
            action={<Button onClick={() => setMemberOpen(true)}>Add member</Button>}
          />
        ) : filteredMembers.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-zinc-500">No members match your search.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Role</TH>
                <TH>Joined</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filteredMembers.map((m) => (
                <TR key={m.id}>
                  <TD className="font-mono text-xs text-zinc-200">{m.user_id}</TD>
                  <TD>
                    <Badge tone={ROLE_TONE[m.role] ?? 'neutral'}>{m.role}</Badge>
                  </TD>
                  <TD className="text-zinc-500">{fmtDate(m.created_at)}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <select
                        value={m.role}
                        onChange={(e) => void changeRole(m, e.target.value)}
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <Button variant="danger" onClick={() => void removeMember(m)} className="px-3 py-1 text-xs">
                        Remove
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )
      ) : invites.length === 0 ? (
        <EmptyState
          icon={<span>✉️</span>}
          title="No invites"
          description="Invite teammates by email. They join with the role you assign when they redeem the token."
          action={<Button onClick={() => setInviteOpen(true)}>Invite by email</Button>}
        />
      ) : filteredInvites.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-zinc-500">No invites match your search.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              <TH>Token</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filteredInvites.map((inv) => {
              const status = (inv.status ?? 'pending').toLowerCase()
              return (
                <TR key={inv.id}>
                  <TD className="text-zinc-200">{inv.email}</TD>
                  <TD>
                    <Badge tone={ROLE_TONE[inv.role] ?? 'neutral'}>{inv.role}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={status === 'accepted' ? 'green' : status === 'revoked' ? 'red' : 'amber'}>
                      {status}
                    </Badge>
                  </TD>
                  <TD className="text-zinc-500">{fmtDate(inv.created_at)}</TD>
                  <TD>
                    <button
                      onClick={() => void copyToken(inv.token)}
                      className="font-mono text-xs text-amber-400 hover:text-amber-300"
                      title="Copy token"
                    >
                      {inv.token ? `${inv.token.slice(0, 10)}…` : '—'}
                    </button>
                  </TD>
                  <TD>
                    <div className="flex justify-end">
                      {status === 'pending' ? (
                        <Button variant="danger" onClick={() => void revokeInvite(inv)} className="px-3 py-1 text-xs">
                          Revoke
                        </Button>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      <Modal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        title="Add member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMemberOpen(false)} disabled={savingMember}>
              Cancel
            </Button>
            <Button onClick={addMember} disabled={savingMember}>
              {savingMember ? <Spinner label="Adding..." /> : 'Add member'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {memberError && <p className="text-sm text-red-400">{memberError}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">User ID</label>
            <input
              value={memberForm.user_id}
              onChange={(e) => setMemberForm((f) => ({ ...f, user_id: e.target.value }))}
              placeholder="auth user id"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Role</label>
            <select
              value={memberForm.role}
              onChange={(e) => setMemberForm((f) => ({ ...f, role: e.target.value as Role }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">{ROLE_HINT[memberForm.role]}</p>
          </div>
        </div>
      </Modal>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite by email"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={savingInvite}>
              Cancel
            </Button>
            <Button onClick={createInvite} disabled={savingInvite}>
              {savingInvite ? <Spinner label="Creating..." /> : 'Create invite'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Email</label>
            <input
              type="email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="teammate@company.com"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Role</label>
            <select
              value={inviteForm.role}
              onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as Role }))}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500">{ROLE_HINT[inviteForm.role]}</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
