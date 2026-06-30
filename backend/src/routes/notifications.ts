import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Auth: the current user's notifications for a workspace, newest first.
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.workspace_id, workspaceId),
        eq(notifications.user_id, userId),
      ),
    )
    .orderBy(desc(notifications.created_at))

  return c.json(rows)
})

// Auth: mark a single notification read (ownership-checked).
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(notifications)
    .set({ is_read: true })
    .where(eq(notifications.id, id))
    .returning()

  return c.json(updated)
})

// Auth: mark all of the current user's notifications in a workspace read.
router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const updatedRows = await db
    .update(notifications)
    .set({ is_read: true })
    .where(
      and(
        eq(notifications.workspace_id, workspaceId),
        eq(notifications.user_id, userId),
        eq(notifications.is_read, false),
      ),
    )
    .returning()

  return c.json({ updated: updatedRows.length })
})

export default router
