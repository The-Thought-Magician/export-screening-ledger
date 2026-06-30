import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { eq, and, desc, max } from 'drizzle-orm'
import { db } from '../db/index.js'
import { policies, ledger_entries, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Require the caller to be an admin member of the workspace.
async function requireAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member && member.role === 'admin'
}

// Append a tamper-evident entry to the hash chain for a workspace.
// Computes the next seq, links prev_hash, and hashes the canonical payload.
async function appendLedger(params: {
  workspaceId: string
  eventType: string
  entityType: string
  entityId: string
  actorId: string
  payload: Record<string, unknown>
}): Promise<void> {
  const [{ value: lastSeq } = { value: null }] = await db
    .select({ value: max(ledger_entries.seq) })
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, params.workspaceId))

  const [prev] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, params.workspaceId))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)

  const seq = (lastSeq ?? 0) + 1
  const prevHash = prev?.hash ?? null
  const canonical = JSON.stringify({
    workspace_id: params.workspaceId,
    seq,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    actor_id: params.actorId,
    payload: params.payload,
    prev_hash: prevHash,
  })
  const hash = createHash('sha256').update(canonical).digest('hex')

  await db.insert(ledger_entries).values({
    workspace_id: params.workspaceId,
    seq,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    actor_id: params.actorId,
    payload: params.payload,
    prev_hash: prevHash,
    hash,
  })
}

// ---------------------------------------------------------------------------
// GET / — active policy for ?workspace_id (+ version history). Public read.
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const history = await db
    .select()
    .from(policies)
    .where(eq(policies.workspace_id, workspaceId))
    .orderBy(desc(policies.version))

  const active = history.find((p) => p.is_active) ?? history[0] ?? null

  return c.json({ active, history })
})

// ---------------------------------------------------------------------------
// POST / — save a new policy version (admin). Deactivates prior versions,
// bumps the version number, and writes a policy_change ledger entry.
// ---------------------------------------------------------------------------

const policySchema = z.object({
  workspace_id: z.string().min(1),
  match_threshold: z.number().min(0).max(1).optional().default(0.85),
  auto_clear_floor: z.number().min(0).max(1).optional().default(0.5),
  weights: z.record(z.string(), z.number()).optional().default({}),
  four_eyes: z.boolean().optional().default(false),
  default_cadence: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional().default('weekly'),
})

router.post('/', authMiddleware, zValidator('json', policySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await requireAdmin(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (body.auto_clear_floor > body.match_threshold) {
    return c.json({ error: 'auto_clear_floor must be <= match_threshold' }, 400)
  }

  // Determine next version number.
  const [{ value: lastVersion } = { value: null }] = await db
    .select({ value: max(policies.version) })
    .from(policies)
    .where(eq(policies.workspace_id, body.workspace_id))
  const version = (lastVersion ?? 0) + 1

  // Deactivate previous active versions.
  await db
    .update(policies)
    .set({ is_active: false })
    .where(eq(policies.workspace_id, body.workspace_id))

  const [created] = await db
    .insert(policies)
    .values({
      workspace_id: body.workspace_id,
      version,
      match_threshold: body.match_threshold,
      auto_clear_floor: body.auto_clear_floor,
      weights: body.weights,
      four_eyes: body.four_eyes,
      default_cadence: body.default_cadence,
      is_active: true,
      created_by: userId,
    })
    .returning()

  await appendLedger({
    workspaceId: body.workspace_id,
    eventType: 'policy_change',
    entityType: 'policy',
    entityId: created.id,
    actorId: userId,
    payload: {
      version,
      match_threshold: body.match_threshold,
      auto_clear_floor: body.auto_clear_floor,
      weights: body.weights,
      four_eyes: body.four_eyes,
      default_cadence: body.default_cadence,
    },
  })

  return c.json(created, 201)
})

export default router
