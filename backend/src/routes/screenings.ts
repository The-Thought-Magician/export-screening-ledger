import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  screenings,
  screening_matches,
  parties,
  party_aliases,
  lists,
  list_versions,
  list_entries,
  policies,
  allowlist_entries,
  segments,
  rescreen_schedules,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { appendLedger } from '../lib/ledger.js'
import { scoreMatch } from '../lib/match.js'

const router = new Hono()

const runSchema = z.object({
  workspace_id: z.string().min(1),
  party_id: z.string().min(1),
  list_version_ids: z.array(z.string()).optional(),
  trigger: z.enum(['manual', 'scheduled', 'party_change', 'new_version']).optional().default('manual'),
})

const runSegmentSchema = z.object({
  workspace_id: z.string().min(1),
  segment_id: z.string().optional(),
  trigger: z.enum(['manual', 'scheduled', 'party_change', 'new_version']).optional().default('manual'),
})

interface PolicyConfig {
  match_threshold: number
  auto_clear_floor: number
  weights: { nameSimilarity?: number; tokenOverlap?: number; country?: number }
  four_eyes: boolean
}

async function getActivePolicy(workspaceId: string): Promise<PolicyConfig> {
  const [p] = await db
    .select()
    .from(policies)
    .where(and(eq(policies.workspace_id, workspaceId), eq(policies.is_active, true)))
    .orderBy(desc(policies.version))
    .limit(1)
  return {
    match_threshold: p?.match_threshold ?? 0.85,
    auto_clear_floor: p?.auto_clear_floor ?? 0.5,
    weights: (p?.weights as PolicyConfig['weights']) ?? {},
    four_eyes: p?.four_eyes ?? false,
  }
}

// Resolve the list_versions to screen against: explicit ids, or every active
// list's active_version_id in the workspace.
async function resolveVersionIds(workspaceId: string, explicit?: string[]): Promise<string[]> {
  if (explicit && explicit.length > 0) return explicit
  const wsLists = await db
    .select()
    .from(lists)
    .where(and(eq(lists.workspace_id, workspaceId), eq(lists.is_active, true)))
  return wsLists.map((l) => l.active_version_id).filter((v): v is string => !!v)
}

// Core screening of a single party against a set of list_version ids.
async function screenParty(
  workspaceId: string,
  partyId: string,
  versionIds: string[],
  policy: PolicyConfig,
  trigger: string,
  userId: string,
) {
  const [party] = await db.select().from(parties).where(eq(parties.id, partyId))
  if (!party) return null

  const aliasRows = await db
    .select()
    .from(party_aliases)
    .where(eq(party_aliases.party_id, partyId))
  const partySubject = {
    name: party.name,
    aliases: aliasRows.map((a) => a.alias),
    country: party.country,
  }

  // Active allowlist suppressions for this party (list_entry_id may be null =>
  // suppress all matches for the party).
  const now = new Date()
  const suppressions = await db
    .select()
    .from(allowlist_entries)
    .where(
      and(
        eq(allowlist_entries.workspace_id, workspaceId),
        eq(allowlist_entries.party_id, partyId),
      ),
    )
  const activeSuppressions = suppressions.filter(
    (s) => !s.expires_at || s.expires_at > now,
  )
  const suppressAllForParty = activeSuppressions.some((s) => !s.list_entry_id)
  const suppressedEntryIds = new Set(
    activeSuppressions.map((s) => s.list_entry_id).filter((v): v is string => !!v),
  )

  // Pull entries for all target versions.
  const entries =
    versionIds.length > 0
      ? await db.select().from(list_entries).where(inArray(list_entries.list_version_id, versionIds))
      : []

  const [screening] = await db
    .insert(screenings)
    .values({
      workspace_id: workspaceId,
      party_id: partyId,
      list_version_ids: versionIds,
      engine_config: {
        match_threshold: policy.match_threshold,
        weights: policy.weights,
      },
      trigger,
      match_count: 0,
      status: 'complete',
      run_by: userId,
    })
    .returning()

  const matchRows: Array<typeof screening_matches.$inferInsert> = []
  for (const entry of entries) {
    if (suppressAllForParty) continue
    if (suppressedEntryIds.has(entry.id)) continue
    const { score, breakdown } = scoreMatch(
      partySubject,
      { name: entry.name, aliases: entry.aliases ?? [], country: entry.country },
      policy.weights,
    )
    if (score >= policy.match_threshold) {
      matchRows.push({
        screening_id: screening.id,
        party_id: partyId,
        list_entry_id: entry.id,
        list_version_id: entry.list_version_id,
        score,
        score_breakdown: breakdown as unknown as Record<string, unknown>,
        matched_name: entry.name,
        decision: 'pending',
      })
    }
  }

  if (matchRows.length > 0) {
    await db.insert(screening_matches).values(matchRows)
  }

  const matchCount = matchRows.length
  const newStatus = matchCount > 0 ? 'flagged' : 'clear'

  await db
    .update(screenings)
    .set({
      match_count: matchCount,
      status: matchCount > 0 ? 'pending_adjudication' : 'complete',
    })
    .where(eq(screenings.id, screening.id))

  await db
    .update(parties)
    .set({ status: newStatus, last_screened_at: now, updated_at: now })
    .where(eq(parties.id, partyId))

  // Advance any per-party / default rescreen schedule's last_run_at.
  await db
    .update(rescreen_schedules)
    .set({ last_run_at: now })
    .where(
      and(
        eq(rescreen_schedules.workspace_id, workspaceId),
        eq(rescreen_schedules.party_id, partyId),
      ),
    )

  await appendLedger({
    workspace_id: workspaceId,
    event_type: 'screening',
    entity_type: 'screening',
    entity_id: screening.id,
    actor_id: userId,
    payload: {
      party_id: partyId,
      party_name: party.name,
      trigger,
      list_version_ids: versionIds,
      match_count: matchCount,
      result_status: newStatus,
    },
  })

  return { screening, match_count: matchCount, status: newStatus }
}

