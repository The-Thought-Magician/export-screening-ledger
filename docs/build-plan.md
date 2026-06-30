# Export Screening Ledger — Build Plan (Authoritative Build Contract)

This is the single source of truth. Filenames, mount paths, api method names, and page
files declared here are binding. Stack: Hono + TypeScript backend, drizzle-orm + Neon,
Next.js 16 + Neon Auth frontend. Auth: backend trusts `X-User-Id`, handlers use
`getUserId(c)`. Routes mount under `/api/v1` via a child Hono `api` router. Every domain
route file does `export default router`. Public reads / auth-gated writes with zod
validation and ownership/role checks. Frontend calls `fetch('/api/proxy/<path>')` mapping
1:1 to `/api/v1/<path>`.

---

## (a) Tables (columns)

- **workspaces** — id, name, slug(unique), created_by, created_at
- **workspace_members** — id, workspace_id→workspaces, user_id, role(admin|reviewer|analyst|viewer), created_at; UNIQUE(workspace_id,user_id)
- **invites** — id, workspace_id→workspaces, email, role, token(unique), status, invited_by, created_at
- **parties** — id, workspace_id→workspaces, name, party_type, country, address, identifiers(jsonb{}), tags(jsonb[]), status(unscreened|clear|flagged|blocked|needs_rescreen), notes, last_screened_at, created_by, created_at, updated_at
- **party_aliases** — id, party_id→parties, alias, created_at
- **lists** — id, workspace_id→workspaces, name, source_authority, list_type, is_active, active_version_id, created_by, created_at
- **list_versions** — id, list_id→lists, version_label, content_hash, entry_count, published_at, created_by, created_at; UNIQUE(list_id,version_label)
- **list_entries** — id, list_version_id→list_versions, name, aliases(jsonb[]), entity_type, country, address, program_codes(jsonb[]), remarks, source_ref, created_at
- **screenings** — id, workspace_id→workspaces, party_id→parties, list_version_ids(jsonb[]), engine_config(jsonb{}), trigger, match_count, status, run_by, created_at
- **screening_matches** — id, screening_id→screenings, party_id→parties, list_entry_id→list_entries, list_version_id→list_versions, score(real), score_breakdown(jsonb{}), matched_name, decision(pending|cleared|blocked|escalated), decision_reason, reviewer_id, decided_at, created_at
- **rescreen_schedules** — id, workspace_id→workspaces, party_id→parties(nullable), cadence, next_due_at, last_run_at, on_change, on_new_version, created_by, created_at
- **orders** — id, workspace_id→workspaces, reference, destination_country, end_use, value_cents, gate_status(draft|blocked|pending_review|released|overridden), block_reasons(jsonb[]), override_reason, override_by, overridden_at, created_by, created_at, updated_at
- **order_parties** — id, order_id→orders, party_id→parties, role_on_order, created_at; UNIQUE(order_id,party_id,role_on_order)
- **embargoed_countries** — id, workspace_id→workspaces, country_code, country_name, embargo_type, notes, is_active, created_by, created_at; UNIQUE(workspace_id,country_code)
- **end_use_rules** — id, workspace_id→workspaces, label, keyword, category, action, notes, is_active, created_by, created_at
- **allowlist_entries** — id, workspace_id→workspaces, party_id→parties, list_entry_id→list_entries(nullable), reason, expires_at, created_by, created_at
- **ledger_entries** — id, workspace_id→workspaces, seq, event_type, entity_type, entity_id, actor_id, payload(jsonb{}), prev_hash, hash, created_at; UNIQUE(workspace_id,seq)
- **exports** — id, workspace_id→workspaces, scope, filters(jsonb{}), manifest_hash, entry_count, payload(jsonb{}), generated_by, created_at
- **notifications** — id, workspace_id→workspaces, user_id, kind, title, body, link, is_read, created_at
- **policies** — id, workspace_id→workspaces, version, match_threshold(real), auto_clear_floor(real), weights(jsonb{}), four_eyes, default_cadence, is_active, created_by, created_at; UNIQUE(workspace_id,version)
- **segments** — id, workspace_id→workspaces, name, filters(jsonb{}), created_by, created_at
- **reports** — id, workspace_id→workspaces, report_type, name, params(jsonb{}), snapshot(jsonb{}), created_by, created_at
- **plans** — id(text 'free'|'pro'), name, price_cents
- **subscriptions** — id, user_id(unique), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under `/api/v1`)

