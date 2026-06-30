import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { allowlist_entries, ledger_entries, parties, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const REVIEWER_ROLES = ['reviewer', 'admin']

const allowlistSchema = z.object({
  workspace_id: z.string().min(1),
  party_id: z.string().min(1),
  list_entry_id: z.string().min(1).optional().nullable(),
  reason: z.string().min(1),
  expires_at: z.string().datetime().optional().nullable(),
})

async function getMembership(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return m ?? null
}

// Append an entry to the immutable hash-chained ledger for a workspace.
// Computes the next seq, links prev_hash, and derives hash deterministically.
async function appendLedger(params: {
  workspaceId: string
  eventType: string
  entityType: string
  entityId: string
  actorId: string
  payload: Record<string, unknown>
}) {
  const [prev] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, params.workspaceId))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)

  const seq = (prev?.seq ?? 0) + 1
  const prevHash = prev?.hash ?? null
  const createdAt = new Date()
  const canonical = JSON.stringify({
    workspace_id: params.workspaceId,
    seq,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    actor_id: params.actorId,
    payload: params.payload,
    prev_hash: prevHash,
    created_at: createdAt.toISOString(),
  })
  const hash = createHash('sha256').update(canonical).digest('hex')

  const [entry] = await db
    .insert(ledger_entries)
    .values({
      workspace_id: params.workspaceId,
      seq,
      event_type: params.eventType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      actor_id: params.actorId,
      payload: params.payload,
      prev_hash: prevHash,
      hash,
      created_at: createdAt,
    })
    .returning()
  return entry
}

// Public: list allowlist entries for ?workspace_id
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(allowlist_entries)
    .where(eq(allowlist_entries.workspace_id, workspaceId))
    .orderBy(desc(allowlist_entries.created_at))
  return c.json(rows)
})

// Auth + reviewer/admin: suppress a known false positive (writes ledger)
router.post('/', authMiddleware, zValidator('json', allowlistSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const membership = await getMembership(body.workspace_id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  if (!REVIEWER_ROLES.includes(membership.role)) {
    return c.json({ error: 'Reviewer role required' }, 403)
  }

  // Party must belong to the same workspace.
  const [party] = await db.select().from(parties).where(eq(parties.id, body.party_id))
  if (!party) return c.json({ error: 'Party not found' }, 404)
  if (party.workspace_id !== body.workspace_id) {
    return c.json({ error: 'Party does not belong to this workspace' }, 403)
  }

  const expiresAt = body.expires_at ? new Date(body.expires_at) : null

  const [created] = await db
    .insert(allowlist_entries)
    .values({
      workspace_id: body.workspace_id,
      party_id: body.party_id,
      list_entry_id: body.list_entry_id ?? null,
      reason: body.reason,
      expires_at: expiresAt,
      created_by: userId,
    })
    .returning()

  await appendLedger({
    workspaceId: body.workspace_id,
    eventType: 'adjudication',
    entityType: 'allowlist_entry',
    entityId: created.id,
    actorId: userId,
    payload: {
      action: 'suppress_false_positive',
      party_id: body.party_id,
      list_entry_id: body.list_entry_id ?? null,
      reason: body.reason,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    },
  })

  return c.json(created, 201)
})

// Auth + reviewer/admin: remove suppression
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(allowlist_entries).where(eq(allowlist_entries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const membership = await getMembership(existing.workspace_id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  if (!REVIEWER_ROLES.includes(membership.role)) {
    return c.json({ error: 'Reviewer role required' }, 403)
  }

  await db.delete(allowlist_entries).where(eq(allowlist_entries.id, id))

  await appendLedger({
    workspaceId: existing.workspace_id,
    eventType: 'adjudication',
    entityType: 'allowlist_entry',
    entityId: existing.id,
    actorId: userId,
    payload: {
      action: 'remove_suppression',
      party_id: existing.party_id,
      list_entry_id: existing.list_entry_id,
      reason: existing.reason,
    },
  })

  return c.json({ success: true })
})

export default router