// GET / — public — screenings for ?workspace_id (filter ?party_id)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const partyId = c.req.query('party_id')

  const where = partyId
    ? and(eq(screenings.workspace_id, workspaceId), eq(screenings.party_id, partyId))
    : eq(screenings.workspace_id, workspaceId)

  const rows = await db
    .select()
    .from(screenings)
    .where(where)
    .orderBy(desc(screenings.created_at))
  return c.json(rows)
})

// GET /:id — public — screening detail (+matches)
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [screening] = await db.select().from(screenings).where(eq(screenings.id, id))
  if (!screening) return c.json({ error: 'Not found' }, 404)
  const matches = await db
    .select()
    .from(screening_matches)
    .where(eq(screening_matches.screening_id, id))
    .orderBy(desc(screening_matches.score))
  return c.json({ ...screening, matches })
})

// POST /run — auth — run screening for a party against active lists
router.post('/run', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [party] = await db
    .select()
    .from(parties)
    .where(and(eq(parties.id, body.party_id), eq(parties.workspace_id, body.workspace_id)))
  if (!party) return c.json({ error: 'Party not found in workspace' }, 404)

  const policy = await getActivePolicy(body.workspace_id)
  const versionIds = await resolveVersionIds(body.workspace_id, body.list_version_ids)
  if (versionIds.length === 0) {
    return c.json({ error: 'No active list versions to screen against' }, 400)
  }

  const result = await screenParty(
    body.workspace_id,
    body.party_id,
    versionIds,
    policy,
    body.trigger,
    userId,
  )
  if (!result) return c.json({ error: 'Party not found' }, 404)

  const matches = await db
    .select()
    .from(screening_matches)
    .where(eq(screening_matches.screening_id, result.screening.id))
    .orderBy(desc(screening_matches.score))

  return c.json({ ...result.screening, match_count: result.match_count, status: result.status, matches }, 201)
})

// POST /run-segment — auth — run screening over a saved segment / all parties
router.post('/run-segment', authMiddleware, zValidator('json', runSegmentSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const policy = await getActivePolicy(body.workspace_id)
  const versionIds = await resolveVersionIds(body.workspace_id)
  if (versionIds.length === 0) {
    return c.json({ error: 'No active list versions to screen against' }, 400)
  }

  // Resolve target parties: by segment filters, or all parties in workspace.
  let targetParties = await db
    .select()
    .from(parties)
    .where(eq(parties.workspace_id, body.workspace_id))

  if (body.segment_id) {
    const [segment] = await db
      .select()
      .from(segments)
      .where(
        and(eq(segments.id, body.segment_id), eq(segments.workspace_id, body.workspace_id)),
      )
    if (!segment) return c.json({ error: 'Segment not found' }, 404)
    const filters = (segment.filters ?? {}) as {
      status?: string
      party_type?: string
      country?: string
      q?: string
    }
    targetParties = targetParties.filter((p) => {
      if (filters.status && p.status !== filters.status) return false
      if (filters.party_type && p.party_type !== filters.party_type) return false
      if (filters.country && (p.country ?? '') !== filters.country) return false
      if (filters.q && !p.name.toLowerCase().includes(filters.q.toLowerCase())) return false
      return true
    })
  }

  const runResults = []
  let totalMatches = 0
  for (const p of targetParties) {
    const r = await screenParty(
      body.workspace_id,
      p.id,
      versionIds,
      policy,
      body.trigger,
      userId,
    )
    if (r) {
      runResults.push({ ...r.screening, match_count: r.match_count, status: r.status })
      totalMatches += r.match_count
    }
  }

  return c.json({ screenings: runResults, total_matches: totalMatches }, 201)
})

export default router