Auth legend: **public** = no auth; **auth** = `authMiddleware`; **role** = additional role check (reviewer/admin).

### `workspaces.ts` → mount `workspaces`
- `GET /` — auth — list workspaces the user is a member of — `Workspace[]`
- `GET /:id` — public — workspace detail — `Workspace`
- `POST /` — auth — create workspace (creator becomes admin member, seeds default policy) — `Workspace`
- `PUT /:id` — auth+role(admin) — rename workspace — `Workspace`
- `DELETE /:id` — auth+role(admin) — delete workspace — `{success}`

### `members.ts` → mount `members`
- `GET /` — public — list members of `?workspace_id` — `Member[]`
- `POST /` — auth+role(admin) — add member by user_id+role — `Member`
- `PUT /:id` — auth+role(admin) — change member role — `Member`
- `DELETE /:id` — auth+role(admin) — remove member — `{success}`

### `invites.ts` → mount `invites`
- `GET /` — public — list invites for `?workspace_id` — `Invite[]`
- `POST /` — auth+role(admin) — create invite (email, role) — `Invite`
- `POST /accept` — auth — accept invite by token, create membership — `Member`
- `DELETE /:id` — auth+role(admin) — revoke invite — `{success}`

### `parties.ts` → mount `parties`
- `GET /` — public — list parties for `?workspace_id` (filter `?status`,`?q`) — `Party[]`
- `GET /:id` — public — party detail (+aliases, screening history) — `PartyDetail`
- `POST /` — auth — create party (writes ledger status_change) — `Party`
- `PUT /:id` — auth — update party (triggers on_change re-screen flag) — `Party`
- `DELETE /:id` — auth — delete party — `{success}`
- `POST /import` — auth — bulk CSV import (array of rows) — `{created, errors}`

### `aliases.ts` → mount `aliases`
- `GET /` — public — aliases for `?party_id` — `Alias[]`
- `POST /` — auth — add alias to party — `Alias`
- `DELETE /:id` — auth — delete alias — `{success}`

### `lists.ts` → mount `lists`
- `GET /` — public — lists for `?workspace_id` — `List[]`
- `GET /:id` — public — list detail (+versions summary) — `ListDetail`
- `POST /` — auth — create list — `List`
- `PUT /:id` — auth — update list (name, active_version_id, is_active) — `List`
- `DELETE /:id` — auth — delete list — `{success}`

### `listVersions.ts` → mount `list-versions`
- `GET /` — public — versions for `?list_id` — `ListVersion[]`
- `GET /:id` — public — version detail (+entry count) — `ListVersion`
- `POST /` — auth — create version from entries[] (computes content_hash, writes list_activation ledger) — `ListVersion`
- `POST /:id/activate` — auth — set as list's active_version_id (writes ledger, flags affected parties needs_rescreen) — `List`
- `GET /:id/diff` — public — diff vs `?other` version (added/removed/changed) — `{added,removed,changed}`

### `listEntries.ts` → mount `list-entries`
- `GET /` — public — entries for `?list_version_id` (filter `?q`) — `ListEntry[]`
- `GET /:id` — public — entry detail — `ListEntry`
- `POST /` — auth — add entry to a version — `ListEntry`
- `DELETE /:id` — auth — delete entry — `{success}`

