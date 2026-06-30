import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { end_use_rules, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ruleSchema = z.object({
  workspace_id: z.string().min(1),
  label: z.string().min(1),
  keyword: z.string().min(1),
  category: z.enum(['prohibited', 'restricted', 'watch']).optional().default('prohibited'),
  action: z.enum(['block', 'flag']).optional().default('block'),
  notes: z.string().optional(),
  is_active: z.boolean().optional().default(true),
})

async function requireMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Public: list end-use rules for ?workspace_id
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(end_use_rules)
    .where(eq(end_use_rules.workspace_id, workspaceId))
    .orderBy(desc(end_use_rules.created_at))
  return c.json(rows)
})

// Auth: add end-use rule
router.post('/', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await requireMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [created] = await db
    .insert(end_use_rules)
    .values({
      workspace_id: body.workspace_id,
      label: body.label,
      keyword: body.keyword,
      category: body.category,
      action: body.action,
      notes: body.notes,
      is_active: body.is_active,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: update rule
router.put('/:id', authMiddleware, zValidator('json', ruleSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(end_use_rules).where(eq(end_use_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await requireMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const updates: Record<string, unknown> = {}
  if (body.label !== undefined) updates.label = body.label
  if (body.keyword !== undefined) updates.keyword = body.keyword
  if (body.category !== undefined) updates.category = body.category
  if (body.action !== undefined) updates.action = body.action
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.is_active !== undefined) updates.is_active = body.is_active
  if (Object.keys(updates).length === 0) return c.json(existing)
  const [updated] = await db
    .update(end_use_rules)
    .set(updates)
    .where(eq(end_use_rules.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete rule
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(end_use_rules).where(eq(end_use_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await requireMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(end_use_rules).where(eq(end_use_rules.id, id))
  return c.json({ success: true })
})

export default router
