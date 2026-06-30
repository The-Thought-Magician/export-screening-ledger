import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  parties,
  screenings,
  screening_matches,
  orders,
  rescreen_schedules,
  lists,
} from '../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { loadHeatmap, type Job } from '../lib/cron.js'

const router = new Hono()

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function cadenceToCronExpr(cadence: string): { kind: 'cron'; expr: string } {
  switch (cadence) {
    case 'daily':
      return { kind: 'cron', expr: '0 6 * * *' }
    case 'weekly':
      return { kind: 'cron', expr: '0 6 * * 1' }
    case 'monthly':
      return { kind: 'cron', expr: '0 6 1 * *' }
    case 'quarterly':
      return { kind: 'cron', expr: '0 6 1 1,4,7,10 *' }
    default:
      return { kind: 'cron', expr: '0 6 * * 1' }
  }
}

// ----------------------------------------------------------------------------
// GET / — dashboard KPIs for ?workspace_id
// parties by status, open matches, overdue re-screens, blocked orders, throughput
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const [
    partyRows,
    orderRows,
    screeningRows,
    scheduleRows,
    listRows,
  ] = await Promise.all([
    db.select().from(parties).where(eq(parties.workspace_id, workspaceId)),
    db.select().from(orders).where(eq(orders.workspace_id, workspaceId)),
    db.select().from(screenings).where(eq(screenings.workspace_id, workspaceId)),
    db.select().from(rescreen_schedules).where(eq(rescreen_schedules.workspace_id, workspaceId)),
    db.select().from(lists).where(eq(lists.workspace_id, workspaceId)),
  ])

  // Matches scoped to the workspace via its screenings.
  const screeningIds = new Set(screeningRows.map((s) => s.id))
  const allMatches = await db.select().from(screening_matches)
  const wsMatches = allMatches.filter((m) => screeningIds.has(m.screening_id))

  const partiesByStatus: Record<string, number> = {
    unscreened: 0,
    clear: 0,
    flagged: 0,
    blocked: 0,
    needs_rescreen: 0,
  }
  for (const p of partyRows) {
    partiesByStatus[p.status] = (partiesByStatus[p.status] ?? 0) + 1
  }

  const matchesByDecision: Record<string, number> = {
    pending: 0,
    cleared: 0,
    blocked: 0,
    escalated: 0,
  }
  for (const m of wsMatches) {
    matchesByDecision[m.decision] = (matchesByDecision[m.decision] ?? 0) + 1
  }
  const openMatches = matchesByDecision.pending + matchesByDecision.escalated

  const ordersByGate: Record<string, number> = {
    draft: 0,
    blocked: 0,
    pending_review: 0,
    released: 0,
    overridden: 0,
  }
  for (const o of orderRows) {
    ordersByGate[o.gate_status] = (ordersByGate[o.gate_status] ?? 0) + 1
  }
  const blockedOrders = ordersByGate.blocked + ordersByGate.pending_review

  // Overdue / due re-screens.
  const now = Date.now()
  let overdueRescreens = 0
  for (const s of scheduleRows) {
    if (s.next_due_at && new Date(s.next_due_at).getTime() <= now) overdueRescreens += 1
  }
  // Parties explicitly flagged needs_rescreen also count toward attention.
  const needsRescreenParties = partiesByStatus.needs_rescreen

  // Throughput: screenings in the trailing 7 / 30 days.
  const day = 86_400_000
  const screenings7d = screeningRows.filter(
    (s) => s.created_at && now - new Date(s.created_at).getTime() <= 7 * day,
  ).length
  const screenings30d = screeningRows.filter(
    (s) => s.created_at && now - new Date(s.created_at).getTime() <= 30 * day,
  ).length

  return c.json({
    workspace_id: workspaceId,
    parties_total: partyRows.length,
    parties_by_status: partiesByStatus,
    matches_total: wsMatches.length,
    matches_by_decision: matchesByDecision,
    open_matches: openMatches,
    orders_total: orderRows.length,
    orders_by_gate: ordersByGate,
    blocked_orders: blockedOrders,
    overdue_rescreens: overdueRescreens,
    needs_rescreen_parties: needsRescreenParties,
    lists_total: listRows.length,
    screenings_total: screeningRows.length,
    throughput: {
      screenings_7d: screenings7d,
      screenings_30d: screenings30d,
    },
  })
})

// ----------------------------------------------------------------------------
// GET /trends — time-series trends for ?workspace_id
// daily counts of screenings, matches, orders over a horizon, plus a projected
// re-screen firing heatmap derived from the cron engine.
// ----------------------------------------------------------------------------

router.get('/trends', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '30', 10) || 30, 1), 180)

  const [screeningRows, orderRows, scheduleRows] = await Promise.all([
    db.select().from(screenings).where(eq(screenings.workspace_id, workspaceId)).orderBy(desc(screenings.created_at)),
    db.select().from(orders).where(eq(orders.workspace_id, workspaceId)).orderBy(desc(orders.created_at)),
    db.select().from(rescreen_schedules).where(eq(rescreen_schedules.workspace_id, workspaceId)),
  ])

  const allMatches = await db.select().from(screening_matches)
  const screeningIds = new Set(screeningRows.map((s) => s.id))
  const wsMatches = allMatches.filter((m) => screeningIds.has(m.screening_id))

  // Build the day buckets newest-last.
  const today = new Date()
  const buckets: { date: string; screenings: number; matches: number; orders: number; blocked_orders: number }[] = []
  const index = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    const key = dayKey(d)
    index.set(key, buckets.length)
    buckets.push({ date: key, screenings: 0, matches: 0, orders: 0, blocked_orders: 0 })
  }

  for (const s of screeningRows) {
    if (!s.created_at) continue
    const k = dayKey(new Date(s.created_at))
    const i = index.get(k)
    if (i !== undefined) buckets[i].screenings += 1
  }
  for (const m of wsMatches) {
    if (!m.created_at) continue
    const k = dayKey(new Date(m.created_at))
    const i = index.get(k)
    if (i !== undefined) buckets[i].matches += 1
  }
  for (const o of orderRows) {
    if (!o.created_at) continue
    const k = dayKey(new Date(o.created_at))
    const i = index.get(k)
    if (i !== undefined) {
      buckets[i].orders += 1
      if (o.gate_status === 'blocked' || o.gate_status === 'pending_review') buckets[i].blocked_orders += 1
    }
  }

  // Projected re-screen load: turn each active schedule into a cron Job and use
  // the engine's hour-bucket heatmap over the horizon.
  const jobs: Job[] = scheduleRows.map((s) => {
    const { kind, expr } = cadenceToCronExpr(s.cadence)
    return { id: s.id, kind, expr, timezone: 'UTC', resourceId: s.party_id ?? undefined }
  })
  const rescreenHeatmap = jobs.length > 0 ? loadHeatmap(jobs, { horizonDays: days }) : []

  return c.json({
    workspace_id: workspaceId,
    days,
    series: buckets,
    rescreen_projection: rescreenHeatmap,
  })
})

export default router
