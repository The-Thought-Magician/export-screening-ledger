import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, workspace_members, policies } from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes'),
})

const updateSchema = z.object({
  name: z.string().min(1),
})

// Helper: is the user an admin of the workspace?
async function isAdmin(workspaceId: string, userId: string): Promise<boolean> {
  if (!userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m && m.role === 'admin'
}

// GET / — auth — list workspaces the user is a member of
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const ids = memberships.map((m) => m.workspace_id)
  if (ids.length === 0) return c.json([])
  const rows = await db
    .select()
    .from(workspaces)
    .where(inArray(workspaces.id, ids))
    .orderBy(desc(workspaces.created_at))
  const roleByWs = new Map(memberships.map((m) => [m.workspace_id, m.role]))
  return c.json(rows.map((w) => ({ ...w, role: roleByWs.get(w.id) ?? null })))
})

// GET /:id — public — workspace detail
router.get('/:id', async (c) => {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, c.req.param('id')))
  if (!w) return c.json({ error: 'Not found' }, 404)
  return c.json(w)
})

// POST / — auth — create workspace (creator becomes admin member, seeds default policy)
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ensure slug is unique
  const [existingSlug] = await db.select().from(workspaces).where(eq(workspaces.slug, body.slug))
  if (existingSlug) return c.json({ error: 'Slug already in use' }, 409)

  const [ws] = await db
    .insert(workspaces)
    .values({ name: body.name, slug: body.slug, created_by: userId })
    .returning()

  // Creator becomes admin member
  await db.insert(workspace_members).values({
    workspace_id: ws.id,
    user_id: userId,
    role: 'admin',
  })

  // Seed a default active policy (version 1)
  await db.insert(policies).values({
    workspace_id: ws.id,
    version: 1,
    match_threshold: 0.85,
    auto_clear_floor: 0.5,
    weights: { name: 1, country: 0.5, address: 0.3 },
    four_eyes: false,
    default_cadence: 'weekly',
    is_active: true,
    created_by: userId,
  })

  return c.json(ws, 201)
})

// PUT /:id — auth+role(admin) — rename workspace
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isAdmin(id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ name: body.name })
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth+role(admin) — delete workspace
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isAdmin(id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(workspaces).where(eq(workspaces.id, id))
  return c.json({ success: true })
})

export default router
