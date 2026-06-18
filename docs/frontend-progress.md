# FRONTEND PROGRESS — where we left off

Live build checklist for the **web frontend** (the separate Vite SPA in `frontend/`).
Mirrors `docs/PROGRESS.md` (backend). Terse; **update at the end of each work session.**
Design source of truth: `docs/design/project/` (TodoMapp Prototype = interactive prototype,
Earned Momentum = design system, `uploads/web-screens.md` = screen-by-screen spec).

_Last updated: 2026-06-18 — F0 + F1 + **F2 (Onboarding A1–A7)** built. F2's create-path AND
the resume ladder are **verified live** cross-origin against the running /v1 (full HTTP walk +
all-branch resume on a fresh user). typecheck + build green both sides; every onboarding module
transforms clean through Vite. The visual browser click-through is the user's final confirm._

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
- **Verification (2026-06-18):**
  - Frontend `tsc --noEmit` clean; `vite build` → static `dist/` (145 modules; `@api-types` resolved
    type-only, no server code in bundle). Backend `tsc --noEmit` clean with the two new files.
  - **CORS proven via curl** against local backend: preflight 204 + origin echo; 401 path still
    carries CORS headers; disallowed origin gets none; 401 envelope matches the client parser.
  - **Live login proven:** browser sign-in (Eren workspace) renders Home with real data, no errors —
    the two-separate-deployables proof (cross-origin + base-URL + bearer auth all exercised).
    Also verified `walk@example.com` via password grant: ES256 token, `/v1/me` + `/v1/goals` resolve
    its workspace (1 goal "Ship v1").

## Roadmap (one line per phase)
- **F0 — Foundations** ✅ — tokens, API client, auth, CORS, type-sharing, scaffold.
- **F1 — Vertical slice** ✅ — login + app shell + Home on live `/v1`; cross-origin proven.
- **F2 — Onboarding (A1–A7)** ✅ — the WBS create-path (goal→project→breakdown→milestones&deps
  →capacity→first roadmap), save-per-step + resumable. Create-path + resume proven live cross-origin.
- **F3 — Roadmap + replan** ⏳ NEXT — path timeline + day drawer + replan proposal review/approve.
  Timeline drag→reschedule emits a REPLAN PROPOSAL (never silent PATCH, Principle 1).
- **F4 — Project Detail** — Table → Flow (React Flow, drag-to-connect, cycle 409 as calm message) →
  Timeline/Gantt + WP right-side sheet. Heaviest screen; code-split here.
- **F5 — Celebration + polish** — milestone dialog/animation, light-theme pass, empty states,
  reduced-motion.

## Not built yet / deferred
- Full shadcn sidebar/sheet/dialog primitives (hand-built shell for F1; pull shadcn per-screen at F3/F4).
- Today-strip hover-expand popover (web-screens §0.2) — TopBar shows the summary; popover deferred.
- Light/dark theme toggle UI (tokens support both; no switcher control yet).
- Bundle code-splitting (526 kB at F1; split at F4 when React Flow lands).
- Onboarding for additional goals after first run (web-screens open Q #3).
- **F2 scope cuts (intentional):** A4 dependencies are WP-level only and the drawn-edge list is
  session-local — viewing/editing the FULL existing dependency graph + task-level edges is Project
  Detail / Flow (F4). A4's "suggested orderings" assist is deferred (manual draw + calm cycle-409 ships).
  A1/A2 Back-edit persists via PATCH; A3 items each commit on add. Editing an already-built WBS mid-flow
  beyond A1/A2 is F4's job, not onboarding's.
- **Test residue:** an empty `confirmed` 2026-06-18 day lingers in `walk@example.com` from a verification
  walk (no day-delete endpoint; harmless — walk was already "complete" via its real 2026-06-15 day).
  On the pre-launch cleanup list. For manual F2 testing use a FRESH signup (first-run is the onboarding path).

## Dev loop / ops notes
- **Local loop:** run backend (`npm run dev` :3000) + `cd frontend && npm run dev` (:5173);
  `frontend/.env.local` points `VITE_API_BASE_URL` at `http://localhost:3000/v1`. Exercises real
  cross-origin CORS daily. Alt: point at deployed Vercel `/v1` (needs middleware deployed + `WEB_ORIGIN`).
- **Before deploying the frontend:** ship the backend CORS middleware + set `WEB_ORIGIN` to the
  deployed frontend origin, else authed requests fail preflight.
- `frontend/.env.local` is gitignored; `.env.example` is committed. Frontend uses `VITE_SUPABASE_URL`
  / `VITE_SUPABASE_ANON_KEY` (public anon values, same project as backend).
- Test creds (test users, pre-launch cleanup list): Eren workspace; `walk@example.com` / `WalkTest1234!`.
