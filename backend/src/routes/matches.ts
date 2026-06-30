import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  screening_matches,
  screenings,
  parties,
  list_entries,
  list_versions,
  workspace_members,
  ledger_entries,
  notifications,
} from '../db/schema.js'
import { eq, and, desc, inArray, max } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function requireRole(
  workspaceId: string,
  userId: string,
  roles: string[],
): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  if (!userId) return { ok: false, status: 401 }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  if (!member) return { ok: false, status: 403 }
  if (!roles.includes(member.role)) return { ok: false, status: 403 }
  return { ok: true }
}

// Append an immutable hash-chained ledger entry for a workspace.
async function appendLedger(input: {
  workspace_id: string
  event_type: string
  entity_type: string
  entity_id: string
  actor_id: string
  payload: Record<string, unknown>
}) {
  const [{ maxSeq }] = await db
    .select({ maxSeq: max(ledger_entries.seq) })
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, input.workspace_id))
  const seq = (maxSeq ?? 0) + 1
  const [prev] = seq > 1
    ? await db
        .select()
        .from(ledger_entries)
        .where(and(eq(ledger_entries.workspace_id, input.workspace_id), eq(ledger_entries.seq, seq - 1)))
    : [undefined]
  const prevHash = prev?.hash ?? null
  const createdAt = new Date()
  const material = JSON.stringify({
    workspace_id: input.workspace_id,
    seq,
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    actor_id: input.actor_id,
    payload: input.payload,
    prev_hash: prevHash,
    created_at: createdAt.toISOString(),
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
      payload: input.payload,
      prev_hash: prevHash,
      hash,
      created_at: createdAt,
    })
    .returning()
  return entry
}

// ----------------------------------------------------------------------------
// GET / — matches for ?workspace_id (filter ?decision, ?party_id)
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const decision = c.req.query('decision')
  const partyId = c.req.query('party_id')

  const conds = [eq(screening_matches.party_id, parties.id), eq(parties.workspace_id, workspaceId)]
  if (decision) conds.push(eq(screening_matches.decision, decision))
  if (partyId) conds.push(eq(screening_matches.party_id, partyId))

  const rows = await db
    .select({
      match: screening_matches,
      party_name: parties.name,
      party_status: parties.status,
    })
    .from(screening_matches)
    .innerJoin(parties, eq(screening_matches.party_id, parties.id))
    .where(and(...conds))
    .orderBy(desc(screening_matches.score), desc(screening_matches.created_at))

  return c.json(rows.map((r) => ({ ...r.match, party_name: r.party_name, party_status: r.party_status })))
})

// ----------------------------------------------------------------------------
// GET /queue — pending + escalated adjudication queue for ?workspace_id
// (declared before /:id so "queue" is not captured as an id)
// ----------------------------------------------------------------------------

router.get('/queue', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select({
      match: screening_matches,
      party_name: parties.name,
      party_status: parties.status,
    })
    .from(screening_matches)
    .innerJoin(parties, eq(screening_matches.party_id, parties.id))
    .where(
      and(
        eq(parties.workspace_id, workspaceId),
        inArray(screening_matches.decision, ['pending', 'escalated']),
      ),
    )
    .orderBy(desc(screening_matches.score), desc(screening_matches.created_at))

  return c.json(rows.map((r) => ({ ...r.match, party_name: r.party_name, party_status: r.party_status })))
})

// ----------------------------------------------------------------------------
// GET /:id — match detail (+ score breakdown, list entry, list version)
// ----------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [m] = await db.select().from(screening_matches).where(eq(screening_matches.id, id))
  if (!m) return c.json({ error: 'Not found' }, 404)

  const [party] = await db.select().from(parties).where(eq(parties.id, m.party_id))
  const [entry] = await db.select().from(list_entries).where(eq(list_entries.id, m.list_entry_id))
  const [version] = await db.select().from(list_versions).where(eq(list_versions.id, m.list_version_id))
  const [screening] = await db.select().from(screenings).where(eq(screenings.id, m.screening_id))

  return c.json({
    ...m,
    party: party ?? null,
    list_entry: entry ?? null,
    list_version: version ?? null,
    screening: screening ?? null,
  })
})

// ----------------------------------------------------------------------------
// POST /:id/adjudicate — decide cleared|blocked|escalated (reviewer/admin)
// updates party status, writes ledger, notifies on escalation
// ----------------------------------------------------------------------------

const adjudicateSchema = z.object({
  decision: z.enum(['cleared', 'blocked', 'escalated']),
  reason: z.string().min(1),
})

router.post('/:id/adjudicate', authMiddleware, zValidator('json', adjudicateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { decision, reason } = c.req.valid('json')

  const [m] = await db.select().from(screening_matches).where(eq(screening_matches.id, id))
  if (!m) return c.json({ error: 'Not found' }, 404)

  const [party] = await db.select().from(parties).where(eq(parties.id, m.party_id))
  if (!party) return c.json({ error: 'Party not found' }, 404)

  const role = await requireRole(party.workspace_id, userId, ['reviewer', 'admin'])
  if (!role.ok) return c.json({ error: role.status === 401 ? 'Unauthorized' : 'Forbidden' }, role.status)

  const decidedAt = new Date()
  const [updated] = await db
    .update(screening_matches)
    .set({ decision, decision_reason: reason, reviewer_id: userId, decided_at: decidedAt })
    .where(eq(screening_matches.id, id))
    .returning()

  // Derive the party status from this and any sibling matches on the same party.
  // blocked > escalated > flagged(pending) > clear.
  const siblings = await db.select().from(screening_matches).where(eq(screening_matches.party_id, m.party_id))
  let partyStatus: string
  if (siblings.some((s) => s.decision === 'blocked')) {
    partyStatus = 'blocked'
  } else if (siblings.some((s) => s.decision === 'escalated' || s.decision === 'pending')) {
    partyStatus = 'flagged'
  } else {
    partyStatus = 'clear'
  }

  await db
    .update(parties)
    .set({ status: partyStatus, updated_at: new Date() })
    .where(eq(parties.id, m.party_id))

  await appendLedger({
    workspace_id: party.workspace_id,
    event_type: 'adjudication',
    entity_type: 'screening_match',
    entity_id: id,
    actor_id: userId,
    payload: {
      decision,
      reason,
      party_id: m.party_id,
      matched_name: m.matched_name,
      score: m.score,
      resulting_party_status: partyStatus,
    },
  })

  if (decision === 'escalated') {
    // Notify workspace reviewers/admins of the escalation.
    const reviewers = await db
      .select()
      .from(workspace_members)
      .where(eq(workspace_members.workspace_id, party.workspace_id))
    for (const r of reviewers) {
      if (r.role === 'reviewer' || r.role === 'admin') {
        await db.insert(notifications).values({
          workspace_id: party.workspace_id,
          user_id: r.user_id,
          kind: 'escalation',
          title: `Match escalated: ${party.name}`,
          body: `Match against "${m.matched_name}" was escalated. Reason: ${reason}`,
          link: `/dashboard/matches/${id}`,
        })
      }
    }
  }

  return c.json({ ...updated, party_status: partyStatus })
})

export default router
