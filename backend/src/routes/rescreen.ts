import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { rescreen_schedules, parties, workspace_members } from '../db/schema.js'
import { eq, and, desc, isNull } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { nextFirings, describeExpression, type ScheduleKind } from '../lib/cron.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Map a coarse cadence onto a cron expression so we can lean on the deterministic
// cron engine (nextFirings / describeExpression) for due-date math and labels.
const CADENCE_CRON: Record<string, string> = {
  daily: '0 6 * * *',
  weekly: '0 6 * * 1',
  monthly: '0 6 1 * *',
  quarterly: '0 6 1 1,4,7,10 *',
}

function cadenceToCron(cadence: string): string {
  return CADENCE_CRON[cadence] ?? CADENCE_CRON.weekly
}

// Compute the next due instant for a schedule given a cadence and an anchor.
function computeNextDue(cadence: string, fromISO: string): string | null {
  const expr = cadenceToCron(cadence)
  const [next] = nextFirings('cron' as ScheduleKind, expr, 'UTC', fromISO, 1)
  return next ?? null
}

// ----------------------------------------------------------------------------
// GET /schedules — schedules for ?workspace_id
// ----------------------------------------------------------------------------

router.get('/schedules', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select({
      schedule: rescreen_schedules,
      party_name: parties.name,
    })
    .from(rescreen_schedules)
    .leftJoin(parties, eq(rescreen_schedules.party_id, parties.id))
    .where(eq(rescreen_schedules.workspace_id, workspaceId))
    .orderBy(desc(rescreen_schedules.created_at))

  return c.json(
    rows.map((r) => ({
      ...r.schedule,
      party_name: r.party_name ?? null,
      cadence_label: describeExpression('cron' as ScheduleKind, cadenceToCron(r.schedule.cadence), 'UTC'),
    })),
  )
})

// ----------------------------------------------------------------------------
// POST /schedules — create or update a schedule (workspace default or per-party)
// ----------------------------------------------------------------------------

const scheduleSchema = z.object({
  workspace_id: z.string().min(1),
  party_id: z.string().min(1).nullable().optional(),
  cadence: z.enum(['daily', 'weekly', 'monthly', 'quarterly']),
  on_change: z.boolean().optional().default(true),
  on_new_version: z.boolean().optional().default(true),
})

router.post('/schedules', authMiddleware, zValidator('json', scheduleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const partyId = body.party_id ?? null
  if (partyId) {
    const [party] = await db.select().from(parties).where(eq(parties.id, partyId))
    if (!party || party.workspace_id !== body.workspace_id) {
      return c.json({ error: 'Party not found in workspace' }, 404)
    }
  }

  const nextDue = computeNextDue(body.cadence, new Date().toISOString())

  // One schedule per (workspace, party) slot — party_id null = workspace default.
  const existing = await db
    .select()
    .from(rescreen_schedules)
    .where(
      and(
        eq(rescreen_schedules.workspace_id, body.workspace_id),
        partyId ? eq(rescreen_schedules.party_id, partyId) : isNull(rescreen_schedules.party_id),
      ),
    )

  if (existing.length > 0) {
    const [updated] = await db
      .update(rescreen_schedules)
      .set({
        cadence: body.cadence,
        on_change: body.on_change,
        on_new_version: body.on_new_version,
        next_due_at: nextDue ? new Date(nextDue) : null,
      })
      .where(eq(rescreen_schedules.id, existing[0].id))
      .returning()
    return c.json(updated)
  }

  const [created] = await db
    .insert(rescreen_schedules)
    .values({
      workspace_id: body.workspace_id,
      party_id: partyId,
      cadence: body.cadence,
      on_change: body.on_change,
      on_new_version: body.on_new_version,
      next_due_at: nextDue ? new Date(nextDue) : null,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// ----------------------------------------------------------------------------
// PUT /schedules/:id — update cadence/flags
// ----------------------------------------------------------------------------

const updateScheduleSchema = z.object({
  cadence: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional(),
  on_change: z.boolean().optional(),
  on_new_version: z.boolean().optional(),
})

router.put('/schedules/:id', authMiddleware, zValidator('json', updateScheduleSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(rescreen_schedules).where(eq(rescreen_schedules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const cadence = body.cadence ?? existing.cadence
  const patch: Record<string, unknown> = {}
  if (body.cadence !== undefined) {
    patch.cadence = body.cadence
    const nextDue = computeNextDue(cadence, new Date().toISOString())
    patch.next_due_at = nextDue ? new Date(nextDue) : null
  }
  if (body.on_change !== undefined) patch.on_change = body.on_change
  if (body.on_new_version !== undefined) patch.on_new_version = body.on_new_version

  const [updated] = await db
    .update(rescreen_schedules)
    .set(patch)
    .where(eq(rescreen_schedules.id, id))
    .returning()
  return c.json(updated)
})

// ----------------------------------------------------------------------------
// DELETE /schedules/:id — delete schedule
// ----------------------------------------------------------------------------

router.delete('/schedules/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rescreen_schedules).where(eq(rescreen_schedules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(rescreen_schedules).where(eq(rescreen_schedules.id, id))
  return c.json({ success: true })
})

// ----------------------------------------------------------------------------
// GET /due — parties due/overdue for re-screen for ?workspace_id
//
// A party is due when:
//   - it carries status 'needs_rescreen', OR
//   - a per-party schedule's next_due_at is in the past, OR
//   - the workspace-default schedule's next_due_at is in the past and the party
//     has no per-party schedule, OR
//   - the party has never been screened (last_screened_at null).
// ----------------------------------------------------------------------------

router.get('/due', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const now = Date.now()

  const allParties = await db
    .select()
    .from(parties)
    .where(eq(parties.workspace_id, workspaceId))

  const schedules = await db
    .select()
    .from(rescreen_schedules)
    .where(eq(rescreen_schedules.workspace_id, workspaceId))

  const perParty = new Map<string, typeof schedules[number]>()
  let workspaceDefault: typeof schedules[number] | undefined
  for (const s of schedules) {
    if (s.party_id) perParty.set(s.party_id, s)
    else workspaceDefault = s
  }

  const due = allParties
    .map((p) => {
      const sched = perParty.get(p.id) ?? workspaceDefault
      const nextDueMs = sched?.next_due_at ? new Date(sched.next_due_at).getTime() : null
      const reasons: string[] = []
      if (p.status === 'needs_rescreen') reasons.push('flagged_needs_rescreen')
      if (!p.last_screened_at) reasons.push('never_screened')
      if (nextDueMs !== null && nextDueMs <= now) reasons.push('cadence_overdue')
      const overdue = nextDueMs !== null && nextDueMs <= now
      return {
        ...p,
        due_reasons: reasons,
        next_due_at: sched?.next_due_at ?? null,
        cadence: sched?.cadence ?? null,
        overdue,
        is_due: reasons.length > 0,
      }
    })
    .filter((p) => p.is_due)
    .sort((a, b) => {
      // Overdue first, then never-screened, then by next_due_at ascending.
      const am = a.next_due_at ? new Date(a.next_due_at).getTime() : 0
      const bm = b.next_due_at ? new Date(b.next_due_at).getTime() : 0
      return am - bm
    })

  return c.json(due)
})

export default router
