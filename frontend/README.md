# TodoMapp — Web Frontend

Vite + React + TypeScript SPA. Talks **only** to the `/v1` API over HTTP (no direct
DB/Supabase data access); Supabase is used for login solely to obtain the ES256
access token the backend verifies. Builds to a static `dist/` — the artifact for
S3 + CloudFront.

This is a **separate project** from the backend (sibling folder in the same repo).
The only coupling is the shared HTTP contract: `../src/api-types.ts`, imported here
as `@api-types` (type-only, so nothing server-side enters the bundle).

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in the three values
npm run dev                  # http://localhost:5173
```

`.env.local`:
- `VITE_API_BASE_URL` — full `/v1` URL (e.g. the deployed Vercel API, or `http://localhost:3000/v1`).
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — the same Supabase project the backend uses (public anon values).

## Dev loop

Point `VITE_API_BASE_URL` at the **deployed** Vercel `/v1` and just run the Vite
dev server — you get live data with no local backend, and you exercise the real
cross-origin CORS path every day. Run the backend locally only when changing the
API itself (set the base URL to `http://localhost:3000/v1`).

The deployed backend must allow this origin: set `WEB_ORIGIN` on the backend to
include `http://localhost:5173` (already allowed by default) plus the deployed
frontend origin.

## Scripts
- `npm run dev` — dev server
- `npm run build` — typecheck + static build to `dist/`
- `npm run typecheck` — `tsc --noEmit` (the api-types drift guard)
- `npm run preview` — serve the production build locally
