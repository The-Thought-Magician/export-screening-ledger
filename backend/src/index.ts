import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import { plans, workspaces } from './db/schema.js'
import { eq } from 'drizzle-orm'

import workspacesRoutes from './routes/workspaces.js'
import membersRoutes from './routes/members.js'
import invitesRoutes from './routes/invites.js'
import partiesRoutes from './routes/parties.js'
import aliasesRoutes from './routes/aliases.js'
import listsRoutes from './routes/lists.js'
import listVersionsRoutes from './routes/listVersions.js'
import listEntriesRoutes from './routes/listEntries.js'
import screeningsRoutes from './routes/screenings.js'
import matchesRoutes from './routes/matches.js'
import rescreenRoutes from './routes/rescreen.js'
import ordersRoutes from './routes/orders.js'
import embargoesRoutes from './routes/embargoes.js'
import endUsesRoutes from './routes/endUses.js'
import allowlistRoutes from './routes/allowlist.js'
import ledgerRoutes from './routes/ledger.js'
import exportsRoutes from './routes/exports.js'
import notificationsRoutes from './routes/notifications.js'
import policiesRoutes from './routes/policies.js'
import segmentsRoutes from './routes/segments.js'
import reportsRoutes from './routes/reports.js'
import metricsRoutes from './routes/metrics.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://export-screening-ledger.vercel.app',
]

app.use('*', cors({
  origin: (origin) => allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
  credentials: true,
}))

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/members', membersRoutes)
api.route('/invites', invitesRoutes)
api.route('/parties', partiesRoutes)
api.route('/aliases', aliasesRoutes)
api.route('/lists', listsRoutes)
api.route('/list-versions', listVersionsRoutes)
api.route('/list-entries', listEntriesRoutes)
api.route('/screenings', screeningsRoutes)
api.route('/matches', matchesRoutes)
api.route('/rescreen', rescreenRoutes)
api.route('/orders', ordersRoutes)
api.route('/embargoes', embargoesRoutes)
api.route('/end-uses', endUsesRoutes)
api.route('/allowlist', allowlistRoutes)
api.route('/ledger', ledgerRoutes)
api.route('/exports', exportsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/policies', policiesRoutes)
api.route('/segments', segmentsRoutes)
api.route('/reports', reportsRoutes)
api.route('/metrics', metricsRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// Idempotent: seed billing plans (count-then-insert) + a demo workspace.
async function seedIfEmpty() {
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ]).onConflictDoNothing()
    console.log('Seeded plans')
  }

  const demoSlug = 'demo-workspace'
  const existingDemo = await db.select().from(workspaces).where(eq(workspaces.slug, demoSlug)).limit(1)
  if (existingDemo.length === 0) {
    await db.insert(workspaces).values({
      name: 'Demo Workspace',
      slug: demoSlug,
      created_by: 'system',
    }).onConflictDoNothing()
    console.log('Seeded demo workspace')
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, then run migrate() and seedIfEmpty() afterwards.
// A slow/cold DB connection must never block serve() and trip a deploy timeout.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

try {
  await migrate()
} catch (e) {
  console.error('Migrate error:', e)
}

try {
  await seedIfEmpty()
} catch (e) {
  console.error('Seed error:', e)
}

export default app
