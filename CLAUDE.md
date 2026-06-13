# CLAUDE.md

Backend for a goal-driven planning platform: User → Goal → Project → Work Package →
Task, projected onto a day-granular roadmap with a points/streak motivation layer.
API-first; clients hold zero business logic.

**Authoritative spec lives in `/docs`** — read these for any detail, don't infer:
- `project-foundation.md` — what/why; §8 Decision Log is authoritative.
- `data-model.md` — Postgres schema; §2–§4 are the source of truth for tables.
- `api-endpoints.md` — the REST surface, grouped by resource.

## Locked decisions (do not re-litigate)
- TypeScript on **Next.js App Router** API routes, deployed to Vercel.
- **Supabase** (Postgres + Auth). The auto-generated **Data API is OFF** — our Next.js
  API is the only thing that reads/writes domain tables.
- DB access via **Kysely**. Migrations are **plain SQL files in git** (Supabase CLI layout).
  Schema is hand-written SQL, NOT generated from TS; `src/db/types.ts` is kept in lockstep by hand.
- Connections: pooled (6543) for the app, session/direct (5432) for migrations — both from `.env`.
- **Capacity = per-project hours/day** for v1, but passed to the planner as a *parameter*
  (`ProjectCapacity[]`), never hard-wired, so a per-day model can replace it later.
- **Planner behind a narrow interface**: `proposeDays(input) → DraftDay[]` (pure, no I/O).
  Nothing outside `src/planner` depends on how it works.
- **All multi-table writes go through `withTransaction`** (`src/db/transaction.ts`).
- **Tenancy from the JWT** in auth middleware: subject → `app_user.auth_subject` → workspace
  via `workspace_member`. `workspace_id` is injected server-side, NEVER from the client.
  Cross-workspace access → 404.
- **Scoring is idempotent**: each source scores once ever (app check + partial unique indexes).

## Project map
- `src/auth/` — `verifier.ts` (swappable token verify; JWKS/ES256 via Supabase signing keys,
  derived from `SUPABASE_URL` — no shared secret), `context.ts` (requireAuth → workspace ctx).
- `src/db/` — `kysely.ts` (pooled handle + pg type parsers), `types.ts` (hand-written DB types),
  `transaction.ts` (the one tx helper).
- `src/lib/` — `errors.ts` (ApiError + pg-error mapping), `http.ts` (route wrapper), `dates.ts` (midnight-local).
- `src/planner/` — `types.ts` (interface), `index.ts` (v1 fill-to-capacity), `constants.ts` (difficulty→hours).
- `src/domain/` — business logic: `bootstrap`, `goals`, `projects`, `workPackages`, `tasks`,
  `completion` (the cascade) + `scoring`, `engagement`, `roadmap`, `blocked`, `validation`.
- `src/app/api/v1/` — route handlers (one folder per endpoint).
- `src/testing/fixtures.ts` — `provisionWorkspace` / `seedScenario` / `teardownWorkspace` (shared by tests + seed).
- `supabase/migrations/` — numbered SQL migrations (initial schema + point_rule seed).
- `scripts/` — `migrate.ts`, `seed.ts`, `env.ts` (dotenv loader for scripts/tests).
- `tests/` — `completion.test.ts` (DB-backed; runs against the configured Supabase DB).

## Commands
- `npm run migrate` — apply pending SQL migrations (uses `DIRECT_URL`). `-- --status` to list.
- `npm run seed` — (re)create the seed workspace + scenario. `-- --reset` to only delete it.
- `npm test` — run the completion-cascade tests (DB-backed; needs `DIRECT_URL`).
- `npm run dev` — Next dev server. `npm run build` / `npm run typecheck` — verify.

## Known deviations from the docs
- **`point_event` source CHECK relaxed to `<= 1`** (not `= 1`). The doc states both exactly-one-source
  AND `ON DELETE SET NULL` on sources; those conflict (SET NULL on a scored task would violate `=1`
  and block the delete). We keep `<= 1` + a type↔source *family* agreement CHECK, preserving the real
  guard while letting the append-only ledger survive source deletion. See the migration comment.
- **`DIRECT_URL` points at the session pooler (5432)**, not `db.<ref>.supabase.co` — that direct host
  is IPv6-only and unreachable from many networks/CI. Session mode still supports DDL + transactions.

## Build state
See `docs/PROGRESS.md` for the live checklist. In short: the 8-endpoint vertical spine +
the task-completion cascade are built and pass against Supabase. Dependencies, the flow
diagram, replanning, and most read endpoints are NOT built yet.
