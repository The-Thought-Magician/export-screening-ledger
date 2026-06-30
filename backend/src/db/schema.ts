import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ----------------------------------------------------------------------------
// Workspaces & membership
// ----------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('analyst'), // admin | reviewer | analyst | viewer
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

export const invites = pgTable('invites', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  email: text('email').notNull(),
  role: text('role').notNull().default('analyst'),
  token: text('token').notNull().unique(),
  status: text('status').notNull().default('pending'), // pending | accepted | revoked
  invited_by: text('invited_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Parties
// ----------------------------------------------------------------------------

export const parties = pgTable('parties', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  party_type: text('party_type').notNull().default('customer'), // customer | supplier | intermediary | end_user | forwarder
  country: text('country'),
  address: text('address'),
  identifiers: jsonb('identifiers').$type<Record<string, string>>().default({}),
  tags: jsonb('tags').$type<string[]>().default([]),
  status: text('status').notNull().default('unscreened'), // unscreened | clear | flagged | blocked | needs_rescreen
  notes: text('notes'),
  last_screened_at: timestamp('last_screened_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const party_aliases = pgTable('party_aliases', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  party_id: text('party_id').notNull().references(() => parties.id),
  alias: text('alias').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Lists, versions, entries
// ----------------------------------------------------------------------------

export const lists = pgTable('lists', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  source_authority: text('source_authority').notNull(), // OFAC_SDN | BIS_ENTITY | BIS_DPL | EU_CONSOLIDATED | UN | CUSTOM
  list_type: text('list_type').notNull().default('denied'), // denied | restricted | custom
  is_active: boolean('is_active').notNull().default(true),
  active_version_id: text('active_version_id'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const list_versions = pgTable('list_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  list_id: text('list_id').notNull().references(() => lists.id),
  version_label: text('version_label').notNull(),
  content_hash: text('content_hash').notNull(),
  entry_count: integer('entry_count').notNull().default(0),
  published_at: timestamp('published_at').defaultNow().notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.list_id, t.version_label)])

export const list_entries = pgTable('list_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  list_version_id: text('list_version_id').notNull().references(() => list_versions.id),
  name: text('name').notNull(),
  aliases: jsonb('aliases').$type<string[]>().default([]),
  entity_type: text('entity_type'),
  country: text('country'),
  address: text('address'),
  program_codes: jsonb('program_codes').$type<string[]>().default([]),
  remarks: text('remarks'),
  source_ref: text('source_ref'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Screenings & matches
// ----------------------------------------------------------------------------

export const screenings = pgTable('screenings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  party_id: text('party_id').notNull().references(() => parties.id),
  list_version_ids: jsonb('list_version_ids').$type<string[]>().default([]),
  engine_config: jsonb('engine_config').$type<Record<string, unknown>>().default({}),
  trigger: text('trigger').notNull().default('manual'), // manual | scheduled | party_change | new_version
  match_count: integer('match_count').notNull().default(0),
  status: text('status').notNull().default('complete'), // complete | pending_adjudication
  run_by: text('run_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const screening_matches = pgTable('screening_matches', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  screening_id: text('screening_id').notNull().references(() => screenings.id),
  party_id: text('party_id').notNull().references(() => parties.id),
  list_entry_id: text('list_entry_id').notNull().references(() => list_entries.id),
  list_version_id: text('list_version_id').notNull().references(() => list_versions.id),
  score: real('score').notNull(),
  score_breakdown: jsonb('score_breakdown').$type<Record<string, unknown>>().default({}),
  matched_name: text('matched_name').notNull(),
  decision: text('decision').notNull().default('pending'), // pending | cleared | blocked | escalated
  decision_reason: text('decision_reason'),
  reviewer_id: text('reviewer_id'),
  decided_at: timestamp('decided_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Re-screen cadence
// ----------------------------------------------------------------------------

export const rescreen_schedules = pgTable('rescreen_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  party_id: text('party_id').references(() => parties.id), // null => workspace default
  cadence: text('cadence').notNull().default('weekly'), // daily | weekly | monthly | quarterly
  next_due_at: timestamp('next_due_at'),
  last_run_at: timestamp('last_run_at'),
  on_change: boolean('on_change').notNull().default(true),
  on_new_version: boolean('on_new_version').notNull().default(true),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Orders / transaction gate
// ----------------------------------------------------------------------------

export const orders = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  reference: text('reference').notNull(),
  destination_country: text('destination_country'),
  end_use: text('end_use'),
  value_cents: integer('value_cents').default(0),
  gate_status: text('gate_status').notNull().default('draft'), // draft | blocked | pending_review | released | overridden
  block_reasons: jsonb('block_reasons').$type<string[]>().default([]),
  override_reason: text('override_reason'),
  override_by: text('override_by'),
  overridden_at: timestamp('overridden_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const order_parties = pgTable('order_parties', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  order_id: text('order_id').notNull().references(() => orders.id),
  party_id: text('party_id').notNull().references(() => parties.id),
  role_on_order: text('role_on_order').notNull().default('buyer'), // buyer | consignee | end_user | intermediary
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.order_id, t.party_id, t.role_on_order)])

// ----------------------------------------------------------------------------
// Embargoes & end-use rules
// ----------------------------------------------------------------------------

export const embargoed_countries = pgTable('embargoed_countries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  country_code: text('country_code').notNull(),
  country_name: text('country_name').notNull(),
  embargo_type: text('embargo_type').notNull().default('comprehensive'), // comprehensive | targeted | arms
  notes: text('notes'),
  is_active: boolean('is_active').notNull().default(true),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.country_code)])

export const end_use_rules = pgTable('end_use_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  label: text('label').notNull(),
  keyword: text('keyword').notNull(),
  category: text('category').notNull().default('prohibited'), // prohibited | restricted | watch
  action: text('action').notNull().default('block'), // block | flag
  notes: text('notes'),
  is_active: boolean('is_active').notNull().default(true),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Allowlist (suppressed false positives)
// ----------------------------------------------------------------------------

export const allowlist_entries = pgTable('allowlist_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  party_id: text('party_id').notNull().references(() => parties.id),
  list_entry_id: text('list_entry_id').references(() => list_entries.id),
  reason: text('reason').notNull(),
  expires_at: timestamp('expires_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Immutable ledger & exports
// ----------------------------------------------------------------------------

export const ledger_entries = pgTable('ledger_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  seq: integer('seq').notNull(),
  event_type: text('event_type').notNull(), // screening | adjudication | override | list_activation | status_change | policy_change | export
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  actor_id: text('actor_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  prev_hash: text('prev_hash'),
  hash: text('hash').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.seq)])

export const exports = pgTable('exports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  scope: text('scope').notNull().default('full'), // full | filtered
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  manifest_hash: text('manifest_hash').notNull(),
  entry_count: integer('entry_count').notNull().default(0),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  generated_by: text('generated_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Notifications, policies, segments, reports
// ----------------------------------------------------------------------------

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  kind: text('kind').notNull(), // match | order_blocked | rescreen_due | list_version | escalation
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  is_read: boolean('is_read').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const policies = pgTable('policies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  version: integer('version').notNull().default(1),
  match_threshold: real('match_threshold').notNull().default(0.85),
  auto_clear_floor: real('auto_clear_floor').notNull().default(0.5),
  weights: jsonb('weights').$type<Record<string, number>>().default({}),
  four_eyes: boolean('four_eyes').notNull().default(false),
  default_cadence: text('default_cadence').notNull().default('weekly'),
  is_active: boolean('is_active').notNull().default(true),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.version)])

export const segments = pgTable('segments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const reports = pgTable('reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  report_type: text('report_type').notNull(), // open_matches | blocked_orders | rescreen_compliance | reviewer_activity
  name: text('name').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().default({}),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ----------------------------------------------------------------------------
// Billing
// ----------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'free' | 'pro'
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
