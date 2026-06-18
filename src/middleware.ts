/**
 * CORS for the /v1 API — the ONE backend change Option B (separate frontend)
 * requires. The web client is a different origin (Vite dev server, later an
 * S3/CloudFront domain), so the browser sends a preflight OPTIONS for any request
 * carrying `Authorization`. That preflight NEVER reaches a route handler, so CORS
 * must live here in middleware, not in `src/lib/http.ts`.
 *
 * Allow-list driven by `WEB_ORIGIN` (comma-separated). We echo the caller's Origin
 * only when it's on the list — never a blanket `*` — and we do NOT send
 * `Access-Control-Allow-Credentials` because the client authenticates with a
 * bearer token, not cookies (keeps CORS in its simple mode).
 *
 * Everything else about /v1 is untouched.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// localhost:5173 (Vite default) is allowed from day one so the dev loop
// — local Vite pointed at the DEPLOYED /v1 — passes CORS without a redeploy.
const DEFAULT_ORIGINS = ["http://localhost:5173"];

function allowedOrigins(): string[] {
  const fromEnv = (process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin && allowedOrigins().includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return headers;
}

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  // Preflight: short-circuit with 204 + the CORS headers.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  // Actual request: let it through, then attach CORS headers to the response.
  const res = NextResponse.next();
  cors.forEach((value, key) => res.headers.set(key, value));
  return res;
}

export const config = {
  matcher: "/v1/:path*",
};
