import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { party_aliases, parties, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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

const addSchema = z.object({
  party_id: z.string().min(1),
  alias: z.string().min(1),
})

// ----------------------------------------------------------------------------
// GET / — public — aliases for ?party_id
// ----------------------------------------------------------------------------
router.get('/', async (c) => {
  const partyId = c.req.query('party_id')
  if (!partyId) return c.json({ error: 'party_id is required' }, 400)
  const rows = await db
    .select()
    .from(party_aliases)
    .where(eq(party_aliases.party_id, partyId))
    .orderBy(desc(party_aliases.created_at))
  return c.json(rows)
})

// ----------------------------------------------------------------------------
// POST / — auth — add alias to party
// ----------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', addSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [party] = await db.select().from(parties).where(eq(parties.id, body.party_id))
  if (!party) return c.json({ error: 'Party not found' }, 404)
  if (!(await isMember(party.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [alias] = await db
    .insert(party_aliases)
    .values({ party_id: body.party_id, alias: body.alias })
    .returning()
  return c.json(alias, 201)
})

// ----------------------------------------------------------------------------
// DELETE /:id — auth — delete alias
// ----------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [alias] = await db.select().from(party_aliases).where(eq(party_aliases.id, id))
  if (!alias) return c.json({ error: 'Not found' }, 404)

  const [party] = await db.select().from(parties).where(eq(parties.id, alias.party_id))
  if (!party) return c.json({ error: 'Party not found' }, 404)
  if (!(await isMember(party.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(party_aliases).where(eq(party_aliases.id, id))
  return c.json({ success: true })
})

export default router
