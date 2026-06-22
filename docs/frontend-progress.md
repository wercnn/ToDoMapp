# FRONTEND PROGRESS — where we left off

Live build checklist for the **web frontend** (the separate Vite SPA in `frontend/`).
Mirrors `docs/PROGRESS.md` (backend). Terse; **update at the end of each work session.**
Design source of truth: `docs/design/project/` (TodoMapp Prototype = interactive prototype,
Earned Momentum = design system, `uploads/web-screens.md` = screen-by-screen spec).

_Last updated: 2026-06-18 — F0–F3 + **F4 (Project Detail: Table · Flow · Timeline · WP sheet)** built
(typecheck + vite build green both sides; live cross-origin walk pending). F0 + F1 + F2 + **F3 (Roadmap + replan review/approve)** built. F3's
keystone (`buildApproveEdits`) is unit-tested (7/7) AND the full flow is **verified live** cross-origin
against the running /v1: both approve branches (plain + edited/time-fixed renegotiate), the 422
backstop + rollback, reject-leaves-untouched, and the cross-origin plan-item DELETE — 29/29 checks
on a throwaway user. typecheck + vite build green both sides. The visual browser click-through is the
user's final confirm._

## Architecture (locked)
- **Separate frontend project** (Option B), sibling folder `frontend/` in the same repo. Chosen
  because AWS migration is committed — frontend/backend independent from day one. Destined for
  S3 + CloudFront (static `dist/`). The `/v1` backend is complete/deployed/verified — untouched
  except the one CORS addition.
- **Stack:** Vite + React + TypeScript SPA, React Router, TanStack Query, Tailwind v4 + design
  tokens as CSS vars, shadcn-style primitives (added per-screen as needed). Supabase email/pw for
  LOGIN ONLY → ES256 bearer on every `/v1` call. Dark theme default, light supported.
- **Two migration guardrails:**
  1. `VITE_API_BASE_URL` — required full `/v1` URL, no default; client throws if unset (fails loud).
  2. CORS lives in backend `src/middleware.ts` (not the route wrapper — preflight never reaches a
     handler). `WEB_ORIGIN` allow-list includes `http://localhost:5173` by default.
- **Type sharing:** the backend's PURE `src/api-types.ts` barrel (zero imports → no server dep can
  leak into the browser bundle) is the single source of truth, alias-imported as `@api-types`.
  Frontend `tsc --noEmit` is the drift backstop. Verified: types-only, bundle stays clean.

## Done
- **F0 — Foundations** ✅
  - **Backend (additive only, no `/v1` logic touched):**
    - `src/api-types.ts` — JSON DTO contract (enums + entities + composites: MorningBrief, DayView,
      Roadmap, Progress, CompleteTaskResult, ApiErrorBody). Models on-the-wire JSON (ISO-string dates,
      numeric-as-string), NOT Kysely `Selectable` rows.
    - `src/middleware.ts` — CORS for `/v1/*`: OPTIONS→204, `WEB_ORIGIN` allow-list (echo, never `*`),
      no `Allow-Credentials` (bearer not cookies). `.env.example` documents `WEB_ORIGIN`.
  - **Frontend scaffold (`frontend/`):** Vite+React+TS, Tailwind v4 (`styles/tokens.css` both themes
    + `styles/index.css` `@theme` mapping → `bg-*`/`text-*`/`progress`/`system` utilities), Nunito,
    aliases `@`→src and `@api-types`→`../src/api-types.ts`, `.env.example`, `.gitignore`, README.
  - **API client** (`src/api/client.ts`): required base URL, bearer from Supabase session, error
    envelope→typed `ApiError`, 401→registered handler. Resource modules (`src/api/index.ts`):
    auth.bootstrap, me, morningBrief, goals(+progress), roadmap, days, tasks(complete/reopen).
  - **Auth** (`src/auth/`): `supabase.ts` (login-only browser client + `getAccessToken`),
    `session.tsx` (session context, auth-change subscription, wires the 401→signOut handler).
  - **UI primitives:** `components/ui/button.tsx` (shadcn/cva; chunky 3D primary/system variants),
    `components/StatusPill.tsx` (every domain status, glyph+color+label), `ProtectedRoute.tsx`.
