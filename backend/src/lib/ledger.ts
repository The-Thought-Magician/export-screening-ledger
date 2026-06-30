// ----------------------------------------------------------------------------
// ledger.ts — hash-chain helper for the immutable audit ledger.
//
// appendLedger computes the next seq for a workspace, links to the previous
// entry's hash, and stores a SHA-256 hash over the canonical entry content.
// This makes the ledger tamper-evident: any retroactive edit breaks the chain.
// ----------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { eq, desc, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { ledger_entries } from '../db/schema.js'

export interface AppendLedgerInput {
  workspace_id: string
  event_type: string
  entity_type: string
  entity_id: string
  actor_id: string
  payload?: Record<string, unknown>
}

function computeHash(input: {
  workspace_id: string
  seq: number
  event_type: string
  entity_type: string
  entity_id: string
  actor_id: string
  payload: Record<string, unknown>
  prev_hash: string | null
}): string {
  // Canonical, order-stable serialization of the fields that make up the entry.
  const canonical = JSON.stringify({
    workspace_id: input.workspace_id,
    seq: input.seq,
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    actor_id: input.actor_id,
    payload: input.payload ?? {},
    prev_hash: input.prev_hash,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Append a new entry to a workspace's hash chain and return the inserted row.
 */
export async function appendLedger(input: AppendLedgerInput) {
  const [last] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, input.workspace_id))
    .orderBy(desc(ledger_entries.seq))
    .limit(1)

  const seq = (last?.seq ?? 0) + 1
  const prev_hash = last?.hash ?? null
  const payload = input.payload ?? {}

  const hash = computeHash({
    workspace_id: input.workspace_id,
    seq,
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    actor_id: input.actor_id,
    payload,
    prev_hash,
  })

  const [row] = await db
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

  return row
}

/**
 * Walk a workspace's chain in seq order and confirm every link's hash matches
 * a freshly recomputed hash and references the previous entry. Returns the seq
 * of the first broken link, or null if intact.
 */
export async function verifyChain(workspace_id: string): Promise<{ ok: boolean; broken_at: number | null }> {
  const rows = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.workspace_id, workspace_id))
    .orderBy(ledger_entries.seq)

  let prev_hash: string | null = null
  for (const r of rows) {
    const expected = computeHash({
      workspace_id: r.workspace_id,
      seq: r.seq,
      event_type: r.event_type,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      actor_id: r.actor_id,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      prev_hash,
    })
    if (r.prev_hash !== prev_hash || r.hash !== expected) {
      return { ok: false, broken_at: r.seq }
    }
    prev_hash = r.hash
  }
  return { ok: true, broken_at: null }
}

export { and }
