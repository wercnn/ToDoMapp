# API Endpoint Specification
## Goal-Driven Planning Platform — REST API v1

**Status:** v1 for review · **Date:** June 11, 2026
**Derived from:** `product-foundation.md` (§4 Core Features, §5 Surface Responsibilities, §6 User Journeys) and `data-model.md` (§4 Tables, §6 Derived State, §7 Application-Enforced Invariants)
**Target:** API-first backend (§7 of foundation: no business logic in clients) serving both the Web Workspace and the iOS Companion.

---

## 1. API Conventions

| Convention | Rule |
|---|---|
| **Base path** | `/v1` — all routes below are relative to it. JSON request/response bodies. |
| **Auth** | `Authorization: Bearer <JWT>` (Supabase Auth in Phase 1). The API resolves the token's subject → `app_user.auth_subject` → workspace via `workspace_member`. Auth stays swappable (data-model §1 "Auth coupling"). |
| **Tenancy** | Every request is implicitly scoped to the caller's workspace. No `workspace_id` is ever accepted from the client; it is injected server-side. Cross-workspace access → `404`. |
| **IDs** | UUIDs. Clients *may* supply `id` on create (offline/sync-ready, data-model §1 "Primary keys"). |
| **Timestamps** | `created_at` / `updated_at` are server-managed; never accepted as input. |
| **Day boundary** | All `date` parameters are interpreted in `app_user.timezone` (midnight-local, invariant #3). |
| **Derived fields** | `blocked`, progress %, critical path, projected roadmap are computed at read time, never written by clients (data-model §6). |
| **Errors** | `400` malformed input · `401` unauthenticated · `404` not found / not in workspace · `409` state conflict (cycle, duplicate edge, double-plan, wrong status transition) · `422` invariant violation (either/or estimation, time-fixed pairing, moving time-fixed work, blocked task scheduling). |
| **Side effects** | Every behavior listed under *Behavior* runs in **one transaction** with the primary write (invariant #7: caches are transactional). |
| **Engagement** | Endpoints marked **⚡eng** record an `engagement_day` row (idempotent) and refresh `user_stats` — these are the actions that keep the streak alive (Decision #8). |

---

## 2. Identity & Account

Covers signup bootstrap, profile, and the cached home-screen stats. **Tables:** `app_user`, `workspace`, `workspace_member`, `user_stats`, `engagement_day`, `notification_preference`.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `POST` | `/auth/bootstrap` | First-login provisioning after external auth signup (Journey A step 1). | JWT + `{ email, display_name?, timezone? }` | `201` `{ user, workspace }` | Idempotent: if `auth_subject` exists, returns existing records. Otherwise creates `app_user`, a personal `workspace` (named after owner), an `owner` row in `workspace_member`, and seeds `user_stats` (zeros) + default `notification_preference`. Enforces invariant #2 (one member per workspace in v1). | `app_user`, `workspace`, `workspace_member`, `user_stats`, `notification_preference` |
| `GET` | `/me` | Current user profile + workspace context. | – | `200` `{ user, workspace, role }` | Pure read; resolves JWT subject → user → workspace. | `app_user`, `workspace_member`, `workspace` |
| `PATCH` | `/me` | Update profile. | `{ display_name?, timezone? }` | `200` `user` | Timezone change shifts the midnight-local boundary *going forward* (streak/slippage detection, invariant #3); past `activity_date` / `plan_date` rows are not rewritten. | `app_user` |
| `GET` | `/me/stats` | Companion home-screen read: streak + points. | – | `200` `{ total_points, current_streak, longest_streak, last_engaged_date }` | Single-row read of the denormalized cache (data-model §4.6); rebuildable from ledger + engagement rows. | `user_stats` |
| `POST` | `/me/engagement` **⚡eng** | Explicitly record "I opened and engaged with my plan today". | – | `200` `{ activity_date, current_streak }` | Idempotent upsert of today's (local) `engagement_day`; subsequent calls same day are no-ops. Recomputes `current_streak` / `longest_streak` / `last_engaged_date` in `user_stats`. Also fired implicitly by every ⚡eng endpoint. | `engagement_day`, `user_stats`, `app_user` (timezone read) |

---

## 3. Devices & Notification Preferences

Push endpoints for the Companion and user-controlled notification settings (§4.6: notifications inform and invite, they don't nag). **Tables:** `device`, `notification_preference`.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/me/devices` | List registered push devices. | – | `200` `[device]` | Pure read. | `device` |
| `POST` | `/me/devices` | Register an APNs push token. | `{ platform: 'ios', push_token }` | `201` `device` | Upsert by unique `push_token` (re-registering refreshes `last_seen_at` instead of duplicating). | `device` |
| `DELETE` | `/me/devices/{deviceId}` | Unregister a device (logout / token revoked). | – | `204` | Hard delete; stops pushes to that endpoint. | `device` |
| `GET` | `/me/notification-preferences` | Read notification settings. | – | `200` `preference` | Pure read of the 1:1 row. | `notification_preference` |
| `PUT` | `/me/notification-preferences` | Replace notification settings. | `{ morning_brief_enabled, morning_brief_time, milestone_nudges_enabled, replan_nudges_enabled, streak_nudges_enabled }` | `200` `preference` | Full replace; `morning_brief_time` is local wall-clock, scheduler resolves it via `app_user.timezone`. | `notification_preference`, `app_user` (timezone read) |

---

## 4. Goals

Top of the WBS (§4.1, web-primary). **Tables:** `goal` (+ descendant reads for roll-ups).

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/goals` | List goals. | Query: `status?`, `horizon?` | `200` `[goal]` (ordered by `position`) | Filtered read; uses index `(workspace_id, status)`. | `goal` |
| `POST` | `/goals` | Create a goal (Journey A step 1). | `{ title, description?, horizon, position? }` | `201` `goal` | Validates non-empty title; `horizon` ∈ short/mid/long (Decision #4). | `goal` |
| `GET` | `/goals/{goalId}` | Read one goal. | Query: `include=progress?` | `200` `goal` (+ `progress`) | With `include=progress`, computes the derived roll-up (% done, estimate sums) over descendant tasks (data-model §6). | `goal` (+ read `project`, `work_package`, `task`) |
| `PATCH` | `/goals/{goalId}` | Edit title/description/horizon/status/position. | Partial goal fields | `200` `goal` | `status → 'achieved'` sets `achieved_at` server-side; clients never write `achieved_at` directly. | `goal` |
| `DELETE` | `/goals/{goalId}` | Delete a goal and its whole subtree. | – | `204` | Cascades: projects → milestones / work packages → tasks → dependency edges → plan items (FK `ON DELETE CASCADE` chain). Point ledger survives via `SET NULL` sources. | `goal` → cascade `project`, `milestone`, `work_package`, `task`, `task_dependency`, `work_package_dependency`, `daily_plan_item` |
| `GET` | `/goals/{goalId}/progress` | Progress roll-up powering bars and "days to milestone". | – | `200` `{ percent_done, tasks_done, tasks_total, estimate_done_hours, estimate_total_hours }` | Pure computation over descendants; never stored (data-model §6). | read `project`, `work_package`, `task` |

---

## 5. Projects

Concrete initiatives owning capacity, milestones, and a roadmap segment (§3.1). **Tables:** `project` (+ graph reads for the flow diagram).

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/goals/{goalId}/projects` | List a goal's projects. | Query: `status?` | `200` `[project]` | Read via index `(goal_id)`. | `project` |
| `POST` | `/goals/{goalId}/projects` | Create a project. | `{ title, description?, capacity_hours_per_day, target_end_date?, position? }` | `201` `project` | Validates `0 < capacity ≤ 24` (the planner fills each day up to this value, Decision #12). | `project` |
| `GET` | `/projects/{projectId}` | Read one project. | Query: `include=progress?` | `200` `project` | Optional derived roll-up as with goals. | `project` (+ descendant reads) |
| `PATCH` | `/projects/{projectId}` | Edit project incl. capacity & target end date. | Partial project fields | `200` `project` | Capacity change re-shapes the *computed* projection immediately (it's never stored, data-model §4.4 intro); already-**confirmed** days are untouched — adapting them requires a `user_request` replan proposal (Principle 1). `status → 'completed'` sets `completed_at`. | `project` |
| `DELETE` | `/projects/{projectId}` | Delete project subtree. | – | `204` | Cascade as for goals, scoped to the project. | `project` → cascade chain |
| `GET` | `/projects/{projectId}/flow` | **Project Flow Diagram** payload (§4.2, Principle 5). | – | `200` `{ nodes: [wp/task + derived_status(done\|in_progress\|blocked\|open)], edges: [task_deps, wp_deps], critical_path: [task_id…], next_milestone }` | Fully derived: blocked = incomplete predecessors at either level; critical path computed from graph + estimates to next unachieved milestone (data-model §6). Nothing is written. | read `work_package`, `task`, `task_dependency`, `work_package_dependency`, `milestone` |
| `GET` | `/projects/{projectId}/progress` | Project-level roll-up + days-to-milestone. | – | `200` progress object | Pure computation. | read `work_package`, `task`, `milestone` |

---

## 6. Milestones

Named checkpoints = sets of work packages (Decision #5); membership lives on `work_package.milestone_id`. **Tables:** `milestone`, `work_package`.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/projects/{projectId}/milestones` | List milestones with achievement state and projected dates. | – | `200` `[milestone + { achieved, projected_date?, wp_done, wp_total }]` | `projected_date` is derived from the roadmap projection; `achieved_at` read as stored. | `milestone`, read `work_package`, plan/graph reads |
| `POST` | `/projects/{projectId}/milestones` | Create a milestone. | `{ title, description?, position? }` | `201` `milestone` | Plain insert; the work-package set is assembled by PATCHing `work_package.milestone_id` (§7 below). | `milestone` |
| `PATCH` | `/milestones/{milestoneId}` | Edit title/description/position (users can adjust milestones, §3.2). | Partial fields | `200` `milestone` | `achieved_at` is **never** writable — it is set exactly once by the task-completion cascade (§8) so celebration + extra points fire once. | `milestone` |
| `DELETE` | `/milestones/{milestoneId}` | Remove a milestone without deleting work. | – | `204` | Composite FK `ON DELETE SET NULL` ungroups its work packages (data-model §4.2: "deleting a milestone ungroups its work packages instead of deleting work"). | `milestone`, `work_package` (milestone_id nulled) |

---

## 7. Work Packages

The planning unit for estimation and dependencies; a to-do list object (§3.1). **Tables:** `work_package` (+ `replan_proposal` when added mid-flight).

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/projects/{projectId}/work-packages` | List work packages. | Query: `milestone_id?`, `open=true?` | `200` `[work_package + derived_status]` | `open=true` uses the partial index `WHERE completed_at IS NULL` (planner scans). Derived status (open/in_progress/done/blocked) computed per data-model §6. | `work_package`, dep tables (derived read) |
| `POST` | `/projects/{projectId}/work-packages` | Create a work package — **mid-flight additions are a normal operation** (§4.1, Journey C). | `{ title, description?, milestone_id?, estimate_hours? XOR difficulty?, is_time_fixed?, fixed_date?, position? }` | `201` `{ work_package, replan_proposal? }` | Validates either/or estimation (`num_nonnulls ≤ 1`, Decision #13) and time-fixed pairing (`is_time_fixed = (fixed_date IS NOT NULL)`); composite FK guarantees milestone is same-project. **If confirmed roadmap days exist**, the planning engine analyzes impact and creates a pending `replan_proposal` (trigger `new_work_package`) — the roadmap itself is *not* touched until approval (Principle 1). | `work_package`, `milestone` (FK), `replan_proposal` |
| `GET` | `/work-packages/{wpId}` | Read one work package. | Query: `include=tasks?` | `200` `work_package` (+ `[task]`) | Optional child-task expansion. | `work_package`, `task` |
| `PATCH` | `/work-packages/{wpId}` | Edit, incl. (re)assigning to a milestone or toggling time-fixed. | Partial fields | `200` `work_package` | Same validation set as create; clearing/raising estimates may shift the computed projection. `completed_at` is a server-maintained cache, never client-writable. | `work_package` |
| `DELETE` | `/work-packages/{wpId}` | Delete a work package and its tasks. | – | `204` | Cascades tasks, dependency edges, and their plan items. If planned items on confirmed days disappear, the engine raises a `user_request`-style proposal to tidy the roadmap rather than silently rewriting it. | `work_package` → cascade `task`, dep tables, `daily_plan_item`; `replan_proposal` |

---

## 8. Tasks

The atomic unit of doing — what appears in Daily Goals and gets checked off (§3.1). Completion is the system's most side-effect-rich write. **Tables:** `task` plus the full motivation/planning cascade.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/work-packages/{wpId}/tasks` | List a work package's to-do lines. | Query: `status?` | `200` `[task + blocked]` | `blocked` derived from both dependency levels (data-model §6) — never stored. | `task`, `task_dependency`, `work_package_dependency` |
| `POST` | `/work-packages/{wpId}/tasks` | Create a task (Workspace full edit; Companion "quick add", §5 surface table). | `{ title, notes?, estimate_hours? XOR difficulty?, is_time_fixed?, fixed_date?, position? }` | `201` `task` | Same either/or estimation + time-fixed pairing CHECKs as work packages. | `task` |
| `GET` | `/tasks/{taskId}` | Read one task. | – | `200` `task + blocked` | Derived blocked flag included. | `task`, dep tables |
| `PATCH` | `/tasks/{taskId}` | Edit title/notes/estimates/time-fixed/position. | Partial fields | `200` `task` | `status` / `completed_at` are **not** editable here — use the dedicated transitions below so the cascade and scoring rules can't be bypassed. | `task` |
| `POST` | `/tasks/{taskId}/complete` **⚡eng** | Check off a task (Journeys B/C/E). | – | `200` `{ task, points_awarded, day_completed?, milestone_achieved? }` | One transaction: ① `status='done'`, `completed_at` set (CHECK-paired). ② Today's `daily_plan_item` for this task → `completed`. ③ `point_event(task_completed)` inserted — the partial unique index makes scoring **once ever** (re-completion never farms points, data-model §4.6). ④ If all sibling tasks done → `work_package.completed_at` cache set. ⑤ If that completes a milestone's WP set → `milestone.achieved_at` set once, `point_event(milestone_achieved)` awarded, celebration payload returned (Journey E). ⑥ If it was the day's last planned item → `daily_plan_day.status='completed'`, `completed_at` set, `point_event(daily_goal_completed)` awarded once. ⑦ `user_stats` + engagement updated. | `task`, `daily_plan_item`, `daily_plan_day`, `work_package`, `milestone`, `point_event`, `point_rule`, `engagement_day`, `user_stats` |
| `POST` | `/tasks/{taskId}/reopen` | Un-complete a task. | – | `200` `task` | Clears `status`/`completed_at`; clears the `work_package.completed_at` cache if affected; today's plan item returns to `planned`. **Points are never revoked** — the ledger is append-only and each source scores exactly once, ever (no penalty events, Principle 3). An already-achieved milestone stays achieved. | `task`, `work_package`, `daily_plan_item` |
| `POST` | `/tasks/{taskId}/pull-forward` **⚡eng** | Work ahead: pull a future task onto today (Decision #12, `origin='pulled_forward'`). | `{ to_date? }` (default: local today) | `200` `{ item, day }` | Validates the task is **unblocked** (invariant #6 → `422`), not already on the target day (`409`), then moves the *planned* item: old item deleted or marked `deferred`, new `daily_plan_item` created with `origin='pulled_forward'` — satisfying the partial unique "one planned day per task". Creates the target `daily_plan_day` if absent. | `task`, dep tables (blocked check), `daily_plan_item`, `daily_plan_day`, `engagement_day`, `user_stats` |
| `DELETE` | `/tasks/{taskId}` | Delete a task. | – | `204` | Cascades its dependency edges and plan items; ledger rows survive via `SET NULL`. | `task` → cascade `task_dependency`, `daily_plan_item`; `point_event` (SET NULL) |

---

## 9. Dependencies

Directed "must finish before" edges at two levels (Decision #9). Acyclicity is an **API-layer** reachability check on every insert (no DB triggers, §9.2 rule 6). **Tables:** `task_dependency`, `work_package_dependency`.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `POST` | `/task-dependencies` | Create a task→task edge (Journey A step 3, assisted drawing on web). | `{ predecessor_task_id, successor_task_id }` | `201` `edge` | Rejects self-dependency (`422`), duplicate edge (`409`, PK), and **any cycle** (`409` after graph reachability check — invariant #1). Successor becomes derived-`blocked` until the predecessor completes. | `task_dependency` |
| `DELETE` | `/task-dependencies/{predecessorTaskId}/{successorTaskId}` | Remove an edge. | – | `204` | Downstream `blocked` state recomputes implicitly — it was never stored. | `task_dependency` |
| `POST` | `/work-package-dependencies` | Create a WP→WP edge. | `{ predecessor_wp_id, successor_wp_id }` | `201` `edge` | Same validation set. Tasks inside a WP with an incomplete upstream WP are blocked at planner level (data-model §4.3). | `work_package_dependency` |
| `DELETE` | `/work-package-dependencies/{predecessorWpId}/{successorWpId}` | Remove a WP edge. | – | `204` | As above. | `work_package_dependency` |

---

## 10. Roadmap & Daily Planning

The roadmap is a **projection** — only proposed/confirmed day-steps are persisted; everything beyond is computed on demand (data-model §4.4). Planning is hybrid: system proposes → user adjusts → user confirms (§4.3). **Tables:** `daily_plan_day`, `daily_plan_item`.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/roadmap` | The Duolingo-style path: persisted past/confirmed days + computed projection, milestones as landmarks, "you are here" (§4.3). | Query: `from?`, `to?`, `goal_id?` | `200` `{ days: [persisted ∪ projected], milestones: [{ id, projected_date }], position: { today, current_streak } }` | Persisted days come from the tables; days beyond the confirmed horizon are **re-projected live** from WBS + dependencies + estimates + capacity + time-fixed dates (data-model §6) and flagged `projected: true`. Nothing is written. | `daily_plan_day`, `daily_plan_item`; read `task`, `work_package`, deps, `project`, `milestone`, `user_stats` |
| `POST` | `/roadmap/propose` | Ask the planner to (re)materialize proposed day-steps for the near horizon (Journey A step 5). | `{ horizon_days?, goal_id? }` | `201` `[daily_plan_day + items]` (status `proposed`) | Planner fills each day up to `capacity_hours_per_day` with **unblocked** work only, pins time-fixed items to their dates, orders by dependencies/deadlines. Existing `confirmed` and `is_locked` days are never altered (Principle 1). Re-running replaces only `proposed` days. | `daily_plan_day`, `daily_plan_item`; reads full graph |
| `GET` | `/days/{date}` **⚡eng** (when it's today) | A day-step with its Daily Goals — the Companion's main read (Journey B step 2). | – | `200` `{ day, items: [{ item, task }] }` | Viewing today's plan is a qualifying engagement (Decision #8: viewing counts). `404` if no persisted day for that date. | `daily_plan_day`, `daily_plan_item`, `task`; `engagement_day`, `user_stats` |
| `POST` | `/days/{date}/confirm` **⚡eng** | User approves the proposed day (hybrid loop step 2→3). | – | `200` `day` | `proposed → confirmed`, `confirmed_at` set. `409` if not in `proposed` status. This is the only path from proposal to path-rendering (invariant #5). | `daily_plan_day`, `engagement_day`, `user_stats` |
| `PATCH` | `/days/{date}` | Lock/unlock a day. | `{ is_locked }` | `200` `day` | A locked day is off-limits to the planner and to replan proposals (data-model §4.4). | `daily_plan_day` |
| `POST` | `/days/{date}/items` **⚡eng** | User adds a task to a day (swap/adjust step of the hybrid loop). | `{ task_id, position? }` | `201` `item` (`origin='user_added'`) | Validates: task **unblocked** (`422`), not already on this day (`409`, unique `(day, task)`), not actively planned on another day (`409`, partial unique) — moving it instead goes through pull-forward or a replan. | `daily_plan_item`, `daily_plan_day`; dep tables (blocked check); `engagement_day`, `user_stats` |
| `PATCH` | `/plan-items/{itemId}` | Reorder an item or mark it deferred. | `{ position?, status?: 'deferred' }` | `200` `item` | `deferred` records that the work moved to a later day — the new day gets a *fresh* item, history is preserved, never penalized (Principle 3). `completed` is not settable here (only via task completion). | `daily_plan_item` |
| `DELETE` | `/plan-items/{itemId}` **⚡eng** | Remove an item from a day (defer without target). | – | `204` | Task returns to the unplanned pool; the projection picks it up again. | `daily_plan_item`, `engagement_day`, `user_stats` |
| `GET` | `/morning-brief` **⚡eng** | **The signature composite read** behind the morning notification (§4.6, Journey B/D). | – | `200` `{ today: { day, items }, streak, pending_proposal?: { id, summary }, position, next_milestone: { title, days_away } }` | One call gives the Companion everything for the wake-up moment: today's Daily Goals, streak, any pending recovery proposal headline (`summary`, e.g. *"2 tasks from yesterday are pending…"*), roadmap position, nearest milestone. Opening it records engagement. | `daily_plan_day`, `daily_plan_item`, `task`, `user_stats`, `replan_proposal` (partial pending index), `milestone`, `engagement_day` |

---

## 11. Replanning Pipeline (Human in the Loop)

Persists detect → analyze → propose → **approve** (§4.4 of the foundation). The plan mutates **only** through approval (invariant #5); this group is the audit trail proving nothing was silently rewritten. **Tables:** `replan_proposal` → applied onto `daily_plan_day` / `daily_plan_item`.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/replan-proposals` | List proposals, default pending. | Query: `status?=pending` | `200` `[proposal]` | Uses the partial pending index ("anything awaiting approval?"). | `replan_proposal` |
| `GET` | `/replan-proposals/{proposalId}` | Full proposal detail for the review UI. | – | `200` `{ proposal, changes: { moves: [{task_id, from_date, to_date}], milestone_impacts, time_fixed_conflicts: [{task_id, options: [prioritize, descope, renegotiate]}] } }` | Returns the structured JSONB diff. Time-fixed conflicts are always a **separate section with explicit options** — never auto-moves (Decision #7, Journey D step 3). | `replan_proposal` |
| `POST` | `/replan-proposals` | User-initiated replan (deep replans on web, §5). | `{ trigger: 'user_request', scope?: { project_id?, from_date? } }` | `201` `proposal` (pending) | Engine analyzes dependency impact, milestone/deadline risk, classifies flexible vs. time-fixed, produces `summary` + `changes`. Any older pending proposal is marked `expired` (superseded, data-model §9.4). System triggers `slippage` / `new_work_package` create proposals through the same machinery (see §13 jobs). | `replan_proposal`; reads graph + plan tables |
| `POST` | `/replan-proposals/{proposalId}/approve` **⚡eng** | Accept the proposal, optionally edited (Journey D step 4). | `{ edits?: changes-shaped diff }` | `200` `{ proposal, applied: { days, items } }` | One transaction: status → `approved` (or `edited_approved` with `applied_changes` stored), `resolved_by_user_id`/`resolved_at` set; the diff is applied — moved items marked `deferred` on the old day, fresh items created with `origin='replanned'`, milestones' projected dates shift. The apply step **rejects (`422`) any diff that moves a time-fixed item without an explicit user option choice** (invariant #4). Locked days untouched. Replanning counts as engagement — the streak continues (Principle 3, "steering, not failing"). | `replan_proposal`, `daily_plan_day`, `daily_plan_item`, `engagement_day`, `user_stats` |
| `POST` | `/replan-proposals/{proposalId}/reject` **⚡eng** | Decline the proposal. | – | `200` `proposal` | Status → `rejected`; the plan stays exactly as it was. Engaging with the decision still counts for the streak. | `replan_proposal`, `engagement_day`, `user_stats` |

---

## 12. Points & History

Read-side of the motivation layer; all *writes* happen inside the task-completion cascade (§8). **Tables:** `point_rule`, `point_event`.

| Method | Route | Description | Input | Output | Behavior | Tables |
|---|---|---|---|---|---|---|
| `GET` | `/point-rules` | Current point values per event type. | – | `200` `[{ event_type, points }]` | Read-only seed data; tuning is a row update server-side, never a client write (Decision #11). | `point_rule` |
| `GET` | `/point-events` | Scoring history for progress views. | Query: `from?`, `to?`, `event_type?` | `200` `[event]` | Append-only ledger read via index `(workspace_id, occurred_at)`. There is deliberately no penalty event type to query (Principle 3). | `point_event` |

---

## 13. System Jobs (no public routes — listed for completeness)

These run server-side and feed the endpoints above; they never mutate the plan directly (invariant #5: never from a background job alone).

| Job | Schedule | What it does | Tables |
|---|---|---|---|
| **Slippage detector** | Per-user at **local midnight** (invariant #3) | Marks days with incomplete items `slipped`; runs the analyze step (flexible vs. time-fixed, downstream impact, milestone risk) and creates a pending `replan_proposal` (trigger `slippage`) for the morning brief (Journey D). | `daily_plan_day`, `daily_plan_item`, `replan_proposal` |
| **Morning brief push** | Per-user at `morning_brief_time` (local) | Sends the wake-up notification pointing the Companion at `GET /morning-brief`. | `notification_preference`, `device`, `app_user` |
| **Contextual nudges** | Event/threshold driven | "Milestone approaching", "plan needs review", "streak at risk" (gentle, engagement-framed) — each gated by its preference flag. | `notification_preference`, `device`, `user_stats`, `milestone`, `replan_proposal` |
| **Stale-token pruning** | Periodic | Deletes devices unseen past a threshold via `last_seen_at`. | `device` |

---

## 14. Endpoint → Table Coverage Matrix

Quick cross-reference: every table in the data model and the endpoint groups that touch it.

| Table | Written by | Read by |
|---|---|---|
| `workspace`, `workspace_member` | §2 bootstrap | §2 |
| `app_user` | §2 | everywhere (auth + timezone) |
| `device` | §3 | §3, §13 jobs |
| `notification_preference` | §3 | §3, §13 jobs |
| `goal` | §4 | §4, §10 roadmap |
| `project` | §5 | §5, §10 (capacity), flow/progress |
| `milestone` | §6 create/edit; §8 achievement cascade | §5 flow, §6, §10, morning brief |
| `work_package` | §7; §8 completion cache | §5 flow, §7, §10 projection |
| `task` | §8 | §5 flow, §8, §10, morning brief |
| `task_dependency`, `work_package_dependency` | §9 | §5 flow, §8 blocked checks, §10 planner |
| `daily_plan_day`, `daily_plan_item` | §10; §11 approve-apply; §8 completion mirror; §13 slippage marking | §10, morning brief, §11 analysis |
| `replan_proposal` | §11; §7 mid-flight WP; §13 slippage job | §11, morning brief |
| `point_rule` | seed/ops only | §8 award, §12 |
| `point_event` | §8 cascade | §12 |
| `engagement_day` | every ⚡eng endpoint | streak computation |
| `user_stats` | every ⚡eng endpoint + §8 cascade | §2 stats, §10 morning brief |

---

*Next step: review against `data-model.md` §7 invariants; on approval, this table drives the OpenAPI spec and the API business-logic module boundaries (dependency module, planner, replan engine, scoring).*
