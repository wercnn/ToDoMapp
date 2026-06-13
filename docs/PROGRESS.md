# PROGRESS — where we left off

Live build checklist. **Update the relevant section at the end of each work session.**
Terse; see `/docs` for spec detail and `CLAUDE.md` for architecture.

_Last updated: 2026-06-13 — initial vertical slice landed and verified against Supabase._

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
  `/days/{date}/confirm`, `/tasks/{id}/complete`. Plus `/health`.
- **Cascade (test-first)**: `completeTask` — done → plan item → points(once) → WP cache →
  milestone achieve → daily-goal → engagement/stats. `reopenTask` (domain only, no route yet).
- **Tests**: `tests/completion.test.ts` — 5 tests, **all pass against Supabase**, incl.
  reopen→re-complete awards 0 and the DB partial-unique backstop.
- **Seed + fixtures**: `scripts/seed.ts` + `src/testing/fixtures.ts` (wipe & re-run).
- **Persistent context**: `CLAUDE.md`, this file.

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
- `SUPABASE_JWT_SECRET` value looks like a UUID, not a real HS256 secret — verify before the
  auth middleware is exercised by live API calls (unused by migrate/test).
- Two intentional deviations from the docs are recorded in `CLAUDE.md` → "Known deviations".
