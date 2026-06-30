import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  reports,
  workspace_members,
  parties,
  orders,
  screening_matches,
  screenings,
  rescreen_schedules,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const REPORT_TYPES = ['open_matches', 'blocked_orders', 'rescreen_compliance', 'reviewer_activity'] as const
type ReportType = (typeof REPORT_TYPES)[number]

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

// ---------------------------------------------------------------------------
// Report builders — pure DB aggregation, one per report_type.
// ---------------------------------------------------------------------------

async function buildOpenMatches(workspaceId: string) {
  // screening_matches has no workspace_id; scope via its parent screening.
  const joined = await db
    .select({ m: screening_matches })
    .from(screening_matches)
    .innerJoin(screenings, eq(screening_matches.screening_id, screenings.id))
    .where(
      and(
        eq(screenings.workspace_id, workspaceId),
        inArray(screening_matches.decision, ['pending', 'escalated']),
      ),
    )
    .orderBy(desc(screening_matches.score))

  const rows = joined.map((r) => r.m)
  const byDecision = { pending: 0, escalated: 0 } as Record<string, number>
  let scoreSum = 0
  for (const m of rows) {
    byDecision[m.decision] = (byDecision[m.decision] ?? 0) + 1
    scoreSum += m.score
  }

  return {
    report_type: 'open_matches' as const,
    generated_at: new Date().toISOString(),
    total_open: rows.length,
    by_decision: byDecision,
    avg_score: rows.length ? scoreSum / rows.length : 0,
    matches: rows.map((m) => ({
      id: m.id,
      party_id: m.party_id,
      matched_name: m.matched_name,
      score: m.score,
      decision: m.decision,
      screening_id: m.screening_id,
      created_at: m.created_at,
    })),
  }
}

async function buildBlockedOrders(workspaceId: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.workspace_id, workspaceId),
        inArray(orders.gate_status, ['blocked', 'pending_review', 'overridden']),
      ),
    )
    .orderBy(desc(orders.updated_at))

  const byStatus: Record<string, number> = {}
  let blockedValueCents = 0
  for (const o of rows) {
    byStatus[o.gate_status] = (byStatus[o.gate_status] ?? 0) + 1
    if (o.gate_status === 'blocked' || o.gate_status === 'pending_review') {
      blockedValueCents += o.value_cents ?? 0
    }
  }

  return {
    report_type: 'blocked_orders' as const,
    generated_at: new Date().toISOString(),
    total: rows.length,
    by_status: byStatus,
    blocked_value_cents: blockedValueCents,
    orders: rows.map((o) => ({
      id: o.id,
      reference: o.reference,
      destination_country: o.destination_country,
      gate_status: o.gate_status,
      block_reasons: o.block_reasons,
      value_cents: o.value_cents,
      override_reason: o.override_reason,
      override_by: o.override_by,
      overridden_at: o.overridden_at,
    })),
  }
}

async function buildRescreenCompliance(workspaceId: string) {
  const partyRows = await db
    .select()
    .from(parties)
    .where(eq(parties.workspace_id, workspaceId))

  const schedules = await db
    .select()
    .from(rescreen_schedules)
    .where(eq(rescreen_schedules.workspace_id, workspaceId))

  const now = Date.now()
  let overdue = 0
  let dueSoon = 0 // due within 24h
  let neverScreened = 0
  const overdueParties: Array<Record<string, unknown>> = []

  // Per-party schedule lookup, falling back to workspace default (party_id null).
  const defaultSchedule = schedules.find((s) => !s.party_id) ?? null
  const perParty = new Map(schedules.filter((s) => s.party_id).map((s) => [s.party_id as string, s]))

  for (const p of partyRows) {
    if (!p.last_screened_at) neverScreened++
    const sched = perParty.get(p.id) ?? defaultSchedule
    const due = sched?.next_due_at ? new Date(sched.next_due_at).getTime() : null
    if (due !== null) {
      if (due < now) {
        overdue++
        overdueParties.push({
          party_id: p.id,
          name: p.name,
          status: p.status,
          next_due_at: sched?.next_due_at,
          last_screened_at: p.last_screened_at,
        })
      } else if (due < now + 86_400_000) {
        dueSoon++
      }
    }
  }

  const total = partyRows.length
  const compliant = total - overdue
  return {
    report_type: 'rescreen_compliance' as const,
    generated_at: new Date().toISOString(),
    total_parties: total,
    overdue,
    due_soon: dueSoon,
    never_screened: neverScreened,
    compliant,
    compliance_pct: total ? Math.round((compliant / total) * 1000) / 10 : 100,
    overdue_parties: overdueParties,
  }
}

