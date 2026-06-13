/**
 * Auth verification behind a narrow interface so the provider stays swappable
 * (§9.2 rule 5 — auth loosely coupled; data-model §1 "Auth coupling"). Nothing in
 * the business layer knows it's Supabase — it only sees `AuthClaims`.
 *
 * This project is on Supabase's **JWT Signing Keys** system: user access tokens
 * are signed with an asymmetric key (currently ES256) whose public half is
 * published at the project's JWKS endpoint. We verify against JWKS, selecting the
 * key by `kid` and caching it — so the verifier handles key rotation (and the
 * eventual revocation of the legacy HS256 secret) with no code change.
 *
 * Accepted algorithms are locked to asymmetric (ES256/RS256). We deliberately do
 * NOT accept HS256: the legacy shared-secret tokens are verify-only and age out
 * within the access-token TTL, and refusing HS256 closes the alg-confusion attack
 * (forging a token with the public key used as an HMAC secret).
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { unauthenticated } from "../lib/errors";

export interface AuthClaims {
  /** The external auth subject → maps to app_user.auth_subject. */
  subject: string;
  email?: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthClaims>;
}

class SupabaseJwksVerifier implements TokenVerifier {
  #jwks: JWTVerifyGetKey;
  #issuer: string;

  constructor(opts: { jwksUrl: string; issuer: string }) {
    // createRemoteJWKSet caches keys in-memory and refetches on an unknown kid
    // (rate-limited), so rotating the signing key needs no redeploy.
    this.#jwks = createRemoteJWKSet(new URL(opts.jwksUrl), {
      cacheMaxAge: 600_000, // 10 min
      cooldownDuration: 30_000, // min gap between refetches on unknown kid
    });
    this.#issuer = opts.issuer;
  }

  async verify(token: string): Promise<AuthClaims> {
    try {
      const { payload } = await jwtVerify(token, this.#jwks, {
        issuer: this.#issuer,
        audience: "authenticated", // Supabase user access tokens
        algorithms: ["ES256", "RS256"], // asymmetric only — never HS256
      });
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
    const url = process.env.SUPABASE_URL;
    if (!url) {
      throw new Error("SUPABASE_URL is not set (needed for the JWKS URL). See .env.example.");
    }
    const base = url.replace(/\/+$/, "");
    verifier = new SupabaseJwksVerifier({
      jwksUrl: `${base}/auth/v1/.well-known/jwks.json`,
      issuer: `${base}/auth/v1`,
    });
  }
  return verifier;
}

/** Test seam: inject a fake verifier (auth must stay swappable, §9.2 rule 5). */
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