### `screenings.ts` → mount `screenings`
- `GET /` — public — screenings for `?workspace_id` (filter `?party_id`) — `Screening[]`
- `GET /:id` — public — screening detail (+matches) — `ScreeningDetail`
- `POST /run` — auth — run screening for a party against active lists (deterministic match engine, creates matches, writes ledger) — `ScreeningDetail`
- `POST /run-segment` — auth — run screening over a saved segment / all parties — `{screenings, total_matches}`

### `matches.ts` → mount `matches`
- `GET /` — public — matches for `?workspace_id` (filter `?decision`,`?party_id`) — `Match[]`
- `GET /:id` — public — match detail (+score breakdown, list entry) — `MatchDetail`
- `POST /:id/adjudicate` — auth+role(reviewer) — decide cleared|blocked|escalated with reason+reviewer (updates party status, writes ledger) — `Match`
- `GET /queue` — public — pending+escalated adjudication queue for `?workspace_id` — `Match[]`

### `rescreen.ts` → mount `rescreen`
- `GET /schedules` — public — schedules for `?workspace_id` — `RescreenSchedule[]`
- `POST /schedules` — auth — create/update a schedule (workspace default or per-party) — `RescreenSchedule`
- `PUT /schedules/:id` — auth — update cadence/flags — `RescreenSchedule`
- `DELETE /schedules/:id` — auth — delete schedule — `{success}`
- `GET /due` — public — parties due/overdue for re-screen for `?workspace_id` — `Party[]`

### `orders.ts` → mount `orders`
- `GET /` — public — orders for `?workspace_id` (filter `?gate_status`) — `Order[]`
- `GET /:id` — public — order detail (+parties, gate evaluation) — `OrderDetail`
- `POST /` — auth — create order with parties[] (evaluates gate, writes ledger) — `OrderDetail`
- `PUT /:id` — auth — update order (re-evaluates gate) — `OrderDetail`
- `POST /:id/evaluate` — auth — recompute gate status from party statuses + embargo + end-use — `OrderDetail`
- `POST /:id/override` — auth+role(admin) — release gated order with justification (writes ledger) — `Order`
- `DELETE /:id` — auth — delete order — `{success}`

### `embargoes.ts` → mount `embargoes`
- `GET /` — public — embargoed countries for `?workspace_id` — `Embargo[]`
- `POST /` — auth — add embargoed country — `Embargo`
- `PUT /:id` — auth — update embargo — `Embargo`
- `DELETE /:id` — auth — delete embargo — `{success}`

### `endUses.ts` → mount `end-uses`
- `GET /` — public — end-use rules for `?workspace_id` — `EndUseRule[]`
- `POST /` — auth — add end-use rule — `EndUseRule`
- `PUT /:id` — auth — update rule — `EndUseRule`
- `DELETE /:id` — auth — delete rule — `{success}`

### `allowlist.ts` → mount `allowlist`
- `GET /` — public — allowlist entries for `?workspace_id` — `AllowlistEntry[]`
- `POST /` — auth+role(reviewer) — suppress a known false positive (party + optional list entry + reason + expiry, writes ledger) — `AllowlistEntry`
- `DELETE /:id` — auth+role(reviewer) — remove suppression — `{success}`

### `ledger.ts` → mount `ledger`
- `GET /` — public — ledger entries for `?workspace_id` (filter `?entity_type`,`?entity_id`,`?event_type`) — `LedgerEntry[]`
- `GET /:id` — public — single ledger entry — `LedgerEntry`
- `GET /verify` — public — verify hash chain integrity for `?workspace_id` — `{ok, broken_at}`

### `exports.ts` → mount `exports`
- `GET /` — public — past exports for `?workspace_id` — `Export[]`
- `GET /:id` — public — export bundle detail (+manifest) — `ExportDetail`
- `POST /` — auth — generate an audit export (full or filtered, computes manifest_hash, writes ledger) — `ExportDetail`

### `notifications.ts` → mount `notifications`
- `GET /` — auth — current user's notifications for `?workspace_id` — `Notification[]`
- `POST /:id/read` — auth — mark notification read — `Notification`
- `POST /read-all` — auth — mark all read for `?workspace_id` — `{updated}`

