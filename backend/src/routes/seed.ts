import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  parties,
  party_aliases,
  lists,
  list_versions,
  list_entries,
  screenings,
  screening_matches,
  orders,
  order_parties,
  embargoed_countries,
  end_use_rules,
  rescreen_schedules,
  ledger_entries,
  policies,
  allowlist_entries,
  exports,
  segments,
  reports,
  notifications,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { createHash } from 'node:crypto'

const router = new Hono()

// ----------------------------------------------------------------------------
// deterministic name-similarity used to mint realistic near-match scores
// ----------------------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(ltd|llc|inc|co|corp|company|trading|group|industries|gmbh|sa|jsc|plc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const clean = s.replace(/\s+/g, '')
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

function diceScore(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ba = bigrams(na)
  const bb = bigrams(nb)
  if (ba.size === 0 || bb.size === 0) return 0
  let overlap = 0
  for (const [g, count] of ba) {
    const other = bb.get(g)
    if (other) overlap += Math.min(count, other)
  }
  const total = [...ba.values()].reduce((s, n) => s + n, 0) + [...bb.values()].reduce((s, n) => s + n, 0)
  return (2 * overlap) / total
}

function contentHash(obj: unknown): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

// ----------------------------------------------------------------------------
// hash-chained ledger append within a workspace
// ----------------------------------------------------------------------------

async function appendLedger(
  workspaceId: string,
  actorId: string,
  eventType: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const [prev] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspaceId))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)
  const seq = prev ? prev.seq + 1 : 1
  const prevHash = prev ? prev.hash : null
  const hash = createHash('sha256')
    .update(JSON.stringify({ workspaceId, seq, eventType, entityType, entityId, actorId, payload, prevHash }))
    .digest('hex')
  await db.insert(ledger_entries).values({
    workspace_id: workspaceId,
    seq,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId,
    actor_id: actorId,
    payload,
    prev_hash: prevHash,
    hash,
  })
}

// ----------------------------------------------------------------------------
// synthetic fixtures
// ----------------------------------------------------------------------------

const SANCTIONED_ENTRIES = [
  { name: 'Volga Heavy Machinery JSC', country: 'RU', entity_type: 'company', program_codes: ['RUSSIA-EO14024'], remarks: 'Defense procurement front.' },
  { name: 'Crimson Drone Technologies', country: 'IR', entity_type: 'company', program_codes: ['IRAN-EO13902'], remarks: 'UAV component supplier.' },
  { name: 'Pyongyang Metals Export Co', country: 'KP', entity_type: 'company', program_codes: ['DPRK4'], remarks: 'Sanctioned minerals exporter.' },
  { name: 'Sokol Aerospace Trading', country: 'BY', entity_type: 'company', program_codes: ['BELARUS-EO14038'], remarks: 'Dual-use aerospace broker.' },
  { name: 'Damascus Precision Instruments', country: 'SY', entity_type: 'company', program_codes: ['SYRIA'], remarks: 'Restricted instrumentation.' },
  { name: 'Ivan Petrov Volkov', country: 'RU', entity_type: 'individual', program_codes: ['RUSSIA-EO14024'], remarks: 'Designated individual.' },
]

// Each party is paired with a target list entry; "decoy" parties are deliberate
// near-misses that should produce sub-threshold or borderline scores.
const DEMO_PARTIES: {
  name: string
  party_type: string
  country: string | null
  decoyOf?: number // index into SANCTIONED_ENTRIES this name is a near-match of
  clean?: boolean
  aliases?: string[]
}[] = [
  { name: 'Volga Heavy Machinery JSC', party_type: 'supplier', country: 'RU', decoyOf: 0, aliases: ['Volga Heavy Mach.'] },
  { name: 'Volgar Heavy Machines', party_type: 'supplier', country: 'KZ', decoyOf: 0 },
  { name: 'Crimson Drone Tech', party_type: 'end_user', country: 'AE', decoyOf: 1, aliases: ['CDT'] },
  { name: 'Crimson Garden Supplies', party_type: 'customer', country: 'US', clean: true },
  { name: 'Pyongyang Metals Export Co', party_type: 'intermediary', country: 'CN', decoyOf: 2 },
  { name: 'Sokol Aerospace Trading', party_type: 'forwarder', country: 'BY', decoyOf: 3 },
  { name: 'Falcon Aerospace Logistics', party_type: 'forwarder', country: 'DE', clean: true },
  { name: 'Damascus Precision Instruments', party_type: 'supplier', country: 'SY', decoyOf: 4 },
  { name: 'Helsinki Optical Systems', party_type: 'customer', country: 'FI', clean: true },
  { name: 'Northwind Components Ltd', party_type: 'customer', country: 'GB', clean: true },
  { name: 'Ivan P. Volkov', party_type: 'end_user', country: 'RU', decoyOf: 5 },
  { name: 'Meridian Trade Partners', party_type: 'customer', country: 'SG', clean: true },
]

