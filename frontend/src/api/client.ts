/**
 * The typed API client — the ONLY data path to /v1 (§9.2 rule 1). Screens never
 * fetch directly and never touch Supabase except for login. Every call:
 *   - targets VITE_API_BASE_URL (a required full URL incl. /v1 — fail loud if unset)
 *   - attaches the Supabase ES256 token as a Bearer (no cookies → simple CORS)
 *   - maps the backend's { error: { code, message } } envelope to a typed ApiError
 *   - surfaces 401 to a registered handler so the app can bounce to /login
 */
import type { ApiErrorBody } from "@api-types";
import { getAccessToken } from "@/auth/supabase";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "VITE_API_BASE_URL is not set (must be the full /v1 URL). Copy .env.example to .env.local.",
  );
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The app registers a handler (set in the session layer) to react to 401s
// (token expired / signed out) without each call site knowing about routing.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip the bearer (e.g. bootstrap runs its own token handling server-side). */
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const body = data as ApiErrorBody | undefined;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? `Request failed (${res.status})`,
      body?.error?.details,
    );
  }

  return data as T;
}
