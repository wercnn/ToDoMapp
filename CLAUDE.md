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
  derived from `SUPABASE_URL` — no shared secret), `context.ts` (requireAuth → workspace ctx;
  also `WorkspaceContext` = the `{userId,workspaceId,timezone}` subset background jobs synthesise),
  `cron.ts` (constant-time `CRON_SECRET` guard for the jobs tick — fail-closed, the one non-JWT surface).
- `src/db/` — `kysely.ts` (pooled handle + pg type parsers), `types.ts` (hand-written DB types),
  `transaction.ts` (the one tx helper).
- `src/lib/` — `errors.ts` (ApiError + pg-error mapping), `http.ts` (route wrapper), `dates.ts` (midnight-local).
- `src/planner/` — `types.ts` (interface), `index.ts` (v1 fill-to-capacity), `constants.ts` (difficulty→hours).
- `src/domain/` — business logic: `bootstrap`, `goals`, `projects`, `workPackages`, `tasks`,
  `completion` (the cascade) + `scoring`, `engagement`, `roadmap`, `blocked`, `validation`,
  `replan/` (proposal pipeline: `analyze` diff producer, `apply` transactional apply + #4/#5
  guards, `proposals` service, `types`; consumes the pure planner, never lives inside it),
  `jobs/` (Phase 5 background work: `runner` per-tick sweep, `context` user scan, `slippage`
  detector, `morningBrief`, `nudges`, `prune`, `dispatch` idempotency ledger, swappable `notifier`).
- `src/app/v1/` — route handlers (one folder per endpoint). URL base path is `/v1`
  (in App Router the URL mirrors the folder, so routes live under `app/v1`, not `app/api`).
  `jobs/tick` is the cron-only endpoint — `CRON_SECRET`-guarded, no JWT, acts only on its own scan.
- `src/testing/fixtures.ts` — `provisionWorkspace` / `seedScenario` / `teardownWorkspace` (shared by tests + seed).
- `supabase/migrations/` — numbered SQL migrations (initial schema + point_rule seed + `notification_dispatch`).
- `vercel.json` — Vercel Cron: `*/15 * * * *` → `/v1/jobs/tick` (the only scheduled trigger).
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
diagram, the replanning pipeline (Phase 4), and notifications & background jobs (Phase 5 —
slippage detector, morning brief, nudges, stale-token prune, all behind one cron-driven tick)
are now built too. The milestone-approaching nudge predicate (needs Phase 6 projection) and
real APNs send (stubbed behind `Notifier`) plus most read endpoints are NOT built yet.