const DEMO_EMBARGOES = [
  { country_code: 'KP', country_name: 'North Korea', embargo_type: 'comprehensive' },
  { country_code: 'IR', country_name: 'Iran', embargo_type: 'comprehensive' },
  { country_code: 'SY', country_name: 'Syria', embargo_type: 'comprehensive' },
  { country_code: 'CU', country_name: 'Cuba', embargo_type: 'comprehensive' },
]

const DEMO_END_USE_RULES = [
  { label: 'Military end use', keyword: 'military', category: 'prohibited', action: 'block' },
  { label: 'Nuclear application', keyword: 'nuclear', category: 'prohibited', action: 'block' },
  { label: 'UAV / drone', keyword: 'drone', category: 'restricted', action: 'flag' },
  { label: 'Surveillance', keyword: 'surveillance', category: 'watch', action: 'flag' },
]

const DEMO_ORDERS = [
  { reference: 'PO-1001', destination_country: 'DE', end_use: 'Commercial machining components', value_cents: 4_500_000, partyNames: ['Northwind Components Ltd'] },
  { reference: 'PO-1002', destination_country: 'AE', end_use: 'Drone navigation modules', value_cents: 8_900_000, partyNames: ['Crimson Drone Tech'] },
  { reference: 'PO-1003', destination_country: 'KP', end_use: 'Metal alloy billets', value_cents: 2_100_000, partyNames: ['Pyongyang Metals Export Co'] },
  { reference: 'PO-1004', destination_country: 'FI', end_use: 'Optical lens assemblies', value_cents: 3_200_000, partyNames: ['Helsinki Optical Systems'] },
  { reference: 'PO-1005', destination_country: 'RU', end_use: 'Aerospace fasteners', value_cents: 6_700_000, partyNames: ['Sokol Aerospace Trading'] },
]

// ----------------------------------------------------------------------------
// core builder — populates an existing (empty-of-domain-data) workspace
// ----------------------------------------------------------------------------

const MATCH_THRESHOLD = 0.85

