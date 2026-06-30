import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { lists, list_versions, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
    .limit(1)
  return !!m
}

const sourceAuthorities = [
  'OFAC_SDN',
  'BIS_ENTITY',
  'BIS_DPL',
  'EU_CONSOLIDATED',
  'UN',
  'CUSTOM',
] as const

const listTypes = ['denied', 'restricted', 'custom'] as const

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  source_authority: z.enum(sourceAuthorities),
  list_type: z.enum(listTypes).optional().default('denied'),
  is_active: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  active_version_id: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  source_authority: z.enum(sourceAuthorities).optional(),
  list_type: z.enum(listTypes).optional(),
})

// ----------------------------------------------------------------------------
// GET / — public — lists for ?workspace_id
// ----------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(lists)
    .where(eq(lists.workspace_id, workspaceId))
    .orderBy(desc(lists.created_at))
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// GET /:id — public — list detail (+versions summary, active_version_id)
// ----------------------------------------------------------------------------
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [list] = await db.select().from(lists).where(eq(lists.id, id))
  if (!list) return c.json({ error: 'Not found' }, 404)

  const versions = await db
    .select({
      id: list_versions.id,
      version_label: list_versions.version_label,
      content_hash: list_versions.content_hash,
      entry_count: list_versions.entry_count,
      published_at: list_versions.published_at,
      created_by: list_versions.created_by,
      created_at: list_versions.created_at,
    })
    .from(list_versions)
    .where(eq(list_versions.list_id, id))
    .orderBy(desc(list_versions.created_at))

  const versionsSummary = versions.map((v) => ({
    ...v,
    is_active: v.id === list.active_version_id,
  }))

  return c.json({
    ...list,
    active_version_id: list.active_version_id,
    version_count: versions.length,
    versions: versionsSummary,
  })
})

// ----------------------------------------------------------------------------
// POST / — auth — create list
// ----------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [list] = await db
    .insert(lists)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      source_authority: body.source_authority,
      list_type: body.list_type,
      is_active: body.is_active,
      created_by: userId,
    })
    .returning()
  return c.json(list, 201)
})

// ----------------------------------------------------------------------------
// PUT /:id — auth — update list (name, active_version_id, is_active)
// ----------------------------------------------------------------------------
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(lists).where(eq(lists.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = c.req.valid('json')

  // If activating a version, validate it belongs to this list.
  if (body.active_version_id) {
    const [ver] = await db
      .select()
      .from(list_versions)
      .where(
        and(
          eq(list_versions.id, body.active_version_id),
          eq(list_versions.list_id, id),
        ),
      )
    if (!ver) return c.json({ error: 'active_version_id does not belong to this list' }, 400)
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.active_version_id !== undefined) patch.active_version_id = body.active_version_id
  if (body.is_active !== undefined) patch.is_active = body.is_active
  if (body.source_authority !== undefined) patch.source_authority = body.source_authority
  if (body.list_type !== undefined) patch.list_type = body.list_type

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db
    .update(lists)
    .set(patch)
    .where(eq(lists.id, id))
    .returning()
  return c.json(updated)
})

// ----------------------------------------------------------------------------
// DELETE /:id — auth — delete list
// ----------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(lists).where(eq(lists.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(lists).where(eq(lists.id, id))
  return c.json({ success: true })
})

export default router
