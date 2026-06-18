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
- **Invariant #2 (one member per workspace) is ASSUMED, not constrained**: the `workspace_member`
  PK is `(workspace_id, user_id)`, which permits N members — nothing in the DB or app forbids a
  second member. It holds in v1 only because `bootstrap` is the sole writer (one owner per personal
  workspace) and no endpoint adds members. Revisit when collaboration ships.

## Project map
- `src/auth/` — `verifier.ts` (swappable token verify; JWKS/ES256 via Supabase signing keys,
  derived from `SUPABASE_URL` — no shared secret), `context.ts` (requireAuth → workspace ctx;
  also `WorkspaceContext` = the `{userId,workspaceId,timezone}` subset background jobs synthesise),
  `cron.ts` (constant-time `CRON_SECRET` guard for the jobs tick — fail-closed, the one non-JWT surface).
- `src/db/` — `kysely.ts` (pooled handle + pg type parsers), `types.ts` (hand-written DB types),
  `transaction.ts` (the one tx helper).
- `src/lib/` — `errors.ts` (ApiError + pg-error mapping), `http.ts` (route wrapper), `dates.ts` (midnight-local).
- `src/planner/` — `types.ts` (interface incl. optional `TaskEdge[]`), `index.ts` (v1 fill-to-capacity
  + staged unblocking when edges supplied; empty edges = inert), `constants.ts` (difficulty→hours).
- `src/domain/` — business logic: `bootstrap`, `goals`, `projects`, `workPackages`, `tasks`,
  `completion` (the cascade) + `scoring`, `engagement`, `roadmap` (propose + confirmDay),
  `roadmapRead` (GET /roadmap + `readDay` pure core + `getDay` = readDay + today-⚡eng),
  `projection` (read-only roadmap projection +
  `projectMilestoneDates` — the one source of milestone dates; projected_date is derived, NEVER a
  column), `planItems` (add/defer/reorder/delete/pull-forward/lock), `flow`, `blocked`, `validation`,
  `me` (GET/PATCH profile, stats, ⚡eng action), `devices` (register/list/delete; upsert by push_token),
  `notificationPrefs` (get/replace), `points` (point-events/rules reads — no writes),
  `morningBriefRead` (the composite; composes `readDay` so it records ⚡eng exactly once),
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
- `tests/` — DB-backed suites (run against the configured Supabase DB): `spine` (propose→confirm
  gate + create-path 422s + bootstrap idempotency), `completion`, `dependencies`, `flow`,
  `replan` (+ pure `replan-diff`), `jobs`, `roadmap`, `companion`.
- `frontend/` — React + Vite web client. The design target is the dark "Earned Momentum" prototype
  in `docs/design/project/TodoMapp Prototype.dc.html`; token mapping lives in
  `frontend/src/styles/tokens.css`. Main screens: Shell/Home, Onboarding, Roadmap/Replan, Project
  workbench, and Celebration.

## Commands
- `npm run migrate` — apply pending SQL migrations (uses `DIRECT_URL`). `-- --status` to list.
- `npm run seed` — (re)create the seed workspace + scenario. `-- --reset` to only delete it.
- `npm test` — run all DB-backed suites via vitest (needs `DIRECT_URL`).
- `npm run dev` — Next dev server. `npm run build` / `npm run typecheck` — verify.

## Known deviations from the docs
- **`point_event` source CHECK relaxed to `<= 1`** (not `= 1`). The doc states both exactly-one-source
  AND `ON DELETE SET NULL` on sources; those conflict (SET NULL on a scored task would violate `=1`
  and block the delete). We keep `<= 1` + a type↔source *family* agreement CHECK, preserving the real
  guard while letting the append-only ledger survive source deletion. See the migration comment.
- **`DIRECT_URL` points at the session pooler (5432)**, not `db.<ref>.supabase.co` — that direct host
  is IPv6-only and unreachable from many networks/CI. Session mode still supports DDL + transactions.

## Build state
See `docs/PROGRESS.md` for the live checklist. In short: the full `/v1` API is built through
Phase 8: vertical spine, completion cascade, dependencies, flow data, replanning, jobs, roadmap
projection/day edits, companion/motivation reads, WBS CRUD, milestone CRUD, and progress roll-ups.
Only real APNs delivery remains stubbed behind `Notifier`.

The React/Vite web app has also had a prototype-parity pass against `TodoMapp Prototype.dc.html`.
Current frontend state: Shell/Home has the expandable Today bar and WBS sidebar; Onboarding is the
7-step Goal→Project→Milestone→Breakdown→Group→Capacity→Roadmap flow; Roadmap/Replan uses the
horizontal path plus review drawer; Project workbench defaults to a WP-only Flow diagram with tasks
shown in an inline right-side panel; Table/Timeline controls and Celebration styling were updated.
Details live in `docs/ui-design-gap-updates.md`.
