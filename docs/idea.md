# Export Screening Ledger

## Overview

Export Screening Ledger (ESL) is a continuous restricted-party screening and decision-of-record system for export-compliance teams. It maintains a register of every customer, partner, intermediary, and end user; screens each one against denied/restricted-party lists (OFAC SDN, BIS Entity List, EU Consolidated, UN, plus custom internal lists) using deterministic fuzzy name matching; and forces every potential match through a structured adjudication workflow (Cleared / Blocked / Escalated) with a required reason and a named reviewer.

Beyond one-off screening, ESL runs a re-screening cadence (lists change weekly) and re-screens automatically whenever a party record changes. It gates orders and transactions on unresolved parties, supports override-with-justification, and flags embargoed destinations and prohibited end uses. Every action is written to an append-only, timestamped, hash-chained decision ledger that records the exact list version used, producing a defensible audit trail and a one-click immutable export for auditors, enforcement inquiries, and voluntary self-disclosures.

The product is fully deterministic (no opaque ML scores): matching, scoring, and decisioning are reproducible and explainable, which is exactly what a compliance auditor demands. A built-in synthetic data seeder generates parties, lists, near-match decoys, orders, and screening history so the platform is demoable on first sign-in.

## Problem

OFAC, BIS, and EU restricted-party and embargoed-country screening is **continuous** (lists change weekly), **list-driven** (you must screen against the current authoritative lists), and **liability-bearing** (penalties run six-to-seven figures and attach personally to the compliance officer). Yet most small and mid-market exporters do this in spreadsheets:

- No defensible audit trail: who screened whom, against which list version, on what date, and why a match was cleared.
- No re-screening cadence: a party cleared last quarter may be on this week's SDN list.
- No transaction gate: orders ship to parties that were never resolved.
- No immutability: a spreadsheet can be edited after the fact, which destroys its evidentiary value.
- No explainability: a cleared "false positive" has no recorded reasoning, so it cannot survive an audit.

When an audit, enforcement inquiry, or self-disclosure hits, the team cannot reconstruct what it knew and when. One avoided fine or one defensible disclosure dwarfs the cost of the tool.

## Target Users

- **Trade-compliance officers** and **export-control managers** at manufacturers, hardware, semiconductor, aerospace, defense-adjacent, and B2B tech companies that ship across borders.
- **Buyer:** the trade-compliance officer / export-control manager who carries personal liability for sanctions and export violations and controls a compliance-tooling budget.
- **Secondary users:** order-desk and sales-ops staff who must check whether a party is cleared before shipping, and outside counsel / auditors who consume the exported ledger.

## Why this is NOT an existing project

Near-neighbors and how ESL differs:

- **Sanctions-list-aggregator (a list feed):** that product *ships you the lists*. ESL *consumes* lists and is about the per-party, per-decision adjudication ledger, the re-screen cadence, and the transaction gate. The list is an input, not the product.
- **Anti-money-laundering / transaction-monitoring (KYC/AML):** AML is financial — it monitors money flows, suspicious-activity patterns, and SAR filing for banks/fintechs. ESL is **export** restricted-party screening: name-against-denied-party-list matching, end-use/destination control, and an export-compliance audit record. Different lists, different regulators (OFAC/BIS/EU export vs FinCEN), different deliverable (a defensible screening decision, not a SAR).
- **Breach-notification-clock (nearest sibling in the portfolio):** both are "defensible-record compliance" systems, but breach-notification-clock tracks *post-incident notification deadlines and clocks*. ESL tracks *pre-transaction party screening and adjudication*. No overlap in domain model (incidents/clocks vs parties/matches/screenings).
- **Generic CRM / vendor-management:** those store parties but do not screen them against denied-party lists, do not adjudicate matches, and produce no immutable decision-of-record.

ESL's defensible moat is the combination of: deterministic explainable matching + structured adjudication ledger (append-only, hash-chained, list-versioned) + re-screen cadence + transaction gate + immutable export. No single near-neighbor offers that bundle for export compliance.

## Major Features

### 1. Party Register
- CRUD for parties (customers, suppliers, intermediaries, end users, freight forwarders).
- Party types, aliases / also-known-as names, addresses, countries, identifiers (DUNS, tax ID, registration number).
- Party status lifecycle: `unscreened`, `clear`, `flagged`, `blocked`, `needs_rescreen`.
- Bulk CSV import of parties; field mapping; import error report.
- Party tags, ownership (created_by), and free-text notes.
- Per-party screening history and current risk posture at a glance.