- **F1 — Vertical slice** ✅ (login + shell + Home on live data)
  - `screens/Login.tsx` — email/pw → `signIn` → idempotent `/auth/bootstrap` → redirect.
  - `screens/shell/` — `Shell` (sidebar + topbar + outlet), `Sidebar` (goals tree from `GET /goals`),
    `TopBar` (streak/points/proposal-dot from `GET /morning-brief`, sign-out).
  - `screens/Home.tsx` — today's Daily Goals from `GET /morning-brief` with working check-off
    (`POST /tasks/{id}/complete|reopen` → invalidate), next-milestone card, pending-proposal nudge,
    goal cards (`GET /goals/{id}?include=progress`). Empty new-user state handled.
  - `App.tsx` routes (login public; shell guarded; /roadmap placeholder), `main.tsx` providers.
- **F2 — Onboarding (A1–A7)** ✅ (the WBS create-path, Journey A — "ambition → roadmap")
  - **Backend (additive only):** extended the pure `src/api-types.ts` barrel with the F2 DTOs —
    `WorkPackage`, `Milestone`, `WorkPackageStatus`, `WorkPackageWith{Status,Tasks}`, `TaskWithBlocked`,
    `MilestoneWithState`, `Task/WorkPackageDependency`, `ReplanProposal`, `CreateWorkPackageResult`,
    `ProposedDay`, `ProjectWithProgress`. No `/v1` logic touched. (Also corrected the stale
    "Phase 8 not built" note in `CLAUDE.md` — it's all built; `docs/PROGRESS.md` already said so.)
  - **API client (`api/index.ts`):** added the create-path modules — goals(create/update/createProject/
    listProjects), `projectsApi` (get/update/list WPs+milestones/create milestone/create WP),
    `workPackagesApi` (listTasks/update/remove/createTask), `dependenciesApi` (create/remove WP+task edges),
    `roadmapApi.propose`, `daysApi.confirm`, task/WP delete. `Estimation`/`TimeFixed` are discriminated
    unions so a body structurally can't carry both estimate fields or an unpaired time-fixed flag.
  - **Screens (`screens/onboarding/`):** `Onboarding` (resume gate + wizard), `useOnboardingResume`
    (the ladder), `Stepper`, and `steps/` A1 Goal · A2 Project · A3 Breakdown · A4 Milestones&Deps ·
    A5 Capacity · A6+A7 Roadmap(propose→confirm). Form primitives: `components/ui/input.tsx`
    (Input/Textarea/Field), `fields.tsx` (segmented either/or `EstimateControl`, coupled `TimeFixedControl`),
    `steps/ItemForm.tsx`, `steps/_chrome.tsx`, `lib/apiError.ts` (calm 422/409 messages).
  - **Save-per-step + resumability:** every step commits via its real `/v1` write; a partial WBS is a
    valid state. `useOnboardingResume` runs a ≤3-read ladder (roadmap→goals→projects) and drops a
    returning user at the right step, REUSING existing entities (no duplicate goal/project). Entry gate
    in `App.tsx` (`EntryGate` at `/`) routes never-confirmed users into `/onboarding`, else `/home`.
  - **A2/A5 capacity (locked decision):** project created at A2 with `DEFAULT_CAPACITY_HOURS`; A5 PATCHes
    the real value and shows it clearly as a "starting point — confirm or change", never a silent default.
  - **Confirm-date gotcha:** A7 reads the date from the `/roadmap/propose` RESPONSE (earliest day),
    never hardcoded — feeds `/days/{date}/confirm`.
- **F2 verification (2026-06-18) — live HTTP against running `/v1`, cross-origin:**
  - CORS preflight explicitly proven for **PATCH + DELETE** (A4/A5 + deletes): 204 + origin echo +
    `Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS`.
  - **Full create-path walk** (real ES256 token, `Origin` header): A1→A7 all succeed; WP-create carries
    no `replan_proposal` pre-confirm; **422 `unprocessable`** for both-estimates and time-fixed-no-date;
    **409 `conflict`** "would create a dependency cycle"; propose→confirm using the **date from the propose
    response** → `confirmed`; `/roadmap` reflects it; goal-delete cascade cleans up.
  - **Resume ladder proven on a FRESH user across every branch:** empty→GOAL, +goal→PROJECT,
    +project→BREAKDOWN, +WP/task (abandon)→BREAKDOWN (resumes, no restart), +propose→ROADMAP,
    +confirm→COMPLETE; goal count stays 1 (no duplicate). Throwaway user deleted after.
  - typecheck + `vite build` green both sides; all 15 onboarding modules transform clean via Vite dev.
  - **Not yet done:** the visual browser click-through (no browser-drive tool here) — the data flow +
    resume logic are proven at the HTTP level; the user runs the on-screen walk as final confirmation.
- **F3 — Roadmap + replan review/approve** ✅ (web-screens §D — the human-in-the-loop core)
  - **Backend (additive only):** extended the pure `src/api-types.ts` barrel with the replan-diff DTOs —
    `ReplanMove`, `ReplanMilestoneImpact`, `TimeFixedConflict`, `TimeFixedResolution`, `TimeFixedOption`,
    `ReplanChanges`, `ReplanProposalDetail` (`{proposal, changes}`), `ApproveProposalResult`
    (`{proposal, applied:{days,items}}`). No `/v1` logic touched.
  - **API client (`api/index.ts`):** `daysApi.setLock/addItem`, `planItemsApi.patch/remove`,
    `replanApi.list/get/create/approve/reject`. `replanApi.approve(id, edits?)` — omit `edits` for a
    plain approve, pass the full edited diff for edited_approved.
  - **The keystone — `lib/buildApproveEdits.ts` (+ `.test.ts`, 7/7):** the pure builder that turns the
    review UI's state into the EXACT `edits` body apply.ts consumes. `TimeFixedDecision` is a
    discriminated union (renegotiate cannot be built without `new_fixed_date`). Critical correctness:
    `edits` REPLACES the stored `changes` (not merge), so the builder re-carries the original moves;
    each time-fixed move is built inseparably from its resolution, so apply's guard #4 (422) can't trip
    from a UI body. Mapping: descope→`to_date:null`+res, renegotiate→`to_date:new_fixed_date`+res,
    prioritize→no move, res only. `from_date = conflict.fixed_date` (apply's defer is a no-op-safe UPDATE
    if no item is materialized there).
  - **Screens (`screens/roadmap/`):** `Roadmap` (vertical day-step path — persisted ∪ projected days,
    projected flagged dashed/ghost, milestones as landmark rows at projected_date, "you are here" at
    today, a Replan/Review-proposal entry), `DayDrawer` (items + confirm/lock/add/reorder/defer/remove;
    add uses `useAddableTasks` — a lazy WBS walk for unscheduled unblocked tasks), `ReplanReview` (the
    3-section diff: Reschedules w/ include toggles · Milestone impact "projection, not committed" ·
    Time-fixed conflicts), `TimeFixedConflictControl`, `dates.ts`. New primitive: `components/ui/sheet.tsx`
    (hand-built right-side drawer). Route `/roadmap` live; TopBar proposal-dot navigates there.
  - **Principle 1, structural:** Roadmap is pure display (never auto-confirms); force-resolve-all
    (Approve disabled until every time-fixed conflict has a decision); NO cross-day drag in F3 — a
    cross-day move is F4's Timeline and MUST emit a proposal, flagged in `DayDrawer` so it can't be
    violated by day-level reordering (which is in-day position PATCH only).
- **F3 verification (2026-06-18) — live HTTP against running `/v1`, cross-origin (29/29):**
  - Throwaway Supabase user (admin-created), real ES256 token, `Origin` header on every call.
  - DELETE preflight 204 + Origin echo + `Allow: DELETE`; first real-flow cross-origin **plan-item DELETE → 204**.
  - Roadmap read (position.today + confirmed day); day drawer lock/unlock/reorder/defer.
  - **Plain approve** (empty body) → `approved`; **edited approve** (renegotiate, exact builder shape) →
    `edited_approved`, `task.fixed_date` updated, a replanned item placed; **422** when a time-fixed move
    lacks a resolution, proposal **still pending after rollback**; **reject** → `rejected`, roadmap byte-identical.
  - **Backend BUG discovered (not an F3 bug; tracked, not fixed here):** apply's defer-before-insert
    frees the PLANNED row but a leftover `deferred` row on the target day collides on
    `UNIQUE(daily_plan_day_id, task_id)` (409) when a task is deferred on a day and a later replan
    re-plans it onto that same day. Logged as a tracked backend bug + test gap in
    `docs/PROGRESS.md` → "Open items / risks" (with reproduction + proposed fix). The walk only
    **avoids** it by ordering destructive day-edits last — it is NOT worked around in F3 code.
- **Verification (2026-06-18):**
  - Frontend `tsc --noEmit` clean; `vite build` → static `dist/` (145 modules; `@api-types` resolved
    type-only, no server code in bundle). Backend `tsc --noEmit` clean with the two new files.
  - **CORS proven via curl** against local backend: preflight 204 + origin echo; 401 path still
    carries CORS headers; disallowed origin gets none; 401 envelope matches the client parser.
  - **Live login proven:** browser sign-in (Eren workspace) renders Home with real data, no errors —
    the two-separate-deployables proof (cross-origin + base-URL + bearer auth all exercised).
    Also verified `walk@example.com` via password grant: ES256 token, `/v1/me` + `/v1/goals` resolve
    its workspace (1 goal "Ship v1").

- **F4 — Project Detail** 🚧 BUILT (typecheck + build green both sides; live cross-origin walk pending)
  (web-screens §C — the workbench). New `screens/project/`: `ProjectDetail` (shell — header w/ inline
  capacity edit + progress roll-up + `[Table|Flow|Timeline]` switcher, URL `?view=`, **Table-default for
  F4**, flip to Flow-default once Flow is verified), `TableView` (WBS rows expandable to tasks, lazy
  per-WP task load on expand — no fan-out), `WorkPackageSheet` (reuses F3 `sheet.tsx` + F2 discriminated-
  union `EstimateControl`/`TimeFixedControl`; WP field edits + task CRUD + complete/reopen + position
  reorder), `AddWorkPackageSheet` (mid-flight add → direct create; user manually replans), `FlowView`
  (lazy), `TimelineView`, `flowGraph.ts` (pure ProjectFlow→React Flow mapping + dagre layout), `status.ts`.
  Sidebar now nests projects under goals (→ `/projects/:id`); route added to `App.tsx`.
  - **Backend (additive only):** Flow DTOs (`ProjectFlow`/`FlowNode`/`FlowEdges`/`DerivedStatus`) added to
    the pure `src/api-types.ts` barrel (they lived only in `src/domain/flow.ts`). API client: `projectsApi.getFlow`
    + `?include=progress`, `dependenciesApi.removeTaskEdge`, richer `workPackagesApi.update`, `tasksApi.update`.
  - **Sharp edge (a) — Flow cycle-409, no phantom edge:** `FlowView` (React Flow + dagre, lazy chunk) uses
    **create-then-add** — `onConnect` validates locally (self / kind-mismatch → calm inline reject, no API),
    POSTs the dep, and only on 201 invalidates→**refetches** the flow (so derived_status/critical_path can't go
    stale). A 409 (cycle/dup) / 422 (self) simply never adds the edge — no window for a phantom edge. Edge
    delete via select→DELETE→refetch. Critical-path nodes/edges emphasized; show-tasks toggle.
  - **Sharp edge (b) — Timeline drag = proposal, never silent PATCH (Principle 1):** a cross-day drag of a
    FLEXIBLE bar fires `POST /replan-proposals {trigger:'user_request', scope:{project_id, from_date}}`
    (from_date = earlier of source/drop day = re-plan ANCHOR) → shared `ReplanReview`. Honest framing
    "re-plan from here," NOT "pin to this day" (backend has no per-task target — logged gap, see below).
    Time-fixed bars are **drag-DISABLED** with a pin affordance/tooltip. Within-list reorder is NOT here
    (that's the sheet's position PATCH) — every axis drag is a day change ⇒ always a proposal.
  - **Code-split proven:** React Flow + dagre (228 kB JS + 16 kB CSS) land entirely in the lazy `FlowView`
    chunk; the main bundle stayed ~unchanged (596→605 kB, the +9 kB is the F4 non-Flow code).
  - **2nd backend gap logged** (`docs/PROGRESS.md` Open items): no targeted "pin task to exact date"
    proposal primitive — recorded as a future manual targeted replan action. Correctly deferred, like the
    apply.ts deferred-row bug.
  - **Build-time refinements (honest deviations from the plan, found during build):** (1) the flow payload
    OMITS milestone/estimate/time-fixed/position, so the Table is fed by `listWorkPackages`+lazy `listTasks`,
    NOT the flow payload (confirm #1). (2) The Timeline needs `is_time_fixed`/`fixed_date`, which flow+roadmap
    omit, so it fetches tasks per-WP (bounded fan-out, Timeline-only; a bulk project-tasks read would remove
    it). (3) In-sheet dependency editing deferred — it needs the full edge set (only the flow payload carries
    it); dependency CRUD lives on the Flow canvas. (4) Sheet/timeline reorder uses up/down + drag-to-day
    rather than pulling a DnD lib into the sheet.
  - **Not yet done:** the live cross-origin walk (Table status, sheet edit 422/time-fixed guards, Flow
    drag-connect + cycle-409 no-phantom-edge, Timeline drag→proposal→ReplanReview, time-fixed drag-disabled).

## Roadmap (one line per phase)
- **F0 — Foundations** ✅ — tokens, API client, auth, CORS, type-sharing, scaffold.
- **F1 — Vertical slice** ✅ — login + app shell + Home on live `/v1`; cross-origin proven.
- **F2 — Onboarding (A1–A7)** ✅ — the WBS create-path (goal→project→breakdown→milestones&deps
  →capacity→first roadmap), save-per-step + resumable. Create-path + resume proven live cross-origin.
- **F3 — Roadmap + replan** ✅ — path timeline + day drawer + replan proposal review/approve. The
  keystone (`buildApproveEdits`) unit-tested + the full flow verified live cross-origin (29/29).
  Force-resolve-all on time-fixed conflicts; no cross-day drag (deferred to F4, but the proposal-not-PATCH
  rule is flagged in the day drawer).
- **F4 — Project Detail** 🚧 BUILT (verify pending) — Table · Flow (React Flow + dagre, lazy; drag-to-connect
  create-then-add, cycle-409 = calm inline, no phantom edge) · Timeline/Gantt (hand-rolled; cross-day drag →
  REPLAN PROPOSAL, never silent PATCH; time-fixed drag-disabled) · WP right-side sheet. Code-split proven
  (React Flow only in the lazy chunk). 2nd backend gap (per-task pin proposal) logged with both options.
- **F5 — Celebration + polish** 🚧 BUILT (on-screen pass pending) — milestone celebration dialog
  (keys off the `milestone_achieved` field of the `/tasks/{id}/complete` response, via a root
  `CelebrationProvider`; fires once because it's set from the POST mutation's `onSuccess`, never a
  query/re-render — both Home + WP-sheet completion sites wire in); roadmap landmark now lights up
  green + shows its title (needed an additive widen of `GET /roadmap` milestones →
  `{ id, title, achieved, achieved_date, projected_date }`, the one backend touch); motion pass (check-off pop,
  green path-fill, progress-bar fill, proposal pulse — all CSS keyframes so the global
  reduced-motion rule catches them); light theme reachable (OS default + persisted toggle in TopBar,
  `--backdrop-glow` token replaces the hardcoded login/onboarding gradient); reusable `EmptyState`
  (Home no-goals, empty Flow, empty replan diff) + `Skeleton` loaders; Sheet focus-trap +
  return-focus + initial autofocus; lazy-Flow `ErrorBoundary`.
  - **Gap-fix (post-review):** fixed the bug where an achieved milestone *dropped off* the roadmap
    (projection can't date completed work → `projected_date` null). Added `achieved_date` (from
    `achieved_at`) to the `GET /roadmap` milestone entry; the landmark is now dated by
    `achieved_date ?? projected_date` so it stays visible and lit. `buildTimeline` extracted to a
    pure `timeline.ts` (+5 unit tests) and a backend roadmap regression added. Also: `bg-surface`
    (undefined utility → transparent) → `bg-surface-1` at 3 sites; reduced-motion now sets
    `animation-iteration-count:1` so infinite loops actually stop; time-fixed pill keeps its readable
    label; completion/reopen invalidate morning-brief+roadmap+goal at both sites; Home read error via
    `calmMessage`; celebration provider dedupes by `milestone_id` (belt-and-suspenders).

## Not built yet / deferred
- Full shadcn sidebar/sheet/dialog primitives (hand-built shell for F1; pull shadcn per-screen at F3/F4).
- Today-strip hover-expand popover (web-screens §0.2) — TopBar shows the summary; popover deferred.
- ~~Light/dark theme toggle UI~~ ✅ F5 — OS default + persisted manual toggle in the TopBar.
- Bundle code-splitting (526 kB at F1; split at F4 when React Flow lands).
- Onboarding for additional goals after first run (web-screens open Q #3).
- **F2 scope cuts (intentional):** A4 dependencies are WP-level only and the drawn-edge list is
  session-local — viewing/editing the full position/WP dependency model is Project
  Detail / Flow (F4). A4's "suggested orderings" assist is deferred (manual draw + calm cycle-409 ships).
  A1/A2 Back-edit persists via PATCH; A3 items each commit on add. Editing an already-built WBS mid-flow
  beyond A1/A2 is F4's job, not onboarding's.
- **Test residue:** an empty `confirmed` 2026-06-18 day lingers in `walk@example.com` from a verification
  walk (no day-delete endpoint; harmless — walk was already "complete" via its real 2026-06-15 day).
  On the pre-launch cleanup list. For manual F2 testing use a FRESH signup (first-run is the onboarding path).

## Dev loop / ops notes
- **Frontend tests:** `cd frontend && npm test` (vitest, added at F3) — pure unit tests, no DB. The
  replan-approve contract (`buildApproveEdits`) lives here; run it before touching the approve shape.
- **Local loop:** run backend (`npm run dev` :3000) + `cd frontend && npm run dev` (:5173);
  `frontend/.env.local` points `VITE_API_BASE_URL` at `http://localhost:3000/v1`. Exercises real
  cross-origin CORS daily. Alt: point at deployed Vercel `/v1` (needs middleware deployed + `WEB_ORIGIN`).
- **Before deploying the frontend:** ship the backend CORS middleware + set `WEB_ORIGIN` to the
  deployed frontend origin, else authed requests fail preflight.
- `frontend/.env.local` is gitignored; `.env.example` is committed. Frontend uses `VITE_SUPABASE_URL`
  / `VITE_SUPABASE_ANON_KEY` (public anon values, same project as backend).
- Test creds (test users, pre-launch cleanup list): Eren workspace; `walk@example.com` / `WalkTest1234!`.
