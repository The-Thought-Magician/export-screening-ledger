import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { embargoed_countries, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const embargoSchema = z.object({
  workspace_id: z.string().min(1),
  country_code: z.string().min(2).max(8),
  country_name: z.string().min(1),
  embargo_type: z.enum(['comprehensive', 'targeted', 'arms']).optional().default('comprehensive'),
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

// Public: list embargoed countries for ?workspace_id
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(embargoed_countries)
    .where(eq(embargoed_countries.workspace_id, workspaceId))
    .orderBy(desc(embargoed_countries.created_at))
  return c.json(rows)
})

// Auth: add embargoed country
router.post('/', authMiddleware, zValidator('json', embargoSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await requireMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  // Enforce UNIQUE(workspace_id, country_code)
  const [dup] = await db
    .select()
    .from(embargoed_countries)
    .where(
      and(
        eq(embargoed_countries.workspace_id, body.workspace_id),
        eq(embargoed_countries.country_code, body.country_code),
      ),
    )
  if (dup) return c.json({ error: 'Country already embargoed in this workspace' }, 409)

  const [created] = await db
    .insert(embargoed_countries)
    .values({
      workspace_id: body.workspace_id,
      country_code: body.country_code,
      country_name: body.country_name,
      embargo_type: body.embargo_type,
      notes: body.notes,
      is_active: body.is_active,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: update embargo
router.put('/:id', authMiddleware, zValidator('json', embargoSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(embargoed_countries).where(eq(embargoed_countries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await requireMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const updates: Record<string, unknown> = {}
  if (body.country_code !== undefined) updates.country_code = body.country_code
  if (body.country_name !== undefined) updates.country_name = body.country_name
  if (body.embargo_type !== undefined) updates.embargo_type = body.embargo_type
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.is_active !== undefined) updates.is_active = body.is_active
  if (Object.keys(updates).length === 0) return c.json(existing)
  const [updated] = await db
    .update(embargoed_countries)
    .set(updates)
    .where(eq(embargoed_countries.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete embargo
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(embargoed_countries).where(eq(embargoed_countries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await requireMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(embargoed_countries).where(eq(embargoed_countries.id, id))
  return c.json({ success: true })
})

export default router
