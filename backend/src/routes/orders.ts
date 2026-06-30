import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import {
  orders,
  order_parties,
  parties,
  embargoed_countries,
  end_use_rules,
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

async function getMember(workspaceId: string, userId: string) {
  if (!userId) return null
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return m ?? null
}

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

interface GateResult {
  gate_status: 'released' | 'blocked' | 'pending_review'
  block_reasons: string[]
}

// Pure gate evaluation: derives a gate status + block reasons from the order's
// parties' statuses, the destination embargo, and end-use keyword rules.
function evaluateOrderGate(args: {
  destination_country: string | null
  end_use: string | null
  partyRows: Array<{ id: string; name: string; status: string }>
  embargoes: Array<{ country_code: string; embargo_type: string; is_active: boolean }>
  endUseRules: Array<{ keyword: string; label: string; action: string; is_active: boolean }>
}): GateResult {
  const reasons: string[] = []
  let hardBlock = false
  let review = false

  // Party screening status.
  for (const p of args.partyRows) {
    if (p.status === 'blocked') {
      hardBlock = true
      reasons.push(`Party "${p.name}" is BLOCKED`)
    } else if (p.status === 'flagged') {
      review = true
      reasons.push(`Party "${p.name}" is FLAGGED (open match)`)
    } else if (p.status === 'needs_rescreen' || p.status === 'unscreened') {
      review = true
      reasons.push(`Party "${p.name}" requires (re-)screening`)
    }
  }

  // Embargoed destination.
  if (args.destination_country) {
    const dest = args.destination_country.trim().toUpperCase()
    for (const e of args.embargoes) {
      if (!e.is_active) continue
      if (e.country_code.trim().toUpperCase() === dest) {
        if (e.embargo_type === 'comprehensive' || e.embargo_type === 'arms') {
          hardBlock = true
          reasons.push(`Destination ${dest} under ${e.embargo_type} embargo`)
        } else {
          review = true
          reasons.push(`Destination ${dest} under ${e.embargo_type} embargo`)
        }
      }
    }
  }

  // End-use keyword rules.
  if (args.end_use) {
    const eu = args.end_use.toLowerCase()
    for (const rule of args.endUseRules) {
      if (!rule.is_active) continue
      if (rule.keyword && eu.includes(rule.keyword.toLowerCase())) {
        if (rule.action === 'block') {
          hardBlock = true
          reasons.push(`End-use matches prohibited rule "${rule.label}"`)
        } else {
          review = true
          reasons.push(`End-use matches watch rule "${rule.label}"`)
        }
      }
    }
  }

  if (hardBlock) return { gate_status: 'blocked', block_reasons: reasons }
  if (review) return { gate_status: 'pending_review', block_reasons: reasons }
  return { gate_status: 'released', block_reasons: [] }
}

// Run gate evaluation for a persisted order: fetch its parties + workspace rules.
async function evaluateForOrder(order: typeof orders.$inferSelect): Promise<GateResult> {
  const opRows = await db
    .select({ party: parties })
    .from(order_parties)
    .innerJoin(parties, eq(order_parties.party_id, parties.id))
    .where(eq(order_parties.order_id, order.id))
  const partyRows = opRows.map((r) => ({ id: r.party.id, name: r.party.name, status: r.party.status }))

  const embargoes = await db
    .select()
    .from(embargoed_countries)
    .where(eq(embargoed_countries.workspace_id, order.workspace_id))
  const rules = await db
    .select()
    .from(end_use_rules)
    .where(eq(end_use_rules.workspace_id, order.workspace_id))

  return evaluateOrderGate({
    destination_country: order.destination_country,
    end_use: order.end_use,
    partyRows,
    embargoes: embargoes.map((e) => ({ country_code: e.country_code, embargo_type: e.embargo_type, is_active: e.is_active })),
    endUseRules: rules.map((r) => ({ keyword: r.keyword, label: r.label, action: r.action, is_active: r.is_active })),
  })
}

async function loadOrderDetail(order: typeof orders.$inferSelect) {
  const opRows = await db
    .select({ op: order_parties, party: parties })
    .from(order_parties)
    .innerJoin(parties, eq(order_parties.party_id, parties.id))
    .where(eq(order_parties.order_id, order.id))
  const gate = await evaluateForOrder(order)
  return {
    ...order,
    parties: opRows.map((r) => ({
      id: r.op.id,
      party_id: r.party.id,
      name: r.party.name,
      status: r.party.status,
      country: r.party.country,
      role_on_order: r.op.role_on_order,
    })),
    gate_evaluation: gate,
  }
}

// ----------------------------------------------------------------------------
// GET / — orders for ?workspace_id (filter ?gate_status)
// ----------------------------------------------------------------------------

router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const gateStatus = c.req.query('gate_status')

  const conds = [eq(orders.workspace_id, workspaceId)]
  if (gateStatus) conds.push(eq(orders.gate_status, gateStatus))

  const rows = await db
    .select()
    .from(orders)
    .where(and(...conds))
    .orderBy(desc(orders.created_at))
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// GET /:id — order detail (+ parties, gate evaluation)
// ----------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [order] = await db.select().from(orders).where(eq(orders.id, id))
  if (!order) return c.json({ error: 'Not found' }, 404)
  return c.json(await loadOrderDetail(order))
})

