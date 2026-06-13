# PROGRESS — where we left off

Live build checklist. **Update the relevant section at the end of each work session.**
Terse; see `/docs` for spec detail and `CLAUDE.md` for architecture.

_Last updated: 2026-06-13 — Phase 3 (Project Flow Diagram) landed and verified against Supabase._

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
- **Dependencies (Phase 2)**: `src/domain/dependencies.ts` + 4 routes
  (`POST`/`DELETE` `/task-dependencies` and `/work-package-dependencies`). API-layer
  acyclicity = BFS reachability over workspace+level edges (catches transitive cycles,
  not just back-edges); transaction-scoped advisory lock keyed on (workspace, level)
  closes the concurrent-insert window. Self-dep → 422, duplicate → 409 (PK authoritative,
  no pre-check), cycle → 409, cross-ws node → 404, non-UUID → 400. `getBlockedTaskIds`
  now lights up at both levels. **9 tests pass against Supabase** (`tests/dependencies.test.ts`).
- **Project Flow Diagram (Phase 3)**: `GET /projects/{id}/flow` (`src/domain/flow.ts`).
  Fully derived: per-node `derived_status` (done/blocked/in_progress/open) at WP + task
  levels, the task/WP edge sets, `next_milestone` (first unachieved by position, `{id,title}`
  only — `projected_date` deferred to Phase 6), and the **critical path = longest path by
  estimate sum** into the next milestone's WP set. The task DAG expands `work_package_dependency`
  to task level (predecessor-WP tasks → successor-WP tasks, m×n). `in_progress` uses
  midnight-LOCAL (`app_user.timezone`, invariant #3), `now` injectable. **6 tests pass**
  (`tests/flow.test.ts`) incl. a pure `longestPath` unit test, a WP-edge-decided critical
  path (proves expansion + direction), and a non-UTC timezone guard.
- **Persistent context**: `CLAUDE.md`, this file.

## Roadmap (one line per phase)
- **Phase 1 — Vertical spine** ✅ — 8-endpoint slice + completion cascade, live-verified.
- **Phase 2 — Dependencies + acyclicity** ✅ — task/WP dependency edges, API-layer cycle check (invariant #1); lights up `blocked` + the planner.
- **Phase 3 — Project Flow Diagram** ✅ — `/projects/{id}/flow`: derived node states + critical path to next milestone.
- **Phase 4 — Replanning pipeline** — `replan_proposal` create/list/approve/reject, JSONB diff + apply, time-fixed conflicts (invariants #4/#5), `new_work_package` proposal.
- **Phase 5 — Notifications & jobs** — slippage detector, morning-brief push, contextual nudges, stale-token prune; per-user local-midnight scheduling.
- **Phase 6 — Roadmap projection & daily-planning reads** — `GET /roadmap` (persisted ∪ projected), `/days/{date}`, plan-item add/defer/reorder, pull-forward, reopen.
- **Phase 7 — Companion & motivation reads** — `/me*`, stats, engagement, morning-brief, points/history, milestones CRUD, devices, notif-prefs.
- **Phase 8 — WBS edits/deletes + roll-ups** — goal/project/WP/task PATCH+DELETE, goal/project progress endpoints.

## Phase 4 — starting brief
The replanning pipeline (api §11, foundation §4.4): detect → analyze → **propose** → approve.
The plan mutates ONLY through approval; this group is the audit trail. Orient from here — don't re-scan.

**Builds on (read/extend these):**
- `src/planner/` — `proposeDays` projection; a replan re-runs it (with the prospective WBS/edges/capacity) to compute the shifted day-steps the diff is derived from. Stays pure behind its interface (Decision #19).
- `src/domain/blocked.ts` — `getBlockedTaskIds`; replan must not schedule blocked work and must reflect dependency impact when classifying moves.
- `daily_plan_day` / `daily_plan_item` tables — what apply mutates: moved items → `status='deferred'` on the old day, fresh items created with `origin='replanned'`; the partial-unique "one planned day per task" still holds.
- `replan_proposal` table — the audit trail. Holds `trigger`, `status`, `summary`, JSONB `changes` (the proposed diff) and `applied_changes` (what was actually applied on edited approval), `resolved_by_user_id` / `resolved_at`. Partial pending index powers "anything awaiting approval?".
- `src/lib/dates.ts` — `localDate` (midnight-local, invariant #3); the slippage boundary is per-user local midnight (job is Phase 5, but the boundary math lives here).
- `src/domain/completion.ts` — how plan items currently transition (planned→completed, reopen, WP-cache). Replan's deferred/replanned transitions must stay consistent with this so the two write paths don't fight.

**Hard invariants Phase 4 MUST NOT violate (the landmines):**
- **#4 — time-fixed work is NEVER auto-moved.** A time-fixed conflict may only appear in `changes.time_fixed_conflicts` with explicit options (`prioritize` / `descope` / `renegotiate`). The apply step MUST reject (`422`) any diff that moves a time-fixed item without an explicit user choice.
- **#5 — plans change only through approval.** No `daily_plan_*` mutation from a background job alone; apply runs only on `approved` / `edited_approved`.
- **Locked days** (`daily_plan_day.is_locked`) are untouchable — never proposed against, never applied onto.
- **Principle 3 — replanning is never penalized.** Deferred items keep their history; there are NO penalty point_events. Engaging with a proposal (approve/reject) counts as engagement (⚡eng), keeping the streak alive.

**Scope boundary (IN vs deferred):**
- **IN:** `POST /replan-proposals` (`trigger='user_request'`), `GET /replan-proposals`(list, default pending) + `GET /{id}` (full diff), `POST /{id}/approve` (optionally `edits`-shaped diff) + `POST /{id}/reject`; the JSONB diff + transactional apply step; time-fixed conflict surfacing; and the **`new_work_package` proposal** — wiring the existing TODO in `src/domain/workPackages.ts` so WP-create on confirmed days emits a pending proposal instead of `{ work_package }` only.
- **Triggers:** `user_request` and `new_work_package` are wired in Phase 4. `slippage` shares the SAME proposal machinery but its DETECTOR JOB (per-user local-midnight trigger) is **Phase 5** — Phase 4 builds the create-proposal entry point so the job can call it later; the cron/scheduling is not built here.

**Open question for the Phase 4 plan (record, don't resolve):** does the analyze/propose logic (the JSONB-diff producer) live behind the existing planner interface (`proposeDays`) or in a sibling module (e.g. `src/domain/replan` calling the planner)? Decide at plan time to keep it modular/replaceable per Decision #19.

## Not built yet (next up, post-review)
- **Replanning pipeline** (`replan_proposal` create/list/approve/reject; slippage detector job) — Phase 4, next up.
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