### `policies.ts` → mount `policies`
- `GET /` — public — active policy for `?workspace_id` (+version history) — `PolicyDetail`
- `POST /` — auth+role(admin) — save a new policy version (writes policy_change ledger) — `Policy`

### `segments.ts` → mount `segments`
- `GET /` — public — segments for `?workspace_id` — `Segment[]`
- `POST /` — auth — save a segment (named party filter) — `Segment`
- `DELETE /:id` — auth — delete segment — `{success}`

### `reports.ts` → mount `reports`
- `GET /` — public — saved reports for `?workspace_id` — `Report[]`
- `GET /generate` — public — generate a report on the fly: `?workspace_id&type=` (open_matches|blocked_orders|rescreen_compliance|reviewer_activity) — `ReportSnapshot`
- `POST /` — auth — save a report snapshot — `Report`

### `metrics.ts` → mount `metrics`
- `GET /` — public — dashboard KPIs for `?workspace_id` (parties by status, open matches, overdue, blocked orders, throughput) — `Metrics`
- `GET /trends` — public — time-series trends for `?workspace_id` — `Trends`

### `seed.ts` → mount `seed`
- `POST /demo` — auth — generate a synthetic demo workspace (parties, lists+versions, near-match decoys, orders, screenings, matches) — `{workspace_id, counts}`
- `POST /reset` — auth — reset/regenerate demo data for `?workspace_id` — `{counts}`

### `billing.ts` → mount `billing`
- `GET /plan` — auth — current subscription+plan, `stripeEnabled` — `{subscription, plan, stripeEnabled}`
- `POST /checkout` — auth — Stripe checkout session (503 if unconfigured) — `{url}`
- `POST /portal` — auth — Stripe billing portal (503 if unconfigured) — `{url}`
- `POST /webhook` — public — Stripe webhook (503 if unconfigured) — `{received}`

Total route files: **25** (workspaces, members, invites, parties, aliases, lists, listVersions, listEntries, screenings, matches, rescreen, orders, embargoes, endUses, allowlist, ledger, exports, notifications, policies, segments, reports, metrics, seed, billing) + `health` served inline in index.ts.

---

## (c) `web/lib/api.ts` methods (relative `/api/proxy/...`)

Each method maps 1:1 to a backend endpoint. `default export` of an `api` object.

