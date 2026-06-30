import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  exports as exportsTable,
  parties,
  screenings,
  screening_matches,
  orders,
  order_parties,
  ledger_entries,
  lists,
  list_versions,
  allowlist_entries,
  embargoed_countries,
  end_use_rules,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { appendLedger } from '../lib/ledger.js'

const router = new Hono()

// Deterministic, order-stable serialization for hashing the manifest.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function manifestHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

// Public: list past exports for a workspace, newest first.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.workspace_id, workspaceId))
    .orderBy(desc(exportsTable.created_at))
  return c.json(rows)
})

// Public: export bundle detail (includes the full immutable payload + manifest).
router.get('/:id', async (c) => {
  const [row] = await db
    .select()
    .from(exportsTable)
    .where(eq(exportsTable.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

const createExportSchema = z.object({
  workspace_id: z.string().min(1),
  scope: z.enum(['full', 'filtered']).optional().default('full'),
  filters: z
    .object({
      party_status: z.string().optional(),
      match_decision: z.string().optional(),
      gate_status: z.string().optional(),
      event_type: z.string().optional(),
    })
    .optional()
    .default({}),
})

// Auth: generate an immutable audit export bundle.
// Snapshots the workspace's screening record (parties, lists/versions,
// screenings, matches, orders, embargoes, end-use rules, allowlist, ledger),
// computes a manifest_hash over the canonical bundle, persists it, and writes a
// tamper-evident 'export' ledger entry.
router.post('/', authMiddleware, zValidator('json', createExportSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, scope, filters } = c.req.valid('json')

  // --- Gather the snapshot --------------------------------------------------
  let partyRows = await db
    .select()
    .from(parties)
    .where(eq(parties.workspace_id, workspace_id))
    .orderBy(parties.created_at)
  if (scope === 'filtered' && filters.party_status) {
    partyRows = partyRows.filter((p) => p.status === filters.party_status)
  }

  const listRows = await db
    .select()
    .from(lists)
    .where(eq(lists.workspace_id, workspace_id))
    .orderBy(lists.created_at)

  const listIds = listRows.map((l) => l.id)
  const versionRows =
    listIds.length > 0
      ? await db.select().from(list_versions).where(inArray(list_versions.list_id, listIds))
      : []

  const screeningRows = await db
    .select()
    .from(screenings)
    .where(eq(screenings.workspace_id, workspace_id))
    .orderBy(screenings.created_at)

  // Matches are scoped to this workspace via its screening ids.
  const screeningIds = screeningRows.map((s) => s.id)
  let matchRows =
    screeningIds.length > 0
      ? await db
          .select()
          .from(screening_matches)
          .where(inArray(screening_matches.screening_id, screeningIds))
      : []
  if (scope === 'filtered' && filters.match_decision) {
    matchRows = matchRows.filter((m) => m.decision === filters.match_decision)
  }

  let orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.workspace_id, workspace_id))
    .orderBy(orders.created_at)
  if (scope === 'filtered' && filters.gate_status) {
    orderRows = orderRows.filter((o) => o.gate_status === filters.gate_status)
  }

  const orderIds = orderRows.map((o) => o.id)
  const orderPartyRows =
    orderIds.length > 0
      ? await db.select().from(order_parties).where(inArray(order_parties.order_id, orderIds))
      : []

  const embargoRows = await db
    .select()
    .from(embargoed_countries)
    .where(eq(embargoed_countries.workspace_id, workspace_id))

  const endUseRows = await db
    .select()
    .from(end_use_rules)
    .where(eq(end_use_rules.workspace_id, workspace_id))

  const allowlistRows = await db
    .select()
    .from(allowlist_entries)
    .where(eq(allowlist_entries.workspace_id, workspace_id))

  const ledgerConds = [eq(ledger_entries.workspace_id, workspace_id)]
  if (scope === 'filtered' && filters.event_type) {
    ledgerConds.push(eq(ledger_entries.event_type, filters.event_type))
  }
  const ledgerRows = await db
    .select()
    .from(ledger_entries)
    .where(and(...ledgerConds))
    .orderBy(ledger_entries.seq)

  // --- Assemble the bundle --------------------------------------------------
  const generatedAt = new Date().toISOString()
  const sections = {
    parties: partyRows,
    lists: listRows,
    list_versions: versionRows,
    screenings: screeningRows,
    matches: matchRows,
    orders: orderRows,
    order_parties: orderPartyRows,
    embargoes: embargoRows,
    end_use_rules: endUseRows,
    allowlist: allowlistRows,
    ledger: ledgerRows,
  }

  const counts = {
    parties: partyRows.length,
    lists: listRows.length,
    list_versions: versionRows.length,
    screenings: screeningRows.length,
    matches: matchRows.length,
    orders: orderRows.length,
    order_parties: orderPartyRows.length,
    embargoes: embargoRows.length,
    end_use_rules: endUseRows.length,
    allowlist: allowlistRows.length,
    ledger: ledgerRows.length,
  }

  const entry_count = Object.values(counts).reduce((a, b) => a + b, 0)

  const payload = {
    manifest: {
      workspace_id,
      scope,
      filters,
      generated_by: userId,
      generated_at: generatedAt,
      counts,
    },
    data: sections,
  }

  const manifest_hash = manifestHash(payload)

  const [row] = await db
    .insert(exportsTable)
    .values({
      workspace_id,
      scope,
      filters,
      manifest_hash,
      entry_count,
      payload,
      generated_by: userId,
    })
    .returning()

  // Tamper-evident record that an export was produced.
  await appendLedger({
    workspace_id,
    event_type: 'export',
    entity_type: 'export',
    entity_id: row.id,
    actor_id: userId,
    payload: { scope, manifest_hash, entry_count, counts },
  })

  return c.json(row, 201)
})

export default router
