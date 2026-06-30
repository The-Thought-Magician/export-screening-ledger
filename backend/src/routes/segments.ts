import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { segments, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Membership check: the caller must belong to the workspace.
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

// ---------------------------------------------------------------------------
// GET / — saved segments for ?workspace_id. Public read.
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(segments)
    .where(eq(segments.workspace_id, workspaceId))
    .orderBy(desc(segments.created_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — save a named party filter as a segment. Auth-gated.
// ---------------------------------------------------------------------------

const segmentSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  filters: z
    .object({
      status: z.string().optional(),
      party_type: z.string().optional(),
      country: z.string().optional(),
      tags: z.array(z.string()).optional(),
      q: z.string().optional(),
    })
    .passthrough()
    .optional()
    .default({}),
})

router.post('/', authMiddleware, zValidator('json', segmentSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [created] = await db
    .insert(segments)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      filters: body.filters as Record<string, unknown>,
      created_by: userId,
    })
    .returning()

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete a segment. Auth-gated, workspace-member check.
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(segments).where(eq(segments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(segments).where(eq(segments.id, id))
  return c.json({ success: true })
})

export default router
