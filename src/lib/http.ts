/**
 * HTTP helpers for App Router route handlers: JSON responses and a wrapper that
 * turns thrown ApiErrors (and recognised Postgres errors) into the right status
 * codes. Handlers stay focused on domain logic and just throw.
 */
import { NextResponse } from "next/server";
import { ApiError, mapDbError } from "./errors";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body as object, { status });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

function errorBody(err: ApiError) {
  return { error: { code: err.code, message: err.message, details: err.details } };
}

/**
 * Wrap a route handler so domain code can simply `throw new ApiError(...)` (or
 * let a Postgres constraint fire) and get a correct JSON error response.
 */
export function handler<Args extends unknown[]>(
  fn: (req: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    try {
      return await fn(req, ...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return json(errorBody(err), err.status);
      }
      const mapped = mapDbError(err);
      if (mapped) {
        return json(errorBody(mapped), mapped.status);
      }
      console.error("Unhandled error in route handler:", err);
      return json(
        { error: { code: "internal_error", message: "Internal server error" } },
        500,
      );
    }
  };
}

/** Parse a JSON request body, throwing a 400 on malformed input. */
export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new ApiError(400, "bad_request", "Request body is not valid JSON");
  }
}
