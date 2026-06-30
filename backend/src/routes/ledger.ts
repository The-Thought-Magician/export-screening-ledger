import { Hono } from 'hono'
import { db } from '../db/index.js'
import { ledger_entries } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { verifyChain } from '../lib/ledger.js'

const router = new Hono()

// Public: list ledger entries for a workspace, newest first.
// Optional filters: ?entity_type, ?entity_id, ?event_type.
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')
  const eventType = c.req.query('event_type')

  const conds = [eq(ledger_entries.workspace_id, workspaceId)]
  if (entityType) conds.push(eq(ledger_entries.entity_type, entityType))
  if (entityId) conds.push(eq(ledger_entries.entity_id, entityId))
  if (eventType) conds.push(eq(ledger_entries.event_type, eventType))

  const rows = await db
    .select()
    .from(ledger_entries)
    .where(and(...conds))
    .orderBy(desc(ledger_entries.seq))

  return c.json(rows)
})

// Public: verify hash-chain integrity for a workspace.
// IMPORTANT: declared before '/:id' so it is not captured by the param route.
router.get('/verify', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const result = await verifyChain(workspaceId)
  return c.json(result)
})

// Public: single ledger entry by id.
router.get('/:id', async (c) => {
  const [row] = await db
    .select()
    .from(ledger_entries)
    .where(eq(ledger_entries.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

export default router