| Method | Verb | Path |
|--------|------|------|
| listWorkspaces | GET | /api/proxy/workspaces |
| getWorkspace | GET | /api/proxy/workspaces/:id |
| createWorkspace | POST | /api/proxy/workspaces |
| updateWorkspace | PUT | /api/proxy/workspaces/:id |
| deleteWorkspace | DELETE | /api/proxy/workspaces/:id |
| listMembers | GET | /api/proxy/members?workspace_id= |
| addMember | POST | /api/proxy/members |
| updateMember | PUT | /api/proxy/members/:id |
| removeMember | DELETE | /api/proxy/members/:id |
| listInvites | GET | /api/proxy/invites?workspace_id= |
| createInvite | POST | /api/proxy/invites |
| acceptInvite | POST | /api/proxy/invites/accept |
| revokeInvite | DELETE | /api/proxy/invites/:id |
| listParties | GET | /api/proxy/parties?workspace_id= |
| getParty | GET | /api/proxy/parties/:id |
| createParty | POST | /api/proxy/parties |
| updateParty | PUT | /api/proxy/parties/:id |
| deleteParty | DELETE | /api/proxy/parties/:id |
| importParties | POST | /api/proxy/parties/import |
| listAliases | GET | /api/proxy/aliases?party_id= |
| addAlias | POST | /api/proxy/aliases |
| deleteAlias | DELETE | /api/proxy/aliases/:id |
| listLists | GET | /api/proxy/lists?workspace_id= |
| getList | GET | /api/proxy/lists/:id |
| createList | POST | /api/proxy/lists |
| updateList | PUT | /api/proxy/lists/:id |
| deleteList | DELETE | /api/proxy/lists/:id |
| listListVersions | GET | /api/proxy/list-versions?list_id= |
| getListVersion | GET | /api/proxy/list-versions/:id |
| createListVersion | POST | /api/proxy/list-versions |
| activateListVersion | POST | /api/proxy/list-versions/:id/activate |
| diffListVersion | GET | /api/proxy/list-versions/:id/diff?other= |
| listListEntries | GET | /api/proxy/list-entries?list_version_id= |
| getListEntry | GET | /api/proxy/list-entries/:id |
| createListEntry | POST | /api/proxy/list-entries |
| deleteListEntry | DELETE | /api/proxy/list-entries/:id |
| listScreenings | GET | /api/proxy/screenings?workspace_id= |
| getScreening | GET | /api/proxy/screenings/:id |
| runScreening | POST | /api/proxy/screenings/run |
| runSegmentScreening | POST | /api/proxy/screenings/run-segment |
| listMatches | GET | /api/proxy/matches?workspace_id= |
| getMatch | GET | /api/proxy/matches/:id |
| adjudicateMatch | POST | /api/proxy/matches/:id/adjudicate |
| getMatchQueue | GET | /api/proxy/matches/queue?workspace_id= |
| listRescreenSchedules | GET | /api/proxy/rescreen/schedules?workspace_id= |
| saveRescreenSchedule | POST | /api/proxy/rescreen/schedules |
| updateRescreenSchedule | PUT | /api/proxy/rescreen/schedules/:id |
| deleteRescreenSchedule | DELETE | /api/proxy/rescreen/schedules/:id |
| getRescreenDue | GET | /api/proxy/rescreen/due?workspace_id= |
| listOrders | GET | /api/proxy/orders?workspace_id= |
| getOrder | GET | /api/proxy/orders/:id |
| createOrder | POST | /api/proxy/orders |
| updateOrder | PUT | /api/proxy/orders/:id |
| evaluateOrder | POST | /api/proxy/orders/:id/evaluate |
| overrideOrder | POST | /api/proxy/orders/:id/override |
| deleteOrder | DELETE | /api/proxy/orders/:id |
| listEmbargoes | GET | /api/proxy/embargoes?workspace_id= |
| createEmbargo | POST | /api/proxy/embargoes |
| updateEmbargo | PUT | /api/proxy/embargoes/:id |
| deleteEmbargo | DELETE | /api/proxy/embargoes/:id |
| listEndUses | GET | /api/proxy/end-uses?workspace_id= |
| createEndUse | POST | /api/proxy/end-uses |
| updateEndUse | PUT | /api/proxy/end-uses/:id |
| deleteEndUse | DELETE | /api/proxy/end-uses/:id |
| listAllowlist | GET | /api/proxy/allowlist?workspace_id= |
| createAllowlistEntry | POST | /api/proxy/allowlist |
| deleteAllowlistEntry | DELETE | /api/proxy/allowlist/:id |
| listLedger | GET | /api/proxy/ledger?workspace_id= |
| getLedgerEntry | GET | /api/proxy/ledger/:id |
| verifyLedger | GET | /api/proxy/ledger/verify?workspace_id= |
| listExports | GET | /api/proxy/exports?workspace_id= |
| getExport | GET | /api/proxy/exports/:id |
| createExport | POST | /api/proxy/exports |
| listNotifications | GET | /api/proxy/notifications?workspace_id= |
| markNotificationRead | POST | /api/proxy/notifications/:id/read |
| markAllNotificationsRead | POST | /api/proxy/notifications/read-all |
| getPolicy | GET | /api/proxy/policies?workspace_id= |
| savePolicy | POST | /api/proxy/policies |
| listSegments | GET | /api/proxy/segments?workspace_id= |
| createSegment | POST | /api/proxy/segments |
| deleteSegment | DELETE | /api/proxy/segments/:id |
| listReports | GET | /api/proxy/reports?workspace_id= |
| generateReport | GET | /api/proxy/reports/generate?workspace_id=&type= |
| saveReport | POST | /api/proxy/reports |
| getMetrics | GET | /api/proxy/metrics?workspace_id= |
| getTrends | GET | /api/proxy/metrics/trends?workspace_id= |
| seedDemo | POST | /api/proxy/seed/demo |
| resetDemo | POST | /api/proxy/seed/reset |
| getBillingPlan | GET | /api/proxy/billing/plan |
| createCheckout | POST | /api/proxy/billing/checkout |
| createPortal | POST | /api/proxy/billing/portal |

