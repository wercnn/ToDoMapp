# PROGRESS — where we left off

Live build checklist. **Update the relevant section at the end of each work session.**
Terse; see `/docs` for spec detail and `CLAUDE.md` for architecture.

_Last updated: 2026-06-13 — initial vertical slice landed and verified against Supabase; auth moved to JWKS (signing keys)._

## Done
- **Scaffold**: Next.js 15 App Router + TS + Kysely + pg; vitest; tsconfig/next config; `.env.example`.
- **Schema**: initial migration (`supabase/migrations/20260613000001_initial_schema.sql`) — all
  enums, tables, CHECKs, composite FK with `SET NULL (milestone_id)`, partial unique indexes
  (incl. the 3 point_event double-award guards). `…0002_seed_point_rules.sql` seeds point values.
  Migration runner + `schema_migrations` tracking. **Applied to Supabase (eu-west-1).**
- **DB types**: hand-written `src/db/types.ts` in lockstep with the schema. `date` parsed as string.
- **Spine**: auth→workspace ctx, `withTransaction`, error/http lib, midnight-local date utils.
- **Planner**: `proposeDays` interface + v1 fill-to-capacity (skips blocked, pins time-fixed,
  capacity as a parameter). Pure-logic sanity-checked.
- **Endpoints (the 8, in order)**: `/auth/bootstrap`, `/goals` (+`/goals/{id}/projects`),
  `/projects/{id}/work-packages`, `/work-packages/{id}/tasks`, `/roadmap/propose`,
  `/days/{date}/confirm`, `/tasks/{id}/complete`. Plus `/health`. Served at base path
  `/v1` (handlers under `src/app/v1/`). **Verified live over HTTP** with a real ES256
  bearer token: full bootstrap→goal→project→wp→task→complete chain, idempotent
  re-complete (0 pts), plus 401 / 404 (tenancy) / 422 / 400 error paths.
- **Cascade (test-first)**: `completeTask` — done → plan item → points(once) → WP cache →
  milestone achieve → daily-goal → engagement/stats. `reopenTask` (domain only, no route yet).
- **Tests**: `tests/completion.test.ts` — 5 tests, **all pass against Supabase**, incl.
  reopen→re-complete awards 0 and the DB partial-unique backstop.
- **Seed + fixtures**: `scripts/seed.ts` + `src/testing/fixtures.ts` (wipe & re-run).
- **Persistent context**: `CLAUDE.md`, this file.

## Roadmap (one line per phase)
- **Phase 1 — Vertical spine** ✅ — 8-endpoint slice + completion cascade, live-verified.
- **Phase 2 — Dependencies + acyclicity** — task/WP dependency edges, API-layer cycle check (invariant #1); lights up `blocked` + the planner.
- **Phase 3 — Project Flow Diagram** — `/projects/{id}/flow`: derived node states + critical path to next milestone.
- **Phase 4 — Replanning pipeline** — `replan_proposal` create/list/approve/reject, JSONB diff + apply, time-fixed conflicts (invariants #4/#5), `new_work_package` proposal.
- **Phase 5 — Notifications & jobs** — slippage detector, morning-brief push, contextual nudges, stale-token prune; per-user local-midnight scheduling.
- **Phase 6 — Roadmap projection & daily-planning reads** — `GET /roadmap` (persisted ∪ projected), `/days/{date}`, plan-item add/defer/reorder, pull-forward, reopen.
- **Phase 7 — Companion & motivation reads** — `/me*`, stats, engagement, morning-brief, points/history, milestones CRUD, devices, notif-prefs.
- **Phase 8 — WBS edits/deletes + roll-ups** — goal/project/WP/task PATCH+DELETE, goal/project progress endpoints.

## Not built yet (next up, post-review)
- **Dependencies** endpoints (`/task-dependencies`, `/work-package-dependencies`) + the
  acyclicity reachability check. `getBlockedTaskIds` already consumes edges once they exist.
- **Project Flow Diagram** (`/projects/{id}/flow`) + critical-path computation.
- **Replanning pipeline** (`replan_proposal` create/list/approve/reject; slippage detector job).
- **`new_work_package` proposal**: work-package create currently returns `{ work_package }` only —
  the spec's pending-proposal-on-confirmed-days behavior is a deliberate TODO (see `src/domain/workPackages.ts`).
- **Remaining reads/writes**: `/me*`, devices, notif prefs, milestones CRUD, goal/project edit+delete,
  progress roll-ups, `/roadmap` (GET projection), `/days/{date}` GET, plan-item edits,
  `/tasks/{id}/reopen` + `/pull-forward`, points/history reads, morning-brief.

## Open items / risks
- Auth — ✅ resolved 2026-06-13 via **JWKS**. This project is on Supabase "JWT Signing Keys";
  user access tokens are ES256, public key published at `…/auth/v1/.well-known/jwks.json`.
  `src/auth/verifier.ts` verifies against JWKS (selects by `kid`, caches, asymmetric-only),
  derived from `SUPABASE_URL` — no secret needed, survives legacy-HS256 revocation + rotation.
  The legacy `SUPABASE_JWT_SECRET` is verify-only/deprecated and unused by the verifier.
  _To confirm end-to-end: log in, decode the access_token header → expect `alg: ES256`._
- Two intentional deviations from the docs are recorded in `CLAUDE.md` → "Known deviations".
