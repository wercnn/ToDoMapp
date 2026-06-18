# FRONTEND PROGRESS — where we left off

Live build checklist for the **web frontend** (the separate Vite SPA in `frontend/`).
Mirrors `docs/PROGRESS.md` (backend). Terse; **update at the end of each work session.**
Design source of truth: `docs/design/project/` (TodoMapp Prototype = interactive prototype,
Earned Momentum = design system, `uploads/web-screens.md` = screen-by-screen spec).

_Last updated: 2026-06-18 — F0 (foundations) + F1 (login + shell + Home) built and
**verified live** end-to-end against the local backend cross-origin. typecheck + build green
both sides._

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
- **F2 — Onboarding (A1–A7)** ⏳ NEXT — the WBS create-path (goal→project→breakdown→milestones&deps
  →capacity→first roadmap). Save-per-step (each step commits via its `/v1` create call).
- **F3 — Roadmap + replan** — path timeline + day drawer + replan proposal review/approve.
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

## Dev loop / ops notes
- **Local loop:** run backend (`npm run dev` :3000) + `cd frontend && npm run dev` (:5173);
  `frontend/.env.local` points `VITE_API_BASE_URL` at `http://localhost:3000/v1`. Exercises real
  cross-origin CORS daily. Alt: point at deployed Vercel `/v1` (needs middleware deployed + `WEB_ORIGIN`).
- **Before deploying the frontend:** ship the backend CORS middleware + set `WEB_ORIGIN` to the
  deployed frontend origin, else authed requests fail preflight.
- `frontend/.env.local` is gitignored; `.env.example` is committed. Frontend uses `VITE_SUPABASE_URL`
  / `VITE_SUPABASE_ANON_KEY` (public anon values, same project as backend).
- Test creds (test users, pre-launch cleanup list): Eren workspace; `walk@example.com` / `WalkTest1234!`.