async function buildDemoData(workspaceId: string, userId: string) {
  const counts = {
    parties: 0,
    aliases: 0,
    lists: 0,
    list_versions: 0,
    list_entries: 0,
    screenings: 0,
    matches: 0,
    orders: 0,
    embargoes: 0,
    end_use_rules: 0,
    rescreen_schedules: 0,
    notifications: 0,
  }

  // Policy (active) — used as the screening config baseline.
  const existingPolicy = await db
    .select()
    .from(policies)
    .where(and(eq(policies.workspace_id, workspaceId), eq(policies.is_active, true)))
    .limit(1)
  if (existingPolicy.length === 0) {
    await db.insert(policies).values({
      workspace_id: workspaceId,
      version: 1,
      match_threshold: MATCH_THRESHOLD,
      auto_clear_floor: 0.5,
      weights: { name: 0.7, country: 0.2, alias: 0.1 },
      four_eyes: false,
      default_cadence: 'weekly',
      is_active: true,
      created_by: userId,
    })
    await appendLedger(workspaceId, userId, 'policy_change', 'policy', workspaceId, { version: 1, seeded: true })
  }

  // Embargoes.
  for (const e of DEMO_EMBARGOES) {
    await db
      .insert(embargoed_countries)
      .values({ workspace_id: workspaceId, ...e, created_by: userId })
      .onConflictDoNothing()
    counts.embargoes += 1
  }

  // End-use rules.
  for (const r of DEMO_END_USE_RULES) {
    await db.insert(end_use_rules).values({ workspace_id: workspaceId, ...r, created_by: userId })
    counts.end_use_rules += 1
  }

  // List + version + entries (the denied-party list).
  const [list] = await db
    .insert(lists)
    .values({
      workspace_id: workspaceId,
      name: 'OFAC Consolidated (Demo)',
      source_authority: 'OFAC_SDN',
      list_type: 'denied',
      is_active: true,
      created_by: userId,
    })
    .returning()
  counts.lists += 1

  const [version] = await db
    .insert(list_versions)
    .values({
      list_id: list.id,
      version_label: 'v2026.06',
      content_hash: contentHash(SANCTIONED_ENTRIES),
      entry_count: SANCTIONED_ENTRIES.length,
      created_by: userId,
    })
    .returning()
  counts.list_versions += 1

  await db.update(lists).set({ active_version_id: version.id }).where(eq(lists.id, list.id))
  await appendLedger(workspaceId, userId, 'list_activation', 'list_version', version.id, {
    list_id: list.id,
    version_label: version.version_label,
  })

  const entryRows = await Promise.all(
    SANCTIONED_ENTRIES.map((e) =>
      db
        .insert(list_entries)
        .values({
          list_version_id: version.id,
          name: e.name,
          aliases: [],
          entity_type: e.entity_type,
          country: e.country,
          program_codes: e.program_codes,
          remarks: e.remarks,
          source_ref: `OFAC/${e.name.replace(/\s+/g, '_')}`,
        })
        .returning(),
    ),
  )
  const listEntries = entryRows.map((r) => r[0])
  counts.list_entries += listEntries.length

  // Parties (+ aliases).
  const partyRows: { id: string; name: string; def: (typeof DEMO_PARTIES)[number] }[] = []
  for (const def of DEMO_PARTIES) {
    const [p] = await db
      .insert(parties)
      .values({
        workspace_id: workspaceId,
        name: def.name,
        party_type: def.party_type,
        country: def.country,
        identifiers: {},
        tags: def.clean ? ['low-risk'] : ['review'],
        status: 'unscreened',
        created_by: userId,
      })
      .returning()
    counts.parties += 1
    partyRows.push({ id: p.id, name: p.name, def })
    await appendLedger(workspaceId, userId, 'status_change', 'party', p.id, { status: 'unscreened', seeded: true })
    for (const alias of def.aliases ?? []) {
      await db.insert(party_aliases).values({ party_id: p.id, alias })
      counts.aliases += 1
    }
  }

  // Re-screen schedules: a workspace default + a per-party schedule for flagged ones.
  const now = Date.now()
  await db.insert(rescreen_schedules).values({
    workspace_id: workspaceId,
    party_id: null,
    cadence: 'weekly',
    next_due_at: new Date(now + 7 * 86_400_000),
    on_change: true,
    on_new_version: true,
    created_by: userId,
  })
  counts.rescreen_schedules += 1

  // Screen every party against the active list version. Decoys produce matches;
  // strong (>= threshold) matches flag/block the party.
  for (const pr of partyRows) {
    // Score against each entry; keep entries scoring above the auto-clear floor.
    const scored = listEntries
      .map((entry) => {
        const nameScore = Math.max(
          diceScore(pr.name, entry.name),
          ...(pr.def.aliases ?? []).map((a) => diceScore(a, entry.name)),
        )
        const countryScore = pr.def.country && entry.country && pr.def.country === entry.country ? 1 : 0
        const score = Math.min(1, nameScore * 0.85 + countryScore * 0.15)
        return { entry, score, nameScore, countryScore }
      })
      .filter((s) => s.score >= 0.5)
      .sort((a, b) => b.score - a.score)

    const matchCount = scored.length
    const hasStrong = scored.some((s) => s.score >= MATCH_THRESHOLD)

    const [screening] = await db
      .insert(screenings)
      .values({
        workspace_id: workspaceId,
        party_id: pr.id,
        list_version_ids: [version.id],
        engine_config: { threshold: MATCH_THRESHOLD, algorithm: 'dice-bigram' },
        trigger: 'scheduled',
        match_count: matchCount,
        status: matchCount > 0 ? 'pending_adjudication' : 'complete',
        run_by: userId,
      })
      .returning()
    counts.screenings += 1
    await appendLedger(workspaceId, userId, 'screening', 'screening', screening.id, {
      party_id: pr.id,
      match_count: matchCount,
    })

    for (const s of scored) {
      await db.insert(screening_matches).values({
        screening_id: screening.id,
        party_id: pr.id,
        list_entry_id: s.entry.id,
        list_version_id: version.id,
        score: s.score,
        score_breakdown: { name: s.nameScore, country: s.countryScore, combined: s.score },
        matched_name: s.entry.name,
        decision: 'pending',
      })
      counts.matches += 1
    }

    // Update party status from the screening outcome.
    const newStatus = hasStrong ? 'flagged' : matchCount > 0 ? 'flagged' : 'clear'
    await db
      .update(parties)
      .set({ status: newStatus, last_screened_at: new Date(), updated_at: new Date() })
      .where(eq(parties.id, pr.id))
    if (hasStrong) {
      await db.insert(notifications).values({
        workspace_id: workspaceId,
        user_id: userId,
        kind: 'match',
        title: `Potential match for ${pr.name}`,
        body: `Screening produced ${matchCount} candidate match(es) requiring adjudication.`,
        link: `/dashboard/screenings/${screening.id}`,
      })
      counts.notifications += 1
    }
  }

  // Orders with parties; gate evaluation from party status + embargo + end-use.
  const embargoCodes = new Set(DEMO_EMBARGOES.map((e) => e.country_code))
  const partyByName = new Map(partyRows.map((p) => [p.name, p]))
  for (const od of DEMO_ORDERS) {
    const blockReasons: string[] = []
    if (od.destination_country && embargoCodes.has(od.destination_country)) {
      blockReasons.push(`Destination ${od.destination_country} is embargoed`)
    }
    for (const rule of DEMO_END_USE_RULES) {
      if (od.end_use && od.end_use.toLowerCase().includes(rule.keyword)) {
        blockReasons.push(`End-use rule "${rule.label}" (${rule.action})`)
      }
    }
    let gate: string = 'released'
    const orderParties = od.partyNames.map((n) => partyByName.get(n)).filter(Boolean) as typeof partyRows
    for (const op of orderParties) {
      const [pp] = await db.select().from(parties).where(eq(parties.id, op.id))
      if (pp && (pp.status === 'blocked' || pp.status === 'flagged')) {
        blockReasons.push(`Party "${pp.name}" status is ${pp.status}`)
      }
    }
    if (blockReasons.some((r) => r.includes('embargoed') || r.includes('block'))) gate = 'blocked'
    else if (blockReasons.length > 0) gate = 'pending_review'

    const [order] = await db
      .insert(orders)
      .values({
        workspace_id: workspaceId,
        reference: od.reference,
        destination_country: od.destination_country,
        end_use: od.end_use,
        value_cents: od.value_cents,
        gate_status: gate,
        block_reasons: blockReasons,
        created_by: userId,
      })
      .returning()
    counts.orders += 1
    for (const op of orderParties) {
      await db
        .insert(order_parties)
        .values({ order_id: order.id, party_id: op.id, role_on_order: 'buyer' })
        .onConflictDoNothing()
    }
    await appendLedger(workspaceId, userId, 'screening', 'order', order.id, {
      reference: od.reference,
      gate_status: gate,
      block_reasons: blockReasons,
    })
    if (gate !== 'released') {
      await db.insert(notifications).values({
        workspace_id: workspaceId,
        user_id: userId,
        kind: 'order_blocked',
        title: `Order ${od.reference} ${gate}`,
        body: blockReasons.join('; '),
        link: `/dashboard/orders/${order.id}`,
      })
      counts.notifications += 1
    }
  }

  return counts
}