### 2. Restricted-Party / Denied-Party Lists
- Maintained lists with provenance: source authority (OFAC SDN, BIS Entity List, BIS Denied Persons, EU Consolidated, UN Consolidated, custom internal).
- **List versions**: each refresh creates an immutable, dated version with a content hash; screenings record the exact version used.
- List entries: name, aliases, entity type, addresses, countries, program codes (e.g., SDGT, IRAN-EO13846), remarks.
- Import a list version from CSV; activate / deactivate lists.
- Custom internal denied lists (company watchlists, prior-violators).
- Diff between two list versions (added / removed / changed entries).

### 3. Deterministic Fuzzy Name Matching
- Deterministic, reproducible matching engine: normalized token comparison, Jaro-Winkler / Levenshtein-based similarity (pure functions, no randomness).
- Configurable match threshold and algorithm weights per workspace.
- Alias-aware: matches party aliases against list entry aliases.
- Country / address corroboration to boost or dampen a match.
- Every match carries an explainable score breakdown (which tokens matched, which algorithm, what weight) so it can be defended in an audit.

### 4. Match Adjudication Workflow
- Each candidate match becomes a `screening_match` requiring a decision: **Cleared**, **Blocked**, or **Escalated**.
- Required free-text reason and a named reviewer on every decision.
- Escalation routes to a reviewer queue; escalated matches can later be cleared/blocked by a second reviewer (four-eyes).
- Adjudication updates the party status and is written to the immutable ledger.
- Re-open / re-adjudicate with full history retained (never destructive).

### 5. Screening Runs
- Run a screening of one party, a selected set, or the whole register against one or more active lists.
- A `screening` record captures: party, lists used (with versions), engine config, timestamp, who ran it, and the resulting matches.
- Manual run, scheduled run, and event-triggered run (on party change).
- Run summary: parties screened, matches found, auto-cleared (below threshold), pending adjudication.

### 6. Re-Screening Cadence
- Per-workspace and per-party re-screen schedules (daily / weekly / monthly / quarterly).
- Automatic re-screen when a party's screenable fields change (name, alias, address, country).
- Automatic re-screen when a list a party was cleared against publishes a new version.
- "Due for re-screen" queue with overdue highlighting.
- Cadence policy editor.

### 7. Order / Transaction Gate
- Orders/transactions reference one or more parties; the gate blocks an order if any referenced party is `flagged`, `blocked`, or `needs_rescreen`.
- Order status: `draft`, `blocked`, `pending_review`, `released`, `overridden`.
- **Override-with-justification**: a privileged user can release a gated order with a required justification and reviewer, written to the ledger.
- Gate evaluation is recomputed whenever party status changes.

### 8. End-Use & Embargoed-Destination Flags
- Embargoed / sanctioned country registry (e.g., comprehensive vs targeted).
- Flag orders shipping to embargoed destinations.
- End-use screening: prohibited end uses (military, WMD, nuclear) captured per order; flagged end uses block the gate.
- Destination + end-use rules editor; license-exception/notes field.

### 9. Immutable Decision Ledger
- Append-only `ledger_entries` table: every screening, adjudication, override, list activation, and status change.
- **Hash chaining**: each entry stores a hash of its content plus the previous entry's hash, so tampering is detectable.
- Records the list version, engine config, actor, timestamp, and before/after state.
- Ledger is never updated or deleted — corrections are new entries.

### 10. Immutable Audit Export
- One-click export of the full decision history (or a filtered slice) as a defensible bundle.
- Export records: parties, screenings, matches + adjudications, overrides, list versions used, and the hash chain for verification.
- Export manifest with a top-level hash and generation timestamp.
- Export history (who exported what, when).

### 11. Screening Metrics Dashboard
- KPIs: parties by status, open matches, overdue re-screens, blocked orders, adjudication throughput, false-positive rate.
- Trend charts: screenings over time, matches adjudicated per reviewer, time-to-adjudicate.
- Risk heat: parties/countries with the most matches.

### 12. Synthetic Data Seeder
- Generate a realistic demo workspace: parties, denied-party lists with versions, **near-match decoys** (names deliberately close to list entries to exercise the matcher), orders, screenings, matches, and adjudications.
- Configurable volume and "noise" level.
- One-click reset/regenerate so the platform is demoable instantly.

