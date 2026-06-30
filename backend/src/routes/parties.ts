import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  parties,
  party_aliases,
  screenings,
  ledger_entries,
  workspace_members,
} from '../db/schema.js'
import { eq, and, desc, ilike, or } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Local ledger append helper (hash-chained, per-workspace seq).
// ----------------------------------------------------------------------------
async function appendLedger(input: {
  workspace_id: string
  event_type: string
  entity_type: string
  entity_id: string
  actor_id: string
  payload?: Record<string, unknown>
}) {
  const [prev] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, input.workspace_id))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)
  const seq = (prev?.seq ?? 0) + 1
  const prev_hash = prev?.hash ?? null
  const payload = input.payload ?? {}
  const material = JSON.stringify({
    workspace_id: input.workspace_id,
    seq,
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    actor_id: input.actor_id,
    payload,
    prev_hash,
  })
  const hash = createHash('sha256').update(material).digest('hex')
  const [entry] = await db
    .insert(ledger_entries)
    .values({
      workspace_id: input.workspace_id,
      seq,
      event_type: input.event_type,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      actor_id: input.actor_id,
      payload,
      prev_hash,
      hash,
    })
    .returning()
  return entry
}

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

const partyStatuses = [
  'unscreened',
  'clear',
  'flagged',
  'blocked',
  'needs_rescreen',
] as const

const partyTypes = [
  'customer',
  'supplier',
  'intermediary',
  'end_user',
  'forwarder',
] as const

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  party_type: z.enum(partyTypes).optional().default('customer'),
  country: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  identifiers: z.record(z.string()).optional().default({}),
  tags: z.array(z.string()).optional().default([]),
  status: z.enum(partyStatuses).optional().default('unscreened'),
  notes: z.string().optional().nullable(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  party_type: z.enum(partyTypes).optional(),
  country: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  identifiers: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(partyStatuses).optional(),
  notes: z.string().optional().nullable(),
})

// ----------------------------------------------------------------------------
// GET / — public — list parties for ?workspace_id (filter ?status, ?q)
// ----------------------------------------------------------------------------
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const q = c.req.query('q')

  const conds = [eq(parties.workspace_id, workspaceId)]
  if (status) conds.push(eq(parties.status, status))
  if (q) {
    const term = `%${q}%`
    conds.push(or(ilike(parties.name, term), ilike(parties.country, term))!)
  }

  const rows = await db
    .select()
    .from(parties)
    .where(and(...conds))
    .orderBy(desc(parties.created_at))
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// GET /:id — public — party detail (+aliases, screening history)
// ----------------------------------------------------------------------------
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [party] = await db.select().from(parties).where(eq(parties.id, id))
  if (!party) return c.json({ error: 'Not found' }, 404)

  const aliases = await db
    .select()
    .from(party_aliases)
    .where(eq(party_aliases.party_id, id))
    .orderBy(desc(party_aliases.created_at))

  const screeningHistory = await db
    .select()
    .from(screenings)
    .where(eq(screenings.party_id, id))
    .orderBy(desc(screenings.created_at))

  return c.json({ ...party, aliases, screenings: screeningHistory })
})

// ----------------------------------------------------------------------------
// POST / — auth — create party (writes ledger status_change)
// ----------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [party] = await db
    .insert(parties)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      party_type: body.party_type,
      country: body.country ?? null,
      address: body.address ?? null,
      identifiers: body.identifiers,
      tags: body.tags,
      status: body.status,
      notes: body.notes ?? null,
      created_by: userId,
    })
    .returning()

  await appendLedger({
    workspace_id: body.workspace_id,
    event_type: 'status_change',
    entity_type: 'party',
    entity_id: party.id,
    actor_id: userId,
    payload: { from: null, to: party.status, action: 'create', name: party.name },
  })

  return c.json(party, 201)
})