async function buildReviewerActivity(workspaceId: string) {
  const decidedJoined = await db
    .select({ m: screening_matches })
    .from(screening_matches)
    .innerJoin(screenings, eq(screening_matches.screening_id, screenings.id))
    .where(
      and(
        eq(screenings.workspace_id, workspaceId),
        inArray(screening_matches.decision, ['cleared', 'blocked', 'escalated']),
      ),
    )
  const decided = decidedJoined.map((r) => r.m)

  const runs = await db
    .select()
    .from(screenings)
    .where(eq(screenings.workspace_id, workspaceId))

  const byReviewer = new Map<
    string,
    { reviewer_id: string; cleared: number; blocked: number; escalated: number; total: number }
  >()
  for (const m of decided) {
    if (!m.reviewer_id) continue
    let r = byReviewer.get(m.reviewer_id)
    if (!r) {
      r = { reviewer_id: m.reviewer_id, cleared: 0, blocked: 0, escalated: 0, total: 0 }
      byReviewer.set(m.reviewer_id, r)
    }
    if (m.decision === 'cleared') r.cleared++
    else if (m.decision === 'blocked') r.blocked++
    else if (m.decision === 'escalated') r.escalated++
    r.total++
  }

  const byRunner = new Map<string, number>()
  for (const s of runs) {
    byRunner.set(s.run_by, (byRunner.get(s.run_by) ?? 0) + 1)
  }

  return {
    report_type: 'reviewer_activity' as const,
    generated_at: new Date().toISOString(),
    total_decisions: decided.length,
    total_screenings: runs.length,
    reviewers: [...byReviewer.values()].sort((a, b) => b.total - a.total),
    screenings_by_runner: [...byRunner.entries()]
      .map(([run_by, count]) => ({ run_by, count }))
      .sort((a, b) => b.count - a.count),
  }
}

async function generateSnapshot(type: ReportType, workspaceId: string) {
  switch (type) {
    case 'open_matches':
      return buildOpenMatches(workspaceId)
    case 'blocked_orders':
      return buildBlockedOrders(workspaceId)
    case 'rescreen_compliance':
      return buildRescreenCompliance(workspaceId)
    case 'reviewer_activity':
      return buildReviewerActivity(workspaceId)
  }
}

// ---------------------------------------------------------------------------
// GET / — saved reports for ?workspace_id. Public read.
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.workspace_id, workspaceId))
    .orderBy(desc(reports.created_at))

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /generate — generate a report on the fly. Public read.
// ?workspace_id=&type=open_matches|blocked_orders|rescreen_compliance|reviewer_activity
// ---------------------------------------------------------------------------

router.get('/generate', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const type = c.req.query('type') as ReportType | undefined
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  if (!type || !REPORT_TYPES.includes(type)) {
    return c.json({ error: `type must be one of: ${REPORT_TYPES.join(', ')}` }, 400)
  }

  const snapshot = await generateSnapshot(type, workspaceId)
  return c.json(snapshot)
})

// ---------------------------------------------------------------------------
// POST / — save a report snapshot. Auth-gated. Regenerates the snapshot
// server-side from the current DB state so the stored bundle is authoritative.
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  workspace_id: z.string().min(1),
  report_type: z.enum(REPORT_TYPES),
  name: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
})

router.post('/', authMiddleware, zValidator('json', saveSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const snapshot = await generateSnapshot(body.report_type, body.workspace_id)

  const [created] = await db
    .insert(reports)
    .values({
      workspace_id: body.workspace_id,
      report_type: body.report_type,
      name: body.name,
      params: body.params as Record<string, unknown>,
      snapshot: snapshot as unknown as Record<string, unknown>,
      created_by: userId,
    })
    .returning()

  return c.json(created, 201)
})

export default router