### 13. Reviewer Queue & Workload
- Central queue of pending adjudications and escalations.
- Assignment to reviewers; per-reviewer workload and SLA aging.
- Bulk triage of obvious false positives (still requires reason).

### 14. Watchlist / Custom Rules
- Workspace-defined custom denied entries and allow-list (known-good) entries.
- Allow-listing a party against a specific list entry to suppress a recurring known false positive (recorded with reason + expiry).

### 15. Notifications & Alerts
- In-app notifications: new high-score match, order blocked, re-screen overdue, list version published, escalation assigned.
- Mark read / unread; notification preferences.

### 16. Policy & Threshold Settings
- Workspace screening policy: match threshold, algorithm weights, auto-clear floor, required-reviewer rules, four-eyes toggle.
- Cadence defaults and embargo policy.
- Versioned policy changes (recorded to ledger).

### 17. Reports
- Pre-built reports: open-matches report, blocked-orders report, re-screen-compliance report, reviewer-activity report.
- Filter by date range, list, country, reviewer; export to CSV.

### 18. Activity / Audit Trail (UI view)
- Human-readable, filterable view over the ledger entries.
- Per-party, per-order, per-reviewer activity timelines.

### 19. List Version Management
- Browse list versions, see entry counts, activate a version for screening.
- View which parties were last screened against which version.
- Re-screen-on-new-version trigger.

### 20. Workspace Members & Roles
- Members of a workspace with roles: `admin`, `reviewer`, `analyst`, `viewer`.
- Role gates: only reviewers/admins adjudicate; only admins override the gate and change policy.
- Invite by email (token), accept invite.

### 21. Saved Searches & Party Segments
- Save party filters as named segments (e.g., "China end users", "needs_rescreen this week").
- Run a screening over a segment.

### 22. Billing (Stripe-optional)
- Free plan: all features enabled for signed-in users.
- Pro plan present in schema; checkout/portal/webhook return 503 when Stripe is unconfigured.
- Plan + subscription surfaced on a pricing/settings page.

## Data Model (tables)

- `workspaces` — tenant container.
- `workspace_members` — user ↔ workspace, role.
- `invites` — pending workspace invites (email, token, role).
- `parties` — screened entities.
- `party_aliases` — alternate names per party.
- `lists` — denied/restricted-party lists (source authority, type).
- `list_versions` — immutable dated versions of a list, content hash.
- `list_entries` — entries within a list version.
- `screenings` — a screening run (party, lists/versions, config, actor).
- `screening_matches` — candidate matches with explainable score + adjudication.
- `rescreen_schedules` — cadence per workspace/party.
- `orders` — transactions referencing parties, gate status.
- `order_parties` — join of orders ↔ parties with role on the order.
- `embargoed_countries` — embargo registry.
- `end_use_rules` — prohibited end-use definitions.
- `allowlist_entries` — suppressed known false positives.
- `ledger_entries` — append-only hash-chained decision ledger.
- `exports` — generated audit export bundles + manifest hash.
- `notifications` — per-user in-app notifications.
- `policies` — versioned workspace screening policy.
- `segments` — saved party filters.
- `reports` — saved/generated report definitions and snapshots.
- `plans` — billing plans (free/pro).
- `subscriptions` — per-user subscription state.

## API Surface (high level)

`/api/v1` mount with child routers: `workspaces`, `members`, `invites`, `parties`, `aliases`, `lists`, `list-versions`, `list-entries`, `screenings`, `matches`, `rescreen`, `orders`, `embargoes`, `end-uses`, `allowlist`, `ledger`, `exports`, `notifications`, `policies`, `segments`, `reports`, `metrics`, `seed`, `billing`. Public reads, auth-gated writes with zod validation and ownership/role checks.

## Frontend Pages (~24)

Public: landing (`/`), pricing (`/pricing`), sign-in, sign-up.

Dashboard (`/dashboard/*`): overview/metrics, parties list, party detail, party new, lists, list detail (versions), list version detail, screenings, screening detail, run screening, matches/adjudication queue, match detail, re-screen queue, orders, order detail, embargoes & end-use rules, allowlist, ledger/activity, exports, reports, notifications, policy settings, members & invites, segments, settings/billing.

Each dashboard page is wrapped by a shared `DashboardLayout` sidebar grouping: Overview, Screening (Parties, Matches, Screenings, Re-screen), Lists (Lists, List Versions, Allowlist), Orders (Orders, Embargoes & End Uses), Record (Ledger, Exports, Reports), Admin (Members, Policy, Segments, Settings).