// ----------------------------------------------------------------------------
// PUT /:id — auth — update party (triggers on_change re-screen flag)
// ----------------------------------------------------------------------------
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(parties).where(eq(parties.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = c.req.valid('json')

  // Material fields whose change should trigger an on_change re-screen flag.
  const materialChanged =
    (body.name !== undefined && body.name !== existing.name) ||
    (body.country !== undefined && (body.country ?? null) !== existing.country) ||
    (body.address !== undefined && (body.address ?? null) !== existing.address) ||
    (body.identifiers !== undefined &&
      JSON.stringify(body.identifiers) !== JSON.stringify(existing.identifiers)) ||
    (body.party_type !== undefined && body.party_type !== existing.party_type)

  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.party_type !== undefined) patch.party_type = body.party_type
  if (body.country !== undefined) patch.country = body.country ?? null
  if (body.address !== undefined) patch.address = body.address ?? null
  if (body.identifiers !== undefined) patch.identifiers = body.identifiers
  if (body.tags !== undefined) patch.tags = body.tags
  if (body.notes !== undefined) patch.notes = body.notes ?? null

  // Explicit status change takes precedence; otherwise a material change flags
  // the party for re-screen (unless it is already blocked).
  let newStatus = existing.status
  if (body.status !== undefined) {
    newStatus = body.status
  } else if (materialChanged && existing.status !== 'blocked') {
    newStatus = 'needs_rescreen'
  }
  patch.status = newStatus

  const [updated] = await db
    .update(parties)
    .set(patch)
    .where(eq(parties.id, id))
    .returning()

  if (newStatus !== existing.status) {
    await appendLedger({
      workspace_id: existing.workspace_id,
      event_type: 'status_change',
      entity_type: 'party',
      entity_id: id,
      actor_id: userId,
      payload: {
        from: existing.status,
        to: newStatus,
        action: 'update',
        triggered_by: body.status !== undefined ? 'manual' : 'on_change',
      },
    })
  }

  return c.json(updated)
})

// ----------------------------------------------------------------------------
// DELETE /:id — auth — delete party
// ----------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(parties).where(eq(parties.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(party_aliases).where(eq(party_aliases.party_id, id))
  await db.delete(parties).where(eq(parties.id, id))

  await appendLedger({
    workspace_id: existing.workspace_id,
    event_type: 'status_change',
    entity_type: 'party',
    entity_id: id,
    actor_id: userId,
    payload: { from: existing.status, to: null, action: 'delete', name: existing.name },
  })

  return c.json({ success: true })
})

// ----------------------------------------------------------------------------
// POST /import — auth — bulk CSV import (array of rows) -> { created, errors }
// Accepts either parsed rows[] or a raw csv string.
// ----------------------------------------------------------------------------
const importRowSchema = z.object({
  name: z.string().min(1),
  party_type: z.enum(partyTypes).optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
})

const importSchema = z.object({
  workspace_id: z.string().min(1),
  rows: z.array(importRowSchema).optional(),
  csv: z.string().optional(),
})

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const out: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? '').trim()
    })
    out.push(row)
  }
  return out
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

router.post('/import', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  let rawRows: Array<Record<string, unknown>> = []
  if (body.rows && body.rows.length > 0) {
    rawRows = body.rows as Array<Record<string, unknown>>
  } else if (body.csv) {
    rawRows = parseCsv(body.csv)
  }

  if (rawRows.length === 0) {
    return c.json({ error: 'No rows or csv provided' }, 400)
  }

  const created: unknown[] = []
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]
    const parsed = importRowSchema.safeParse(raw)
    if (!parsed.success) {
      errors.push({ row: i, error: parsed.error.issues.map((x) => x.message).join('; ') })
      continue
    }
    const r = parsed.data
    let tags: string[] = []
    if (Array.isArray(r.tags)) tags = r.tags
    else if (typeof r.tags === 'string' && r.tags.length > 0) {
      tags = r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean)
    }
    try {
      const [party] = await db
        .insert(parties)
        .values({
          workspace_id: body.workspace_id,
          name: r.name,
          party_type: r.party_type ?? 'customer',
          country: r.country ?? null,
          address: r.address ?? null,
          tags,
          notes: r.notes ?? null,
          status: 'unscreened',
          created_by: userId,
        })
        .returning()
      created.push(party)
      await appendLedger({
        workspace_id: body.workspace_id,
        event_type: 'status_change',
        entity_type: 'party',
        entity_id: party.id,
        actor_id: userId,
        payload: { from: null, to: 'unscreened', action: 'import', name: party.name },
      })
    } catch (e) {
      errors.push({ row: i, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return c.json({ created, errors })
})

export default router
