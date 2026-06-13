/**
 * Auth verification behind a narrow interface so the provider stays swappable
 * (§9.2 rule 5 — auth loosely coupled; data-model §1 "Auth coupling"). v1 verifies
 * Supabase Auth's HS256 JWTs against the project JWT secret. Nothing in the
 * business layer knows it's Supabase — it only sees `AuthClaims`.
 */
import { jwtVerify } from "jose";
import { unauthenticated } from "../lib/errors";

export interface AuthClaims {
  /** The external auth subject → maps to app_user.auth_subject. */
  subject: string;
  email?: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthClaims>;
}

class SupabaseJwtVerifier implements TokenVerifier {
  #secret: Uint8Array;

  constructor(secret: string) {
    this.#secret = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<AuthClaims> {
    try {
      const { payload } = await jwtVerify(token, this.#secret);
      if (!payload.sub) throw new Error("token missing sub");
      const email = typeof payload.email === "string" ? payload.email : undefined;
      return { subject: payload.sub, email };
    } catch {
      throw unauthenticated("Invalid or expired token");
    }
  }
}

let verifier: TokenVerifier | null = null;

export function getVerifier(): TokenVerifier {
  if (!verifier) {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) {
      throw new Error("SUPABASE_JWT_SECRET is not set. See .env.example.");
    }
    verifier = new SupabaseJwtVerifier(secret);
  }
  return verifier;
}

/** Test seam: inject a fake verifier. */
export function setVerifier(v: TokenVerifier | null): void {
  verifier = v;
}

/** Extract the bearer token and verify it, returning the claims. */
export async function verifyBearer(req: Request): Promise<AuthClaims> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) throw unauthenticated("Missing Authorization: Bearer <token>");
  return getVerifier().verify(match[1]!);
}