// ----------------------------------------------------------------------------
// deletes all domain data for a workspace (preserves the workspace + members)
// ----------------------------------------------------------------------------

async function wipeWorkspaceData(workspaceId: string) {
  // Children before parents to respect FKs.

  // screening_matches -> screenings
  const screeningRows = await db.select({ id: screenings.id }).from(screenings).where(eq(screenings.workspace_id, workspaceId))
  for (const s of screeningRows) {
    await db.delete(screening_matches).where(eq(screening_matches.screening_id, s.id))
  }
  await db.delete(screenings).where(eq(screenings.workspace_id, workspaceId))

  // order_parties -> orders
  const orderRows = await db.select({ id: orders.id }).from(orders).where(eq(orders.workspace_id, workspaceId))
  for (const o of orderRows) {
    await db.delete(order_parties).where(eq(order_parties.order_id, o.id))
  }
  await db.delete(orders).where(eq(orders.workspace_id, workspaceId))

  // allowlist references parties + list_entries; clear first
  await db.delete(allowlist_entries).where(eq(allowlist_entries.workspace_id, workspaceId))

  // list_entries -> list_versions -> lists
  const listRows = await db.select({ id: lists.id }).from(lists).where(eq(lists.workspace_id, workspaceId))
  for (const l of listRows) {
    const versionRows = await db.select({ id: list_versions.id }).from(list_versions).where(eq(list_versions.list_id, l.id))
    for (const v of versionRows) {
      await db.delete(list_entries).where(eq(list_entries.list_version_id, v.id))
    }
    await db.update(lists).set({ active_version_id: null }).where(eq(lists.id, l.id))
    await db.delete(list_versions).where(eq(list_versions.list_id, l.id))
  }
  await db.delete(lists).where(eq(lists.workspace_id, workspaceId))

  // party_aliases -> parties
  const partyRows = await db.select({ id: parties.id }).from(parties).where(eq(parties.workspace_id, workspaceId))
  for (const p of partyRows) {
    await db.delete(party_aliases).where(eq(party_aliases.party_id, p.id))
  }
  await db.delete(rescreen_schedules).where(eq(rescreen_schedules.workspace_id, workspaceId))
  await db.delete(parties).where(eq(parties.workspace_id, workspaceId))

  // standalone workspace-scoped tables
  await db.delete(embargoed_countries).where(eq(embargoed_countries.workspace_id, workspaceId))
  await db.delete(end_use_rules).where(eq(end_use_rules.workspace_id, workspaceId))
  await db.delete(notifications).where(eq(notifications.workspace_id, workspaceId))
  await db.delete(segments).where(eq(segments.workspace_id, workspaceId))
  await db.delete(reports).where(eq(reports.workspace_id, workspaceId))
  await db.delete(exports).where(eq(exports.workspace_id, workspaceId))
  await db.delete(policies).where(eq(policies.workspace_id, workspaceId))
  await db.delete(ledger_entries).where(eq(ledger_entries.workspace_id, workspaceId))
}

async function requireAdminOrMember(workspaceId: string, userId: string, requireAdmin: boolean) {
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  if (!member) return false
  if (requireAdmin && member.role !== 'admin') return false
  return true
}

// ----------------------------------------------------------------------------
// POST /demo — create a fresh demo workspace owned by the caller
// ----------------------------------------------------------------------------

router.post('/demo', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const slug = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Demo Workspace', slug, created_by: userId })
    .returning()
  await db.insert(workspace_members).values({
    workspace_id: workspace.id,
    user_id: userId,
    role: 'admin',
  })

  const counts = await buildDemoData(workspace.id, userId)
  return c.json({ workspace_id: workspace.id, slug: workspace.slug, counts }, 201)
})

// ----------------------------------------------------------------------------
// POST /reset — wipe + regenerate demo data for ?workspace_id (admin only)
// ----------------------------------------------------------------------------

router.post('/reset', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404)

  const ok = await requireAdminOrMember(workspaceId, userId, true)
  if (!ok) return c.json({ error: 'Forbidden' }, 403)

  await wipeWorkspaceData(workspaceId)
  const counts = await buildDemoData(workspaceId, userId)
  return c.json({ workspace_id: workspaceId, counts })
})

export default router
