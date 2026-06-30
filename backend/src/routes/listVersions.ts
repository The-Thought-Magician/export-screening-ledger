import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  lists,
  list_versions,
  list_entries,
  parties,
  screening_matches,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { appendLedger } from '../lib/ledger.js'

const router = new Hono()

const entryInputSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional().default([]),
  entity_type: z.string().optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  program_codes: z.array(z.string()).optional().default([]),
  remarks: z.string().optional(),
  source_ref: z.string().optional(),
})

const createVersionSchema = z.object({
  list_id: z.string().min(1),
  version_label: z.string().min(1),
  entries: z.array(entryInputSchema).optional().default([]),
})

// Canonical content hash over the version's entries (order-independent).
function hashEntries(entries: Array<z.infer<typeof entryInputSchema>>): string {
  const canonical = entries
    .map((e) => ({
      name: (e.name || '').trim().toLowerCase(),
      aliases: (e.aliases ?? []).map((a) => a.trim().toLowerCase()).sort(),
      entity_type: e.entity_type ?? null,
      country: e.country ?? null,
      address: e.address ?? null,
      program_codes: (e.program_codes ?? []).slice().sort(),
      remarks: e.remarks ?? null,
      source_ref: e.source_ref ?? null,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

// GET / — public — versions for ?list_id
router.get('/', async (c) => {
  const listId = c.req.query('list_id')
  if (!listId) return c.json({ error: 'list_id is required' }, 400)
  const rows = await db
    .select()
    .from(list_versions)
    .where(eq(list_versions.list_id, listId))
    .orderBy(desc(list_versions.created_at))
  return c.json(rows)
})

// GET /:id — public — version detail (+entry count)
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [version] = await db.select().from(list_versions).where(eq(list_versions.id, id))
  if (!version) return c.json({ error: 'Not found' }, 404)
  const entries = await db
    .select()
    .from(list_entries)
    .where(eq(list_entries.list_version_id, id))
  return c.json({ ...version, entry_count: entries.length, entries })
})

// GET /:id/diff — public — diff vs ?other version (added/removed/changed)
router.get('/:id/diff', async (c) => {
  const id = c.req.param('id')
  const other = c.req.query('other')
  if (!other) return c.json({ error: 'other is required' }, 400)

  const [base] = await db.select().from(list_versions).where(eq(list_versions.id, id))
  const [otherVersion] = await db.select().from(list_versions).where(eq(list_versions.id, other))
  if (!base || !otherVersion) return c.json({ error: 'Version not found' }, 404)

  const baseEntries = await db
    .select()
    .from(list_entries)
    .where(eq(list_entries.list_version_id, id))
  const otherEntries = await db
    .select()
    .from(list_entries)
    .where(eq(list_entries.list_version_id, other))

  const key = (e: { name: string }) => e.name.trim().toLowerCase()
  const otherMap = new Map(otherEntries.map((e) => [key(e), e]))
  const baseMap = new Map(baseEntries.map((e) => [key(e), e]))

  const added: typeof baseEntries = []
  const changed: Array<{ name: string; from: unknown; to: unknown }> = []
  for (const e of baseEntries) {
    const prior = otherMap.get(key(e))
    if (!prior) {
      added.push(e)
    } else {
      const a = JSON.stringify({
        aliases: (e.aliases ?? []).slice().sort(),
        country: e.country,
        address: e.address,
        program_codes: (e.program_codes ?? []).slice().sort(),
        remarks: e.remarks,
        entity_type: e.entity_type,
      })
      const b = JSON.stringify({
        aliases: (prior.aliases ?? []).slice().sort(),
        country: prior.country,
        address: prior.address,
        program_codes: (prior.program_codes ?? []).slice().sort(),
        remarks: prior.remarks,
        entity_type: prior.entity_type,
      })
      if (a !== b) changed.push({ name: e.name, from: prior, to: e })
    }
  }
  const removed = otherEntries.filter((e) => !baseMap.has(key(e)))

  return c.json({ added, removed, changed })
})

// POST / — auth — create version from entries[] (computes content_hash, writes ledger)
router.post('/', authMiddleware, zValidator('json', createVersionSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [list] = await db.select().from(lists).where(eq(lists.id, body.list_id))
  if (!list) return c.json({ error: 'List not found' }, 404)

  const content_hash = hashEntries(body.entries)

  const [version] = await db
    .insert(list_versions)
    .values({
      list_id: body.list_id,
      version_label: body.version_label,
      content_hash,
      entry_count: body.entries.length,
      created_by: userId,
    })
    .returning()

  if (body.entries.length > 0) {
    await db.insert(list_entries).values(
      body.entries.map((e) => ({
        list_version_id: version.id,
        name: e.name,
        aliases: e.aliases ?? [],
        entity_type: e.entity_type,
        country: e.country,
        address: e.address,
        program_codes: e.program_codes ?? [],
        remarks: e.remarks,
        source_ref: e.source_ref,
      })),
    )
  }

  await appendLedger({
    workspace_id: list.workspace_id,
    event_type: 'list_activation',
    entity_type: 'list_version',
    entity_id: version.id,
    actor_id: userId,
    payload: {
      action: 'version_created',
      list_id: list.id,
      version_label: version.version_label,
      content_hash,
      entry_count: body.entries.length,
    },
  })

  return c.json(version, 201)
})

// POST /:id/activate — auth — set as list's active_version_id (flags affected parties needs_rescreen, writes ledger)
router.post('/:id/activate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [version] = await db.select().from(list_versions).where(eq(list_versions.id, id))
  if (!version) return c.json({ error: 'Version not found' }, 404)
  const [list] = await db.select().from(lists).where(eq(lists.id, version.list_id))
  if (!list) return c.json({ error: 'List not found' }, 404)

  const [updatedList] = await db
    .update(lists)
    .set({ active_version_id: version.id, is_active: true })
    .where(eq(lists.id, list.id))
    .returning()

  // Flag affected parties: any party in this workspace that has previously been
  // screened or is clear/flagged should be re-screened against the new version.
  const affected = await db
    .select()
    .from(parties)
    .where(eq(parties.workspace_id, list.workspace_id))
  const toFlag = affected.filter(
    (p) => p.status !== 'unscreened' && p.status !== 'blocked',
  )
  if (toFlag.length > 0) {
    await db
      .update(parties)
      .set({ status: 'needs_rescreen', updated_at: new Date() })
      .where(
        inArray(
          parties.id,
          toFlag.map((p) => p.id),
        ),
      )
  }

  await appendLedger({
    workspace_id: list.workspace_id,
    event_type: 'list_activation',
    entity_type: 'list',
    entity_id: list.id,
    actor_id: userId,
    payload: {
      action: 'version_activated',
      version_id: version.id,
      version_label: version.version_label,
      flagged_party_count: toFlag.length,
    },
  })

  return c.json(updatedList)
})

export default router
