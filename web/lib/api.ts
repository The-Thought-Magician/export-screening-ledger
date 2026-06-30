// All calls are relative to same origin → /api/proxy/<path> maps 1:1 to backend /api/v1/<path>.
// The proxy route resolves the session server-side and injects X-User-Id.

async function http(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data
}

const get = (p: string) => http(p)
const post = (p: string, body?: unknown) =>
  http(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = (p: string, body?: unknown) =>
  http(p, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
const del = (p: string) => http(p, { method: 'DELETE' })

const qs = (params: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  createWorkspace: (body: unknown) => post('workspaces', body),
  updateWorkspace: (id: string, body: unknown) => put(`workspaces/${id}`, body),
  deleteWorkspace: (id: string) => del(`workspaces/${id}`),

  // Members
  listMembers: (workspace_id: string) => get(`members${qs({ workspace_id })}`),
  addMember: (body: unknown) => post('members', body),
  updateMember: (id: string, body: unknown) => put(`members/${id}`, body),
  removeMember: (id: string) => del(`members/${id}`),

  // Invites
  listInvites: (workspace_id: string) => get(`invites${qs({ workspace_id })}`),
  createInvite: (body: unknown) => post('invites', body),
  acceptInvite: (body: unknown) => post('invites/accept', body),
  revokeInvite: (id: string) => del(`invites/${id}`),

  // Parties
  listParties: (workspace_id: string, opts?: { status?: string; q?: string }) =>
    get(`parties${qs({ workspace_id, status: opts?.status, q: opts?.q })}`),
  getParty: (id: string) => get(`parties/${id}`),
  createParty: (body: unknown) => post('parties', body),
  updateParty: (id: string, body: unknown) => put(`parties/${id}`, body),
  deleteParty: (id: string) => del(`parties/${id}`),
  importParties: (body: unknown) => post('parties/import', body),

  // Aliases
  listAliases: (party_id: string) => get(`aliases${qs({ party_id })}`),
  addAlias: (body: unknown) => post('aliases', body),
  deleteAlias: (id: string) => del(`aliases/${id}`),

  // Lists
  listLists: (workspace_id: string) => get(`lists${qs({ workspace_id })}`),
  getList: (id: string) => get(`lists/${id}`),
  createList: (body: unknown) => post('lists', body),
  updateList: (id: string, body: unknown) => put(`lists/${id}`, body),
  deleteList: (id: string) => del(`lists/${id}`),

  // List versions
  listListVersions: (list_id: string) => get(`list-versions${qs({ list_id })}`),
  getListVersion: (id: string) => get(`list-versions/${id}`),
  createListVersion: (body: unknown) => post('list-versions', body),
  activateListVersion: (id: string, body?: unknown) => post(`list-versions/${id}/activate`, body),
  diffListVersion: (id: string, other: string) => get(`list-versions/${id}/diff${qs({ other })}`),

  // List entries
  listListEntries: (list_version_id: string, opts?: { q?: string }) =>
    get(`list-entries${qs({ list_version_id, q: opts?.q })}`),
  getListEntry: (id: string) => get(`list-entries/${id}`),
  createListEntry: (body: unknown) => post('list-entries', body),
  deleteListEntry: (id: string) => del(`list-entries/${id}`),

  // Screenings
  listScreenings: (workspace_id: string, opts?: { party_id?: string }) =>
    get(`screenings${qs({ workspace_id, party_id: opts?.party_id })}`),
  getScreening: (id: string) => get(`screenings/${id}`),
  runScreening: (body: unknown) => post('screenings/run', body),
  runSegmentScreening: (body: unknown) => post('screenings/run-segment', body),

  // Matches
  listMatches: (workspace_id: string, opts?: { decision?: string; party_id?: string }) =>
    get(`matches${qs({ workspace_id, decision: opts?.decision, party_id: opts?.party_id })}`),
  getMatch: (id: string) => get(`matches/${id}`),
  adjudicateMatch: (id: string, body: unknown) => post(`matches/${id}/adjudicate`, body),
  getMatchQueue: (workspace_id: string) => get(`matches/queue${qs({ workspace_id })}`),

  // Re-screen
  listRescreenSchedules: (workspace_id: string) => get(`rescreen/schedules${qs({ workspace_id })}`),
  saveRescreenSchedule: (body: unknown) => post('rescreen/schedules', body),
  updateRescreenSchedule: (id: string, body: unknown) => put(`rescreen/schedules/${id}`, body),
  deleteRescreenSchedule: (id: string) => del(`rescreen/schedules/${id}`),
  getRescreenDue: (workspace_id: string) => get(`rescreen/due${qs({ workspace_id })}`),

  // Orders
  listOrders: (workspace_id: string, opts?: { gate_status?: string }) =>
    get(`orders${qs({ workspace_id, gate_status: opts?.gate_status })}`),
  getOrder: (id: string) => get(`orders/${id}`),
  createOrder: (body: unknown) => post('orders', body),
  updateOrder: (id: string, body: unknown) => put(`orders/${id}`, body),
  evaluateOrder: (id: string, body?: unknown) => post(`orders/${id}/evaluate`, body),
  overrideOrder: (id: string, body: unknown) => post(`orders/${id}/override`, body),
  deleteOrder: (id: string) => del(`orders/${id}`),

  // Embargoes
  listEmbargoes: (workspace_id: string) => get(`embargoes${qs({ workspace_id })}`),
  createEmbargo: (body: unknown) => post('embargoes', body),
  updateEmbargo: (id: string, body: unknown) => put(`embargoes/${id}`, body),
  deleteEmbargo: (id: string) => del(`embargoes/${id}`),

  // End uses
  listEndUses: (workspace_id: string) => get(`end-uses${qs({ workspace_id })}`),
  createEndUse: (body: unknown) => post('end-uses', body),
  updateEndUse: (id: string, body: unknown) => put(`end-uses/${id}`, body),
  deleteEndUse: (id: string) => del(`end-uses/${id}`),

  // Allowlist
  listAllowlist: (workspace_id: string) => get(`allowlist${qs({ workspace_id })}`),
  createAllowlistEntry: (body: unknown) => post('allowlist', body),
  deleteAllowlistEntry: (id: string) => del(`allowlist/${id}`),

  // Ledger
  listLedger: (workspace_id: string, opts?: { entity_type?: string; entity_id?: string; event_type?: string }) =>
    get(`ledger${qs({ workspace_id, entity_type: opts?.entity_type, entity_id: opts?.entity_id, event_type: opts?.event_type })}`),
  getLedgerEntry: (id: string) => get(`ledger/${id}`),
  verifyLedger: (workspace_id: string) => get(`ledger/verify${qs({ workspace_id })}`),

  // Exports
  listExports: (workspace_id: string) => get(`exports${qs({ workspace_id })}`),
  getExport: (id: string) => get(`exports/${id}`),
  createExport: (body: unknown) => post('exports', body),

  // Notifications
  listNotifications: (workspace_id: string) => get(`notifications${qs({ workspace_id })}`),
  markNotificationRead: (id: string) => post(`notifications/${id}/read`),
  markAllNotificationsRead: (workspace_id: string) => post(`notifications/read-all${qs({ workspace_id })}`),

  // Policies
  getPolicy: (workspace_id: string) => get(`policies${qs({ workspace_id })}`),
  savePolicy: (body: unknown) => post('policies', body),

  // Segments
  listSegments: (workspace_id: string) => get(`segments${qs({ workspace_id })}`),
  createSegment: (body: unknown) => post('segments', body),
  deleteSegment: (id: string) => del(`segments/${id}`),

  // Reports
  listReports: (workspace_id: string) => get(`reports${qs({ workspace_id })}`),
  generateReport: (workspace_id: string, type: string) => get(`reports/generate${qs({ workspace_id, type })}`),
  saveReport: (body: unknown) => post('reports', body),

  // Metrics
  getMetrics: (workspace_id: string) => get(`metrics${qs({ workspace_id })}`),
  getTrends: (workspace_id: string) => get(`metrics/trends${qs({ workspace_id })}`),

  // Seed
  seedDemo: (body?: unknown) => post('seed/demo', body),
  resetDemo: (workspace_id: string, body?: unknown) => post(`seed/reset${qs({ workspace_id })}`, body),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  createCheckout: (body?: unknown) => post('billing/checkout', body),
  createPortal: (body?: unknown) => post('billing/portal', body),
}

export default api