---

## (d) Pages (`web/`)

### Public

| Route | File | Kind | API methods | Renders |
|-------|------|------|-------------|---------|
| / | app/page.tsx | public | (none) | Static landing: hero, features, CTA. No auth calls. |
| /pricing | app/pricing/page.tsx | public | getBillingPlan | Free vs Pro plans; upgrade CTA. |
| /auth/sign-in | app/auth/sign-in/page.tsx | public | (authClient) | Client onSubmit sign-in. |
| /auth/sign-up | app/auth/sign-up/page.tsx | public | (authClient) | Client onSubmit sign-up. |

### Dashboard (wrapped by `app/dashboard/layout.tsx` → `DashboardLayout`)

| Route | File | Kind | API methods | Renders |
|-------|------|------|-------------|---------|
| /dashboard | app/dashboard/page.tsx | dashboard | getMetrics, getTrends, listWorkspaces, seedDemo | Overview KPIs, trend charts, empty-state seed button. |
| /dashboard/parties | app/dashboard/parties/page.tsx | dashboard | listParties, deleteParty, importParties | Party register table, status filters, CSV import. |
| /dashboard/parties/new | app/dashboard/parties/new/page.tsx | dashboard | createParty | Create-party form. |
| /dashboard/parties/[id] | app/dashboard/parties/[id]/page.tsx | dashboard | getParty, updateParty, listAliases, addAlias, deleteAlias, runScreening, saveRescreenSchedule | Party detail, aliases, screening history, run-screen, edit. |
| /dashboard/lists | app/dashboard/lists/page.tsx | dashboard | listLists, createList, deleteList | Lists table, create list. |
| /dashboard/lists/[id] | app/dashboard/lists/[id]/page.tsx | dashboard | getList, listListVersions, createListVersion, activateListVersion, updateList | List detail + versions, create/activate version. |
| /dashboard/list-versions/[id] | app/dashboard/list-versions/[id]/page.tsx | dashboard | getListVersion, listListEntries, createListEntry, deleteListEntry, diffListVersion | Version entries, add entry, diff against another version. |
| /dashboard/screenings | app/dashboard/screenings/page.tsx | dashboard | listScreenings, runSegmentScreening, listSegments | Screening runs table, run-all / run-segment. |
| /dashboard/screenings/[id] | app/dashboard/screenings/[id]/page.tsx | dashboard | getScreening | Screening detail with resulting matches. |
| /dashboard/screenings/run | app/dashboard/screenings/run/page.tsx | dashboard | listParties, runScreening | Choose party + lists, run a screening. |
| /dashboard/matches | app/dashboard/matches/page.tsx | dashboard | listMatches, getMatchQueue | Adjudication queue + all matches, decision filters. |
| /dashboard/matches/[id] | app/dashboard/matches/[id]/page.tsx | dashboard | getMatch, adjudicateMatch, createAllowlistEntry | Match detail, score breakdown, adjudicate, allowlist. |
| /dashboard/rescreen | app/dashboard/rescreen/page.tsx | dashboard | getRescreenDue, listRescreenSchedules, saveRescreenSchedule, updateRescreenSchedule, deleteRescreenSchedule | Due/overdue queue + cadence schedules. |
| /dashboard/orders | app/dashboard/orders/page.tsx | dashboard | listOrders, createOrder, deleteOrder, listParties | Orders table with gate status, create order. |
| /dashboard/orders/[id] | app/dashboard/orders/[id]/page.tsx | dashboard | getOrder, updateOrder, evaluateOrder, overrideOrder | Order detail, gate evaluation, override-with-justification. |
| /dashboard/embargoes | app/dashboard/embargoes/page.tsx | dashboard | listEmbargoes, createEmbargo, updateEmbargo, deleteEmbargo, listEndUses, createEndUse, updateEndUse, deleteEndUse | Embargoed countries + end-use rules editor. |
| /dashboard/allowlist | app/dashboard/allowlist/page.tsx | dashboard | listAllowlist, deleteAllowlistEntry | Suppressed false positives list. |
| /dashboard/ledger | app/dashboard/ledger/page.tsx | dashboard | listLedger, getLedgerEntry, verifyLedger | Filterable activity/audit ledger + chain verify. |
| /dashboard/exports | app/dashboard/exports/page.tsx | dashboard | listExports, createExport, getExport | Audit export bundles, generate export. |
| /dashboard/reports | app/dashboard/reports/page.tsx | dashboard | listReports, generateReport, saveReport | Pre-built reports, generate + save snapshot. |
| /dashboard/notifications | app/dashboard/notifications/page.tsx | dashboard | listNotifications, markNotificationRead, markAllNotificationsRead | Notification inbox. |
| /dashboard/policy | app/dashboard/policy/page.tsx | dashboard | getPolicy, savePolicy | Screening policy: threshold, weights, four-eyes, cadence. |
| /dashboard/members | app/dashboard/members/page.tsx | dashboard | listMembers, addMember, updateMember, removeMember, listInvites, createInvite, revokeInvite, acceptInvite | Members + invites management. |
| /dashboard/segments | app/dashboard/segments/page.tsx | dashboard | listSegments, createSegment, deleteSegment, listParties | Saved party segments. |
| /dashboard/settings | app/dashboard/settings/page.tsx | dashboard | listWorkspaces, createWorkspace, updateWorkspace, getBillingPlan, createCheckout, createPortal, resetDemo | Workspace settings + billing + demo reset. |

