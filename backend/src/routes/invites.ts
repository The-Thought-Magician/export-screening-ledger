import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { invites, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ROLES = ['admin', 'reviewer', 'analyst', 'viewer'] as const

const createSchema = z.object({
  workspace_id: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES).optional().default('analyst'),
})

const acceptSchema = z.object({
  token: z.string().min(1),
})

// Helper: is the user an admin of the workspace?
async function isAdmin(workspaceId: string, userId: string): Promise<boolean> {
  if (!userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m && m.role === 'admin'
}

// GET / — public — list invites for ?workspace_id
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.workspace_id, workspaceId))
    .orderBy(desc(invites.created_at))
  return c.json(rows)
})

// POST / — auth+role(admin) — create invite (email, role)
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isAdmin(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const token = crypto.randomUUID()
  const [inv] = await db
    .insert(invites)
    .values({
      workspace_id: body.workspace_id,
      email: body.email,
      role: body.role,
      token,
      status: 'pending',
      invited_by: userId,
    })
    .returning()
  return c.json(inv, 201)
})

// POST /accept — auth — accept invite by token, create membership
router.post('/accept', authMiddleware, zValidator('json', acceptSchema), async (c) => {
  const userId = getUserId(c)
  const { token } = c.req.valid('json')

  const [inv] = await db.select().from(invites).where(eq(invites.token, token))
  if (!inv) return c.json({ error: 'Invalid invite token' }, 404)
  if (inv.status !== 'pending') return c.json({ error: `Invite is ${inv.status}` }, 409)

  // If already a member, just mark accepted and return existing membership.
  const [existingMember] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, inv.workspace_id),
        eq(workspace_members.user_id, userId),
      ),
    )

  if (existingMember) {
    await db.update(invites).set({ status: 'accepted' }).where(eq(invites.id, inv.id))
    return c.json(existingMember)
  }

  const [member] = await db
    .insert(workspace_members)
    .values({ workspace_id: inv.workspace_id, user_id: userId, role: inv.role })
    .returning()

  await db.update(invites).set({ status: 'accepted' }).where(eq(invites.id, inv.id))

  return c.json(member, 201)
})

// DELETE /:id — auth+role(admin) — revoke invite
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(invites).where(eq(invites.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isAdmin(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.update(invites).set({ status: 'revoked' }).where(eq(invites.id, id))
  return c.json({ success: true })
})

export default router
