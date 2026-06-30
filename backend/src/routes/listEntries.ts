import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { list_entries, list_versions } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const entrySchema = z.object({
  list_version_id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).optional().default([]),
  entity_type: z.string().optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  program_codes: z.array(z.string()).optional().default([]),
  remarks: z.string().optional(),
  source_ref: z.string().optional(),
})

// GET / — public — entries for ?list_version_id (filter ?q)
router.get('/', async (c) => {
  const versionId = c.req.query('list_version_id')
  if (!versionId) return c.json({ error: 'list_version_id is required' }, 400)
  const q = c.req.query('q')?.trim().toLowerCase()

  const rows = await db
    .select()
    .from(list_entries)
    .where(eq(list_entries.list_version_id, versionId))
    .orderBy(desc(list_entries.created_at))

  if (!q) return c.json(rows)
  const filtered = rows.filter((e) => {
    if (e.name.toLowerCase().includes(q)) return true
    if ((e.aliases ?? []).some((a) => a.toLowerCase().includes(q))) return true
    if ((e.country ?? '').toLowerCase().includes(q)) return true
    return false
  })
  return c.json(filtered)
})

// GET /:id — public — entry detail
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [entry] = await db.select().from(list_entries).where(eq(list_entries.id, id))
  if (!entry) return c.json({ error: 'Not found' }, 404)
  return c.json(entry)
})

// POST / — auth — add entry to a version (bumps version entry_count)
router.post('/', authMiddleware, zValidator('json', entrySchema), async (c) => {
  getUserId(c)
  const body = c.req.valid('json')

  const [version] = await db
    .select()
    .from(list_versions)
    .where(eq(list_versions.id, body.list_version_id))
  if (!version) return c.json({ error: 'List version not found' }, 404)

  const [entry] = await db
    .insert(list_entries)
    .values({
      list_version_id: body.list_version_id,
      name: body.name,
      aliases: body.aliases ?? [],
      entity_type: body.entity_type,
      country: body.country,
      address: body.address,
      program_codes: body.program_codes ?? [],
      remarks: body.remarks,
      source_ref: body.source_ref,
    })
    .returning()

  await db
    .update(list_versions)
    .set({ entry_count: sql`${list_versions.entry_count} + 1` })
    .where(eq(list_versions.id, body.list_version_id))

  return c.json(entry, 201)
})

// DELETE /:id — auth — delete entry (decrements version entry_count)
router.delete('/:id', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [entry] = await db.select().from(list_entries).where(eq(list_entries.id, id))
  if (!entry) return c.json({ error: 'Not found' }, 404)

  await db.delete(list_entries).where(eq(list_entries.id, id))
  await db
    .update(list_versions)
    .set({ entry_count: sql`GREATEST(${list_versions.entry_count} - 1, 0)` })
    .where(eq(list_versions.id, entry.list_version_id))

  return c.json({ success: true })
})

export default router