// ----------------------------------------------------------------------------
// POST / — create order with parties[] (evaluates gate, writes ledger)
// ----------------------------------------------------------------------------

const orderPartySchema = z.object({
  party_id: z.string().min(1),
  role_on_order: z.enum(['buyer', 'consignee', 'end_user', 'intermediary']).optional().default('buyer'),
})

const createOrderSchema = z.object({
  workspace_id: z.string().min(1),
  reference: z.string().min(1),
  destination_country: z.string().optional().nullable(),
  end_use: z.string().optional().nullable(),
  value_cents: z.number().int().nonnegative().optional().default(0),
  parties: z.array(orderPartySchema).optional().default([]),
})

router.post('/', authMiddleware, zValidator('json', createOrderSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await getMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Validate referenced parties belong to the workspace.
  if (body.parties.length > 0) {
    const ids = body.parties.map((p) => p.party_id)
    const found = await db
      .select()
      .from(parties)
      .where(and(eq(parties.workspace_id, body.workspace_id), inArray(parties.id, ids)))
    if (found.length !== new Set(ids).size) {
      return c.json({ error: 'One or more parties not found in workspace' }, 400)
    }
  }

  const [order] = await db
    .insert(orders)
    .values({
      workspace_id: body.workspace_id,
      reference: body.reference,
      destination_country: body.destination_country ?? null,
      end_use: body.end_use ?? null,
      value_cents: body.value_cents,
      gate_status: 'draft',
      created_by: userId,
    })
    .returning()

  for (const p of body.parties) {
    await db
      .insert(order_parties)
      .values({ order_id: order.id, party_id: p.party_id, role_on_order: p.role_on_order })
      .onConflictDoNothing()
  }

  const gate = await evaluateForOrder(order)
  const [updated] = await db
    .update(orders)
    .set({ gate_status: gate.gate_status, block_reasons: gate.block_reasons, updated_at: new Date() })
    .where(eq(orders.id, order.id))
    .returning()

  await appendLedger({
    workspace_id: body.workspace_id,
    event_type: 'screening',
    entity_type: 'order',
    entity_id: order.id,
    actor_id: userId,
    payload: {
      action: 'order_created',
      reference: order.reference,
      gate_status: gate.gate_status,
      block_reasons: gate.block_reasons,
    },
  })

  if (gate.gate_status === 'blocked') {
    await db.insert(notifications).values({
      workspace_id: body.workspace_id,
      user_id: userId,
      kind: 'order_blocked',
      title: `Order ${order.reference} blocked`,
      body: gate.block_reasons.join('; '),
      link: `/dashboard/orders/${order.id}`,
    })
  }

  return c.json(await loadOrderDetail(updated), 201)
})

// ----------------------------------------------------------------------------
// PUT /:id — update order (re-evaluates gate)
// ----------------------------------------------------------------------------

