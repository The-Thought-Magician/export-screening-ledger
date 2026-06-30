# Export Screening Ledger

Export Screening Ledger (ESL) is a continuous restricted-party screening and decision-of-record system for export-compliance teams. It maintains a register of every customer, partner, intermediary, and end user; screens each one against denied/restricted-party lists (OFAC SDN, BIS Entity List, EU Consolidated, UN, plus custom internal lists) using deterministic fuzzy name matching; and forces every potential match through a structured adjudication workflow (Cleared / Blocked / Escalated) with a required reason and a named reviewer.

Beyond one-off screening, ESL runs a re-screening cadence, gates orders and transactions on unresolved parties, supports override-with-justification, and flags embargoed destinations and prohibited end uses. Every action is written to an append-only, timestamped, hash-chained decision ledger that records the exact list version used, producing a defensible audit trail and a one-click immutable export.

The product is fully deterministic (no opaque ML scores): matching, scoring, and decisioning are reproducible and explainable. A built-in synthetic data seeder generates parties, lists, near-match decoys, orders, and screening history so the platform is demoable on first sign-in.

See [docs/idea.md](docs/idea.md) for the full product specification.

## Stack

- **Backend:** Hono on Node (TypeScript, ESM), run via `tsx`. Drizzle ORM over Neon Postgres (`@neondatabase/serverless`). Zod for request validation.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4.
- **Auth:** Neon Auth (`@neondatabase/auth`). The Next.js server resolves the session and proxies API calls to the backend with an `X-User-Id` header.
- **Package manager:** pnpm (always).

## Repository Layout

```
backend/   Hono API server (src/index.ts entrypoint)
web/       Next.js frontend (App Router)
docs/      Product spec (idea.md) and build plan
```

## Local Development

Prerequisites: Node 22+, pnpm, and a Postgres connection string (Neon recommended). The backend does not create its own tables; provision the Drizzle schema (drizzle-kit push or the Neon console) before first boot.

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # then fill in DATABASE_URL
pnpm dev               # node --import tsx/esm src/index.ts
```

The API listens on `http://localhost:3001`, exposes `GET /health`, and mounts all routes under `/api/v1`. On first boot the synthetic data seeder populates demo parties, lists, and screening history if the tables are empty.

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in NEON_AUTH_* and NEXT_PUBLIC_API_URL
pnpm dev                     # next dev
```

The app runs on `http://localhost:3000`.

### Docker

`docker compose up` brings the backend (`:3001`) and web (`:3000`) up together. Provide `DATABASE_URL` via `backend/.env`.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | Defaults to `3001` locally; Render injects `10000`. |
| `DATABASE_URL` | yes | Postgres connection string (Neon), e.g. `postgres://user:pass@host/db?sslmode=require`. |
| `FRONTEND_URL` | no | Allowed CORS origin; defaults to `http://localhost:3000`. |
| `ADMIN_USER_IDS` | no | Comma-separated user IDs granted admin endpoints. |

### Frontend (`web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEON_AUTH_BASE_URL` | yes | Neon Auth endpoint base URL (server-only). |
| `NEON_AUTH_COOKIE_SECRET` | yes | Random 32-byte hex used to sign auth cookies (server-only). |
| `NEXT_PUBLIC_API_URL` | yes | Backend base URL, baked into the build and used by the proxy route. |

## Billing

All features are free for signed-in users. There is no paid tier and no payment integration; the billing endpoint reports a free plan only. Just sign in to use the entire platform.

## Deployment

- **Backend:** Render web service (`render.yaml`, Variant A). Build `cd backend && pnpm install`, start `cd backend && node --import tsx/esm src/index.ts`. Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- **Frontend:** Vercel, with `rootDirectory: web`, `framework: nextjs`, Node 22.x.
