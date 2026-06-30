import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  // --------------------------------------------------------------------------
  // Workspaces & membership
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'analyst',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS invites (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    email text NOT NULL,
    role text NOT NULL DEFAULT 'analyst',
    token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'pending',
    invited_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Parties
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS parties (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    party_type text NOT NULL DEFAULT 'customer',
    country text,
    address text,
    identifiers jsonb DEFAULT '{}'::jsonb,
    tags jsonb DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'unscreened',
    notes text,
    last_screened_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS party_aliases (
    id text PRIMARY KEY,
    party_id text NOT NULL REFERENCES parties(id),
    alias text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Lists, versions, entries
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS lists (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    source_authority text NOT NULL,
    list_type text NOT NULL DEFAULT 'denied',
    is_active boolean NOT NULL DEFAULT true,
    active_version_id text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS list_versions (
    id text PRIMARY KEY,
    list_id text NOT NULL REFERENCES lists(id),
    version_label text NOT NULL,
    content_hash text NOT NULL,
    entry_count integer NOT NULL DEFAULT 0,
    published_at timestamptz NOT NULL DEFAULT now(),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (list_id, version_label)
  )`,

  `CREATE TABLE IF NOT EXISTS list_entries (
    id text PRIMARY KEY,
    list_version_id text NOT NULL REFERENCES list_versions(id),
    name text NOT NULL,
    aliases jsonb DEFAULT '[]'::jsonb,
    entity_type text,
    country text,
    address text,
    program_codes jsonb DEFAULT '[]'::jsonb,
    remarks text,
    source_ref text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Screenings & matches
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS screenings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    party_id text NOT NULL REFERENCES parties(id),
    list_version_ids jsonb DEFAULT '[]'::jsonb,
    engine_config jsonb DEFAULT '{}'::jsonb,
    trigger text NOT NULL DEFAULT 'manual',
    match_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'complete',
    run_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS screening_matches (
    id text PRIMARY KEY,
    screening_id text NOT NULL REFERENCES screenings(id),
    party_id text NOT NULL REFERENCES parties(id),
    list_entry_id text NOT NULL REFERENCES list_entries(id),
    list_version_id text NOT NULL REFERENCES list_versions(id),
    score real NOT NULL,
    score_breakdown jsonb DEFAULT '{}'::jsonb,
    matched_name text NOT NULL,
    decision text NOT NULL DEFAULT 'pending',
    decision_reason text,
    reviewer_id text,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Re-screen cadence
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS rescreen_schedules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    party_id text REFERENCES parties(id),
    cadence text NOT NULL DEFAULT 'weekly',
    next_due_at timestamptz,
    last_run_at timestamptz,
    on_change boolean NOT NULL DEFAULT true,
    on_new_version boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Orders / transaction gate
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS orders (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    reference text NOT NULL,
    destination_country text,
    end_use text,
    value_cents integer DEFAULT 0,
    gate_status text NOT NULL DEFAULT 'draft',
    block_reasons jsonb DEFAULT '[]'::jsonb,
    override_reason text,
    override_by text,
    overridden_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS order_parties (
    id text PRIMARY KEY,
    order_id text NOT NULL REFERENCES orders(id),
    party_id text NOT NULL REFERENCES parties(id),
    role_on_order text NOT NULL DEFAULT 'buyer',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id, party_id, role_on_order)
  )`,

  // --------------------------------------------------------------------------
  // Embargoes & end-use rules
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS embargoed_countries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    country_code text NOT NULL,
    country_name text NOT NULL,
    embargo_type text NOT NULL DEFAULT 'comprehensive',
    notes text,
    is_active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, country_code)
  )`,

  `CREATE TABLE IF NOT EXISTS end_use_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    label text NOT NULL,
    keyword text NOT NULL,
    category text NOT NULL DEFAULT 'prohibited',
    action text NOT NULL DEFAULT 'block',
    notes text,
    is_active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Allowlist
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS allowlist_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    party_id text NOT NULL REFERENCES parties(id),
    list_entry_id text REFERENCES list_entries(id),
    reason text NOT NULL,
    expires_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Immutable ledger & exports
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    seq integer NOT NULL,
    event_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    actor_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    prev_hash text,
    hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, seq)
  )`,

  `CREATE TABLE IF NOT EXISTS exports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    scope text NOT NULL DEFAULT 'full',
    filters jsonb DEFAULT '{}'::jsonb,
    manifest_hash text NOT NULL,
    entry_count integer NOT NULL DEFAULT 0,
    payload jsonb DEFAULT '{}'::jsonb,
    generated_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Notifications, policies, segments, reports
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS policies (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    version integer NOT NULL DEFAULT 1,
    match_threshold real NOT NULL DEFAULT 0.85,
    auto_clear_floor real NOT NULL DEFAULT 0.5,
    weights jsonb DEFAULT '{}'::jsonb,
    four_eyes boolean NOT NULL DEFAULT false,
    default_cadence text NOT NULL DEFAULT 'weekly',
    is_active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, version)
  )`,

  `CREATE TABLE IF NOT EXISTS segments (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS reports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    report_type text NOT NULL,
    name text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb,
    snapshot jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // --------------------------------------------------------------------------
  // Billing
  // --------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invites_workspace ON invites(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_parties_workspace ON parties(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_parties_status ON parties(status)`,
  `CREATE INDEX IF NOT EXISTS idx_party_aliases_party ON party_aliases(party_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lists_workspace ON lists(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_list_versions_list ON list_versions(list_id)`,
  `CREATE INDEX IF NOT EXISTS idx_list_entries_version ON list_entries(list_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_screenings_workspace ON screenings(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_screenings_party ON screenings(party_id)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_screening ON screening_matches(screening_id)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_party ON screening_matches(party_id)`,
  `CREATE INDEX IF NOT EXISTS idx_matches_decision ON screening_matches(decision)`,
  `CREATE INDEX IF NOT EXISTS idx_rescreen_workspace ON rescreen_schedules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rescreen_party ON rescreen_schedules(party_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_workspace ON orders(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_gate_status ON orders(gate_status)`,
  `CREATE INDEX IF NOT EXISTS idx_order_parties_order ON order_parties(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_parties_party ON order_parties(party_id)`,
  `CREATE INDEX IF NOT EXISTS idx_embargoes_workspace ON embargoed_countries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_end_use_rules_workspace ON end_use_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_allowlist_workspace ON allowlist_entries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_allowlist_party ON allowlist_entries(party_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_workspace ON ledger_entries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exports_workspace ON exports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_workspace ON notifications(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_policies_workspace ON policies(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_segments_workspace ON segments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_workspace ON reports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const idx of indexes) {
    await db.execute(sql.raw(idx))
  }
  console.log('Migration complete: tables + indexes provisioned')
}