Total pages: **4 public + 25 dashboard = 29** `page.tsx` files (plus `app/dashboard/layout.tsx`,
`app/api/auth/[...path]/route.ts`, `app/api/proxy/[...path]/route.ts`).

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` ('use client', `usePathname()` active state, mobile drawer):

- **Overview**
  - Dashboard → /dashboard
- **Screening**
  - Parties → /dashboard/parties
  - Matches → /dashboard/matches
  - Screenings → /dashboard/screenings
  - Re-screen → /dashboard/rescreen
- **Lists**
  - Lists → /dashboard/lists
  - Allowlist → /dashboard/allowlist
- **Orders**
  - Orders → /dashboard/orders
  - Embargoes & End Uses → /dashboard/embargoes
- **Record**
  - Ledger → /dashboard/ledger
  - Exports → /dashboard/exports
  - Reports → /dashboard/reports
- **Admin**
  - Notifications → /dashboard/notifications
  - Policy → /dashboard/policy
  - Members → /dashboard/members
  - Segments → /dashboard/segments
  - Settings → /dashboard/settings

(List-version detail, party/order/screening/match detail, and the new/run sub-pages are
reached by drilling in from their parent list pages, not top-level nav items.)

---

## Cross-consistency invariants

- Every api method in (c) is implemented by exactly one endpoint in (b) and consumed by at
  least one page in (d).
- `getBillingPlan` is consumed by both /pricing and /dashboard/settings.
- The deterministic match engine lives in `backend/src/lib/match.ts` (pure functions:
  normalize, jaroWinkler, scoreMatch) and is imported by `screenings.ts`.
- The hash-chain helper lives in `backend/src/lib/ledger.ts` (appendLedger computes
  seq + prev_hash + hash) and is imported by every route that writes ledger entries.
- The gate evaluator lives in `backend/src/lib/gate.ts` (evaluateOrderGate) imported by
  `orders.ts`.
