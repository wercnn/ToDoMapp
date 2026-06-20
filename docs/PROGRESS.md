# PROGRESS — where we left off

Live build checklist. **Update the relevant section at the end of each work session.**
Terse; see `/docs` for spec detail and `CLAUDE.md` for architecture.

_Last updated: 2026-06-19 — Replan logic implemented, mode earliest_completion

_Last updated: 2026-06-19 — backend API phases are complete, and the React/Vite web app
received a prototype-parity pass against `docs/design/project/TodoMapp Prototype.dc.html`._

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
- **Replanning pipeline (Phase 4)**: `src/domain/replan/` — `analyze.ts` (pure `computeDiff`
  + `analyzeReplan` reading state → `{summary, changes}`), `apply.ts` (the transactional
  apply + guards), `proposals.ts` (create/list/get/approve/reject + superseding),
  `types.ts` (the JSONB diff shape + `parseChanges` for edited-approve). Routes:
  `POST/GET /replan-proposals`, `GET/approve/reject /{id}`. Diff producer lives in a
  **sibling domain module, not the planner** — the planner stays pure (Decision #19);
  replan consumes `proposeDays` for the target schedule then diffs against the persisted
  plan. **Invariant #4** enforced at apply: any time-fixed task in `moves` without an
  explicit `time_fixed_resolutions` choice → **422, zero writes** (and `computeDiff` never
  emits a time-fixed task into `moves` by construction). **Locked days untouchable both
  directions** (from_date OR to_date locked → 422). Apply defers-before-inserts (respects
  the `one_planned_per_task` partial unique); fresh items `origin='replanned'`; new target
  days created `confirmed` (approval = authorization, matches `confirmDay`). Approve/reject
  **claim the row** (`UPDATE … WHERE status='pending'`, assert 1) before any mutation, so a
  double-approve/expired-approve race writes nothing (→ 409). ⚡eng on approve/reject; NO
  penalty events (Principle 3). **`new_work_package`**: WP-create on a confirmed roadmap
  emits a pending proposal (WP + proposal in one tx) instead of touching the plan.
  **16 tests pass** (`tests/replan.test.ts` DB-backed + `tests/replan-diff.test.ts` pure),
  incl. the time-fixed 422 keystone, renegotiate-allows, locked both-directions,
  double-apply/expired → 409, a real **concurrent-approve race** (`Promise.allSettled`:
  one wins, one 409, one successor), superseding, and new_work_package present/absent.
  Confirmed-day shape is one source of truth (`src/domain/planDays.ts` — `confirmedDayValues`
  / `createConfirmedDay`) shared by `confirmDay` and replan apply (no DB CHECK on
  status/confirmed_at, so the API is the guarantee).
  _Descope trace:_ `deferred` is read nowhere yet; a descoped item is `deferred` with no
  `replanned` successor, and its authoritative record is `applied_changes.time_fixed_resolutions`.
- **Notifications & jobs (Phase 5)**: `src/domain/jobs/` + a single cron-driven tick.
  - **Scheduling**: one Vercel Cron (`*/15 * * * *`, `vercel.json`) → `GET/POST /v1/jobs/tick`
    → `runner.ts` sweeps every user (`resolveJobUsers` = the SAME `app_user ⋈ workspace_member`
    join as `resolveContext`, so a job can't fabricate a workspace). Per-user jobs decide due-ness
    in the user's LOCAL time (invariant #3) — a single global-midnight job would be wrong. Jobs are
    **state-scans, not edge-triggers**, so a late/skipped/double tick self-heals; `now` injectable.
  - **Cron auth** (`src/auth/cron.ts`): the one non-JWT surface. Constant-time `CRON_SECRET` check,
    **fails CLOSED** (missing env / missing / wrong → 401), takes NO user/workspace id from the
    caller — acts only on its own scan.
  - **Slippage detector** (`jobs/slippage.ts`): marks past **confirmed** days with a still-`planned`
    item → `slipped`, then calls the existing trigger-agnostic `createProposalInTx({trigger:'slippage'})`.
    **Invariant #5**: writes ONLY `daily_plan_day.status` + a proposal row — never a `daily_plan_item`,
    never `applyChanges` (it imports neither). Mark+propose commit in one tx (no slipped-day-without-proposal).
    Empty diff → no no-op proposal. **Cross-trigger product rule**: backs off (no proposal) when a pending
    `user_request`/`new_work_package` proposal exists — won't clobber user intent; a pending `slippage` may refresh.
  - **Morning brief** (`jobs/morningBrief.ts`): pref-gated; **catch-up via ledger**, not window-crossing —
    "local time ≥ `morning_brief_time` today AND no `notification_dispatch` row for the day" → sends once,
    so a skipped tick just sends late.
  - **Nudges** (`jobs/nudges.ts`): each pref-gated; dedupe key carries the triggering entity.
    `replan_needs_review` (key=proposal_id) + `streak_at_risk` (key=local date, after `STREAK_RISK_HOUR`)
    are **FULLY WIRED**; `milestone_approaching` (key=milestone_id) is **STUBBED** — "approaching" needs the
    milestone `projected_date` projection, which is Phase 6 (gate + key wired, predicate returns nothing).
  - **Stale-token prune** (`jobs/prune.ts`): deletes `device` rows with `last_seen_at` past `STALE_DEVICE_DAYS`.
  - **Push delivery**: built behind a swappable `Notifier` (`jobs/notifier.ts`); v1 binds `LogNotifier`
    (logs the send). Real APNs is a later drop-in — not blocking. Idempotency ledger = `notification_dispatch`
    (`(user, kind, dedupe_key)` unique; claim-then-send via `INSERT … ON CONFLICT DO NOTHING`).
  - **8 tests pass** (`tests/jobs.test.ts`): slipped-marking + exactly-one-proposal + idempotent re-run;
    invariant #5 (items byte-identical before/after); the **per-user timezone boundary** (UTC vs UTC-12,
    same instant); cross-trigger backoff; morning-brief due/flag/dedupe; replan-nudge gate+dedupe; stale prune.
- **Roadmap projection & daily-planning reads (Phase 6)**: the roadmap is a PROJECTION,
  never stored (data-model §6) — only proposed/confirmed days persist; the rest is recomputed.
  - **Planner 2A** (`src/planner`): additive optional `edges: TaskEdge[]` → STAGED UNBLOCKING
    (a successor lands the day after its placed predecessors). Empty/absent edges = byte-identical
    to before, so `/propose` is untouched (proven by a test). This grows the ONE scheduler instead
    of forking it (Decision #19 intent). `/propose` passes `blocked` on + no edges; the projection
    passes `blocked:false` + real edges — same engine, two callers.
  - **`src/domain/projection.ts`** (read-only consumer): re-projects all incomplete tasks from the
    day after the last persisted day, expanding `work_package_dependency` → task edges (m×n, like
    flow). `projectMilestoneDates` is the SINGLE source flow/replan/nudges/roadmap derive milestone
    dates from — so they agree by construction. `projected_date` is ALWAYS derived, **never stored**
    (no `milestone.projected_date` column — don't add one). projected_date = latest gating-task date,
    or **null** if any gating task can't be placed.
  - **`GET /roadmap`** (`roadmapRead.ts`): persisted days (tables) ∪ projected days (`projected:true`),
    milestones as landmarks with `projected_date`, `position:{today,current_streak}`. Pure read —
    a row-count test asserts it writes nothing (invariant #5). `GET /days/{date}` (⚡eng today, 404 absent).
  - **Edits** (`planItems.ts`): `POST /days/{date}/items` (user_added; unblocked 422 / dup 409 /
    planned-elsewhere 409; create-day-if-absent via the shared `createConfirmedDay`), `PATCH /plan-items/{id}`
    (reorder / defer), `DELETE /plan-items/{id}` (⚡eng), `POST /tasks/{id}/pull-forward` (origin
    pulled_forward, frees the old planned row → deferred), `PATCH /days/{date}` lock, `POST /tasks/{id}/reopen`.
    All are direct USER actions — allowed under #5.
  - **Deferred items ACTIVATED**: flow `next_milestone.projected_date` (was null), replan
    `milestone_impacts.to_projected_date` (now the canonical projection, not a window heuristic —
    a test asserts it EQUALS what /roadmap shows), and the `milestone_approaching` nudge (was dormant).
  - **11 tests pass** (`tests/roadmap.test.ts`): planner empty-edges-identical + cross-project A→B
    (proves edge-awareness was necessary), projection staging + projected_date + null + time-fixed pin,
    #5 read-only row-count, persisted∪projected merge, the replan↔roadmap unification, and the edit endpoints.
- **Companion & motivation reads (Phase 7)**: the identity/stats/devices/prefs/points
  surface + the morning-brief composite (api §2/§3/§10/§12). Mostly reads over already-stored data.
  - **`/me`** (`src/domain/me.ts`): `GET` profile+workspace+role; `PATCH` display_name/timezone — the
    timezone change shifts the midnight-local boundary **forward only** by construction (nothing
    derived is stored, so past `activity_date`/`plan_date` rows are never rewritten — future
    `localDate` calls just read the new zone; no backfill). `GET /me/stats` = the single denormalized
    `user_stats` row. `POST /me/engagement` ⚡eng reuses the shared `recordEngagement`+`refreshStats`
    (idempotent upsert — second call same local day is a no-op on the row).
  - **Devices** (`src/domain/devices.ts`): `GET/POST/DELETE /me/devices`. Upsert by the globally-unique
    `push_token` (`ON CONFLICT (push_token)` refreshes `last_seen_at`, never dups) — the one write NOT
    scoped by workspace tenancy: a re-register by a different user **reassigns** the row (last-login-wins,
    pushes follow the current device owner). Delete is caller-scoped (other user's device → 404).
    **This closes the Phase-5 gap**: real `device` rows now exist for the morning-brief/nudge jobs to
    target (live APNs still stubbed behind `LogNotifier` until push certs).
  - **Notif prefs** (`src/domain/notificationPrefs.ts`): `GET/PUT /me/notification-preferences` — full
    replace of the 1:1 row (`morning_brief_time` is local wall-clock; scheduler resolves via timezone).
  - **Points** (`src/domain/points.ts`): `GET /point-events` (append-only READ; `from`/`to` resolved in
    the USER's timezone via new `dates.zonedDayStart` so a range means whole LOCAL days, not a UTC
    instant; `event_type` filter) + `GET /point-rules` (seed read). **No mutation endpoint** — scoring
    only happens in the completion cascade (Principle 3, no penalty events).
  - **Morning brief** (`src/domain/morningBriefRead.ts`): `GET /morning-brief` ⚡eng — the composite.
    Returns today's day+items, the **FULL stats row (points AND streak — both, per api §4.6)**, the
    pending recovery proposal headline, position, and `next_milestone` (nearest by **earliest
    projected_date**, with `days_away`). Composes the new read-only `roadmapRead.readDay` core (factored
    out of `getDay`) so engagement is recorded **exactly once** at the brief level; an empty morning
    returns `today: null` (never 404). `getDay` keeps its own ⚡eng for the standalone endpoint.
  - **12 tests pass** (`tests/companion.test.ts`): device upsert/refresh/reassign + caller-scoped delete;
    prefs full-replace; engagement idempotency (double call → one row); morning-brief points+streak+pending
    +next_milestone + records-eng-once + empty→today:null; point-events event_type + local-day from/to
    bounds, incl. a **UTC-12 timezone boundary** proving bounds are local end-of-day not a UTC instant.
- **Pre-Phase-8 consolidation/audit** (2026-06-14): a no-feature pass over 7 phases.
  - **Spine guards** (`tests/spine.test.ts`, 8 tests): the load-bearing Phase-1 paths that were
    only ever live-verified over HTTP now have CI coverage — `proposeRoadmap → confirmDay` incl. the
    **409-on-wrong-status** path-rendering gate (invariant #5) + 404; create-path **422s asserted at
    the API layer** (estimation either/or + time-fixed pairing throw an `ApiError` BEFORE the insert,
    not just the DB CHECK backstop); and **bootstrap idempotency** (repeat `auth_subject` → `created:false`).
  - **Audit actions**: api §10 `/morning-brief` spec updated to the built shape (full `stats`, nullable
    `today`, `next_milestone.{id,projected_date}`); CLAUDE.md records invariant #2 is assumed-not-constrained;
    stale "STUBBED" header in `jobs/nudges.ts` corrected (milestone nudge is wired since Phase 6).
  - **Findings left as-is**: the 4 GET-one reads folded into the Phase-8 line (named so they can't slip);
    post-v1 seams (live APNs/`ApnsNotifier`, planner difficulty constants, multi-member) untouched.
- **WBS edits/deletes + roll-ups (Phase 8 — the final phase)**: the remaining WBS surface, all
  reads/edits over already-stored data + two pure derivations.
  - **GET-ones** (all NEW — none existed before): `GET /goals/{id}` (+`?include=progress`),
    `GET /projects/{id}` (+`?include=progress`), `GET /work-packages/{id}` (+`?include=tasks`),
    `GET /tasks/{id}` (returns derived `blocked`). Added as `get*` fns in the existing domain modules.
  - **PATCH/DELETE** for goal/project/work-package/task. PATCH reuses the create-time validators on the
    **MERGED** state (estimate either/or + time-fixed pairing computed against the existing row, so a
    partial patch can't violate the invariant; DB CHECKs still backstop). `goal status→achieved` stamps
    `achieved_at`, `project status→completed` stamps `completed_at` (server-side, never client-written).
    **task PATCH refuses `status`/`completed_at` → 422** (those go through complete/reopen so the cascade
    can't be bypassed). Every DELETE is a single workspace-scoped `deleteFrom` that **RELIES on the FK
    cascade** (goal→project→{milestone,work_package}→task→{deps,plan_items}); the point ledger survives
    because its sources are `ON DELETE SET NULL` — no manual subtree deletion in the app.
  - **Milestones CRUD** (`src/domain/milestones.ts` — NEW; only the achievement cascade + reads pre-existed,
    POST did NOT): `GET /projects/{id}/milestones` (with `achieved`, `wp_done/wp_total`, and `projected_date`
    from the shared `projectMilestoneDates` — same source as flow/roadmap), `POST` (plain insert), `PATCH`
    (title/desc/position — `achieved_at` is NEVER in the input shape, set once by the cascade), `DELETE`
    (**ungroups, never deletes work**: composite FK `ON DELETE SET NULL (milestone_id)` nulls member WPs).
  - **Progress roll-ups** (`src/domain/progress.ts` — NEW, the SINGLE source): `GET /goals/{id}/progress`
    + `GET /projects/{id}/progress` + the `?include=progress` expansions all call `computeGoalProgress`/
    `computeProjectProgress`. Estimate sums use the SAME `resolveHours` the flow diagram uses (agree by
    construction). **`percent_done` is task-count based** (`tasks_done/tasks_total`), NOT estimate-weighted:
    estimates are nullable so a weighted % would skew/break on partial data. Known tradeoff — a 5-min and a
    3-day task weigh equally — accepted because `estimate_*_hours` ship in the same payload for a client that
    wants a weighted view.
  - **11 tests pass** (`tests/wbs.test.ts`): GET-one extras; PATCH happy paths + status-stamps; task-PATCH
    status→422; milestone-PATCH can't set achieved_at; cross-workspace 404 across all verbs; milestone
    create/list membership counts; **DELETE-milestone-ungroups (WPs survive, milestone_id null)**;
    **DELETE-goal cascades subtree but point ledger survives with task_id nulled**; DELETE happy/re-delete-404;
    progress roll-up correctness (2×2h tasks → 50% after one done, goal == project).
- **Web app prototype parity pass (2026-06-19)**: the React/Vite frontend was aligned with the dark
  "Earned Momentum" prototype. Additive API reads now return richer roadmap task refs, proposal
  `refs.tasks`, project-list progress, and a frontend `tasksApi.pullForward` wrapper. UI updates landed
  across Shell/Home (expandable Today bar + WBS sidebar), Onboarding (7-step flow), Roadmap/Replan
  (horizontal path + inline day/proposal review), Project workbench (Flow default, WP-only graph, inline
  right-side WP/task panel), Table/Timeline controls, and Celebration polish. See
  `docs/ui-design-gap-updates.md` for the UI-specific summary.
- **Persistent context**: `CLAUDE.md`, this file.

## Roadmap (one line per phase)
- **Phase 1 — Vertical spine** ✅ — 8-endpoint slice + completion cascade, live-verified.
- **Phase 2 — Dependencies + acyclicity** ✅ — task/WP dependency edges, API-layer cycle check (invariant #1); lights up `blocked` + the planner.
- **Phase 3 — Project Flow Diagram** ✅ — `/projects/{id}/flow`: derived node states + critical path to next milestone.
- **Phase 4 — Replanning pipeline** ✅ — `replan_proposal` create/list/get/approve/reject, JSONB diff + transactional apply, time-fixed conflicts (invariants #4/#5), locked-day immunity, `new_work_package` proposal. `user_request` + `new_work_package` wired; `slippage` shares the machinery (detector job is Phase 5).
- **Phase 5 — Notifications & jobs** ✅ — slippage detector, morning-brief push, contextual nudges, stale-token prune; one Vercel-Cron tick + per-user local-time scan, `CRON_SECRET`-guarded. Milestone-nudge predicate stubbed pending Phase 6 projection; real APNs stubbed behind `Notifier`.
- **Phase 6 — Roadmap projection & daily-planning reads** ✅ — `GET /roadmap` (persisted ∪ projected via staged-unblocking planner edges), `/days/{date}`, plan-item add/defer/reorder, pull-forward, reopen, day lock. Activated the three deferred `projected_date` consumers (flow/replan/nudge).
- **Phase 7 — Companion & motivation reads** ✅ — `/me*`, stats, engagement, devices, notif-prefs, points/history, `/morning-brief` composite. Closed the Phase-5 device gap. (Milestones CRUD deferred to Phase 8 WBS edits.)
- **Phase 8 — WBS reads/edits/deletes + roll-ups** ✅ — the GET-ones (+`?include=progress`/`tasks`/`blocked`),
  PATCH+DELETE for goal/project/work-package/task (deletes rely on the FK cascade; ledger survives via SET NULL),
  milestones CRUD (POST was NEW — only the achievement cascade pre-existed; DELETE ungroups WPs, never deletes work),
  and the shared progress roll-up (`src/domain/progress.ts`, task-count `percent_done`). 11 tests in `tests/wbs.test.ts`.
- **Web frontend prototype parity** ✅ — React/Vite UI aligned to `TodoMapp Prototype.dc.html`: Shell/Home,
  Onboarding, Roadmap/Replan, Project workbench, WP task side panel, and Celebration. Details in
  `docs/ui-design-gap-updates.md`.

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
- **Real APNs send** — `LogNotifier` stub today; the `ApnsNotifier` drop-in now only needs push certs
  (the `device` rows it ships to exist as of Phase 7 `POST /me/devices`).
- **Automated browser verification** — frontend typecheck/tests/build pass, but `agent-browser` was not
  installed locally, so browser automation was not run. Manual HTTP checks confirmed Vite and Next dev
  servers start/respond.

## Open items / risks
- **🐛 BUG (tracked, NOT fixed) — replan apply 409s on a stale `deferred` row on the target day
  (found 2026-06-18 during F3 frontend verification).** `applyChanges` (`src/domain/replan/apply.ts`,
  the Phase-4 keystone) does defer-before-insert: it frees the task's `status='planned'` row, then
  inserts the new `origin='replanned'` item on `to_date`. But the free step only touches the PLANNED
  row — if a **`deferred`** row for that same task already sits on the `to_date` day, the insert violates
  `UNIQUE (daily_plan_day_id, task_id)` (`daily_plan_item_daily_plan_day_id_task_id_key`) → **409**, and
  the whole approve transaction rolls back.
  - **Reproduction (the sequence that trips it):** confirm a day X with task T on it → defer T on day X
    (`PATCH /plan-items/{id}` `status:'deferred'`, or a drawer remove that leaves a deferred row) → run a
    replan whose target re-plans T back onto day X → approve. Apply tries to insert T on X where the
    deferred T row already exists → 409. (F3's live walk hit this exact 409 before it was reordered to do
    destructive day-edits last — but that's **avoidance**, not a fix; the next caller won't know to.)
  - **Proposed fix:** before inserting on `to_date`, free/ignore ANY existing row for that task on the
    target day, not just the planned one — e.g. widen the defer/free step to the target day (delete or
    no-op the stale deferred row), or make the insert an upsert that revives the existing row to
    `planned`/`replanned`. Mind the partial unique `one_planned_per_task` and Principle 3 (deferred history
    is never penalized — reviving/removing a deferred placeholder is fine; it carried no scoring).
  - **Test gap:** the 87-test backend suite MISSED this. Add a Phase-4-style (`tests/replan`) case that
    reproduces defer-on-day-X → replan-back-onto-X → approve and asserts a clean apply (no 409), plus the
    locked-day and time-fixed guards still holding. Do this as a **deliberate backend fix**, not folded
    into an F-phase commit.
- **🐛 GAP (tracked, NOT a bug) — no targeted "pin task to an exact date" REPLAN PROPOSAL primitive
  (found 2026-06-18 during F4 frontend planning). This is the 2nd backend gap the frontend has
  surfaced (after the apply.ts deferred-row collision above); both are legitimate findings, correctly
  deferred.** The F4 Timeline (web-screens §C.2) wants "drag a flexible bar to a new date → propose a
  change (Principle 1, never a silent rewrite)." But the backend offers NO way to express "propose
  putting THIS task on THAT specific day":
  - `POST /replan-proposals` scope is only `{ project_id?, from_date? }` — the planner re-derives the
    whole schedule from scratch and takes no per-task target date.
  - `PATCH /tasks/{taskId}` (incl. `fixed_date`/`is_time_fixed`) is a **silent direct write** — it does
    NOT generate a proposal the way WP/task *create* does (`new_work_package` trigger, see
    `src/domain/workPackages.ts`). So pinning a task via PATCH would bypass the review step entirely.
  - **F4's honest interim (shipped):** a cross-day Timeline drag fires
    `POST /replan-proposals {trigger:'user_request', scope:{project_id, from_date}}` (from_date = the
    earlier of the bar's current date and the drop date) → ReplanReview → approve/reject. The drop day
    is a **re-plan ANCHOR, not a guaranteed landing slot**; the gesture is labelled "re-plan from here,"
    never "pin to this day." A drag that PRETENDED to pin to the drop date would be a UI that lies about
    what the backend can do — so we don't build that. Time-fixed bars are drag-DISABLED (pinned,
    Decision #7), with a pin affordance so it reads as intentional.
  - **Proposed fix (two options, decide when targeted placement is actually needed — NOT now):**
    1. **`PATCH /tasks` auto-proposes** when confirmed roadmap days exist — mirror `createWorkPackage`'s
       `new_work_package` path: a scheduling-relevant edit (`fixed_date`, estimate, time-fixed) on a task
       whose work flows into confirmed days returns `{ task, replan_proposal? }` instead of silently
       writing. Keeps the existing PATCH surface; adds the Principle-1 review hop for in-place edits.
       Same concern applies to WP-sheet estimate/time-fixed edits on already-scheduled tasks.
    2. **A replan scope carrying a per-task PIN** — extend `POST /replan-proposals` scope with something
       like `{ pins: [{ task_id, fixed_date }] }` that the planner treats as a soft/hard placement
       constraint for that analysis only (not a stored `task.fixed_date`). The planner produces a
       proposal that actually honors the drop date; the user reviews real placement, and approving it
       commits — without permanently making the task time-fixed. This is the faithful version of the
       Timeline drag, but it touches the planner interface (`proposeDays` input) + analyze, so it's the
       heavier change. Mind the locked-day + time-fixed (invariant #4) guards either way.
- Auth — ✅ resolved 2026-06-13 via **JWKS**. This project is on Supabase "JWT Signing Keys";
  user access tokens are ES256, public key published at `…/auth/v1/.well-known/jwks.json`.
  `src/auth/verifier.ts` verifies against JWKS (selects by `kid`, caches, asymmetric-only),
  derived from `SUPABASE_URL` — no secret needed, survives legacy-HS256 revocation + rotation.
  The legacy `SUPABASE_JWT_SECRET` is verify-only/deprecated and unused by the verifier.
  _To confirm end-to-end: log in, decode the access_token header → expect `alg: ES256`._
- Two intentional deviations from the docs are recorded in `CLAUDE.md` → "Known deviations".
- **Cron cadence — Hobby-plan limitation (2026-06-15).** Phase 5 was designed around a **15-min tick**
  (`*/15 * * * *`) so per-user jobs fire near each user's LOCAL boundary (morning brief at
  `morning_brief_time`, slippage at local midnight). **Vercel Hobby allows cron at most ONCE PER DAY**, so
  `vercel.json` is set to `0 0 * * *` purely to let the deploy succeed — coarser than the design intends.
  The jobs themselves are unchanged (they're state-scans that self-heal on a late/skipped tick), so a daily
  tick still works, just with up-to-24h latency on local-time-sensitive sends. **Verification doesn't depend
  on the schedule**: trigger `/v1/jobs/tick` manually with `CRON_SECRET`. **Production options (decide at
  real-user launch, not needed now):** (a) **Vercel Pro** → restore `*/15 * * * *`, design works as-built;
  (b) stay on **Hobby + an external scheduler** (e.g. GitHub Actions / cron-job.org) hitting `/v1/jobs/tick`
  every 15 min with the secret. Either restores the cadence without touching the runner.
- **Pre-launch: wipe test workspaces (both stores) (2026-06-15).** Prod-deploy verification left test
  artifacts in production: the `walk@example.com` workspace (Journey-A live walk) and an older "Eren"
  workspace. Inert until real users exist — clean them as a **pre-launch step**, not now.
  **Two INDEPENDENT stores, no FK between them** (`app_user.auth_subject` is a plain unique `text` column,
  NO FK into `auth.users` — auth stays swappable per §9.2 rule 5), so a full cleanup is TWO operations:
  (1) **domain DB** — `DELETE FROM workspace …` cascades all that workspace's goals/projects/…/points via
  `workspace_id ON DELETE CASCADE`, then `DELETE FROM app_user …` mops up user-scoped rows (`device`,
  `notification_preference`); `point_rule` seed survives (no workspace FK). (2) **Supabase Auth** — delete
  each login via `DELETE {SUPABASE_URL}/auth/v1/admin/users/{auth_subject}` (service-role key). Deleting
  one store does NOT touch the other. Pre-launch full wipe = `DELETE FROM workspace; DELETE FROM app_user;`
  (keeps the `point_rule` seed) + delete all auth users. Do BOTH workspaces, BOTH stores.