const updateOrderSchema = z.object({
  reference: z.string().min(1).optional(),
  destination_country: z.string().nullable().optional(),
  end_use: z.string().nullable().optional(),
  value_cents: z.number().int().nonnegative().optional(),
  parties: z.array(orderPartySchema).optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateOrderSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(orders).where(eq(orders.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await getMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.reference !== undefined) patch.reference = body.reference
  if (body.destination_country !== undefined) patch.destination_country = body.destination_country
  if (body.end_use !== undefined) patch.end_use = body.end_use
  if (body.value_cents !== undefined) patch.value_cents = body.value_cents

  await db.update(orders).set(patch).where(eq(orders.id, id))

  if (body.parties !== undefined) {
    const ids = body.parties.map((p) => p.party_id)
    if (ids.length > 0) {
      const found = await db
        .select()
        .from(parties)
        .where(and(eq(parties.workspace_id, existing.workspace_id), inArray(parties.id, ids)))
      if (found.length !== new Set(ids).size) {
        return c.json({ error: 'One or more parties not found in workspace' }, 400)
      }
    }
    await db.delete(order_parties).where(eq(order_parties.order_id, id))
    for (const p of body.parties) {
      await db
        .insert(order_parties)
        .values({ order_id: id, party_id: p.party_id, role_on_order: p.role_on_order })
        .onConflictDoNothing()
    }
  }

  const [reloaded] = await db.select().from(orders).where(eq(orders.id, id))
  const gate = await evaluateForOrder(reloaded)
  // Preserve a prior override; otherwise apply the freshly computed status.
  const nextStatus = reloaded.gate_status === 'overridden' ? 'overridden' : gate.gate_status
  const [updated] = await db
    .update(orders)
    .set({ gate_status: nextStatus, block_reasons: gate.block_reasons, updated_at: new Date() })
    .where(eq(orders.id, id))
    .returning()

  await appendLedger({
    workspace_id: existing.workspace_id,
    event_type: 'screening',
    entity_type: 'order',
    entity_id: id,
    actor_id: userId,
    payload: { action: 'order_updated', gate_status: nextStatus, block_reasons: gate.block_reasons },
  })

  return c.json(await loadOrderDetail(updated))
})

// ----------------------------------------------------------------------------
// POST /:id/evaluate — recompute gate status from party statuses + embargo + end-use
// ----------------------------------------------------------------------------

router.post('/:id/evaluate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [order] = await db.select().from(orders).where(eq(orders.id, id))
  if (!order) return c.json({ error: 'Not found' }, 404)
  if (!(await getMember(order.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const gate = await evaluateForOrder(order)
  const [updated] = await db
    .update(orders)
    .set({ gate_status: gate.gate_status, block_reasons: gate.block_reasons, updated_at: new Date() })
    .where(eq(orders.id, id))
    .returning()

  await appendLedger({
    workspace_id: order.workspace_id,
    event_type: 'screening',
    entity_type: 'order',
    entity_id: id,
    actor_id: userId,
    payload: { action: 'gate_evaluated', gate_status: gate.gate_status, block_reasons: gate.block_reasons },
  })

  return c.json(await loadOrderDetail(updated))
})

// ----------------------------------------------------------------------------
// POST /:id/override — release a gated order with justification (admin only)
// ----------------------------------------------------------------------------

const overrideSchema = z.object({
  reason: z.string().min(1),
})

router.post('/:id/override', authMiddleware, zValidator('json', overrideSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { reason } = c.req.valid('json')

  const [order] = await db.select().from(orders).where(eq(orders.id, id))
  if (!order) return c.json({ error: 'Not found' }, 404)

  const member = await getMember(order.workspace_id, userId)
  if (!member) return c.json({ error: 'Forbidden' }, 403)
  if (member.role !== 'admin') return c.json({ error: 'Forbidden: admin role required' }, 403)

  const overriddenAt = new Date()
  const [updated] = await db
    .update(orders)
    .set({
      gate_status: 'overridden',
      override_reason: reason,
      override_by: userId,
      overridden_at: overriddenAt,
      updated_at: overriddenAt,
    })
    .where(eq(orders.id, id))
    .returning()

  await appendLedger({
    workspace_id: order.workspace_id,
    event_type: 'override',
    entity_type: 'order',
    entity_id: id,
    actor_id: userId,
    payload: {
      reason,
      previous_gate_status: order.gate_status,
      previous_block_reasons: order.block_reasons,
      reference: order.reference,
    },
  })

  return c.json(updated)
})

// ----------------------------------------------------------------------------
// DELETE /:id — delete order
// ----------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [order] = await db.select().from(orders).where(eq(orders.id, id))
  if (!order) return c.json({ error: 'Not found' }, 404)
  if (!(await getMember(order.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(order_parties).where(eq(order_parties.order_id, id))
  await db.delete(orders).where(eq(orders.id, id))
  return c.json({ success: true })
})

export default router
