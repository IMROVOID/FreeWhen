/**
 * The anonymous token service — the entire trust boundary of the local
 * PostgreSQL backend (PRD-09 §4.0.1, PRD-10 D22).
 *
 * Supabase's GoTrue issues the JWT that PostgREST reads. On plain Postgres
 * there is no GoTrue, so this module issues the SAME JWT. The claim set is
 * not a convenience: it is the contract that lets every one of the schema's
 * RLS policies work unchanged on both backends.
 *
 * ★ THE TWO CLAIMS THAT MATTER:
 *
 * | Claim | Value | Why it cannot be anything else |
 * |---|---|---|
 * | `role` | always `authenticated` | PostgREST switches to the `anon` DATABASE role when the claim is missing or `anon`. Every policy would then see an unauthenticated caller and deny every read. A guest is an anonymous USER, not an unauthenticated request. |
 * | `is_anonymous` | a real boolean | FR-8.36's restrictive policy reads it from the JWT. Derived at query time it would be NULL rather than false, and a NULL silently disables the policy. |
 *
 * The `sub` claim is the `auth.users.id`, and it becomes `auth.uid()` through
 * the GUC PostgREST sets — the same GUC Supabase sets. That is why the
 * policies cannot tell which backend they are on.
 *
 * ★ HS256, not asymmetric.
 *
 * PostgREST supports asymmetric keys, but this deployment has ONE service
 * signing and ONE service verifying. A second key type would add a key
 * rotation story for no security gain here.
 *
 * ★ `exp` is always set.
 *
 * PostgREST validates `exp`/`iat`/`nbf` with a 30-second skew. A
 * non-expiring token would defeat a check that already exists.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/**
 * The claim set — the shape of the JWT body.
 *
 * Mirrors the claims PostgREST and Supabase both read, so RLS cannot tell
 * them apart.
 */
export type Claims = {
  /** `auth.users.id` — becomes `auth.uid()`. */
  sub: string;
  /** Always `authenticated`. Never `anon`. */
  role: 'authenticated';
  /** A real boolean, not a string and not derived at query time. */
  is_anonymous: boolean;
  /** Issued-at, seconds since the epoch. */
  iat: number;
  /** Expiry, seconds since the epoch. */
  exp: number;
};

/** The default token lifetime, in seconds. */
export const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;

/** The minimum secret length. */
export const MIN_SECRET_BYTES = 32;

/**
 * The uuid shape, as a regex.
 *
 * ★ Not zod's `uuid()`.
 *
 * zod's `uuid()` validates the RFC 4122 VARIANT field, and the project's
 * own seed data (`11111111-1111-1111-1111-111111111111`) does not satisfy
 * it. A stricter check than the database's would reject a legitimate
 * `sub` — the identity the seed created — and the failure would read as a
 * corrupt token rather than an over-strict validator.
 */
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The claims a caller supplies.
 *
 * ★ `role` is NOT part of it.
 *
 * The role is always `authenticated`, and a caller must not be able to
 * choose it. Making it an input would put the one claim that decides
 * which policies apply into the hands of whoever calls the function — and
 * `anon` is a value PostgREST handles by switching database roles, so a
 * caller who could set it could change the authorization model.
 */
export type SignableClaims = {
  /** `auth.users.id` — becomes `auth.uid()`. */
  sub: string;
  /** A real boolean, not a string and not derived at query time. */
  is_anonymous: boolean;
};

export class TokenError extends Error {
  constructor(
    message: string,
    readonly code: 'missing_secret' | 'weak_secret' | 'malformed' | 'bad_signature' | 'expired',
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

/**
 * The claim set, validated.
 *
 * A JWT body is attacker-controlled input: it arrives base64url-encoded in a
 * request header, and the whole point of verifying it is that it cannot be
 * trusted. So it is parsed and validated rather than cast.
 *
 * `role` is pinned to the literal `authenticated` — a token claiming `anon`
 * must be REJECTED, not accepted with a different role, because accepting it
 * would change which policies apply.
 */
const claimsSchema = z.object({
  sub: z.string().regex(UUID_SHAPE, 'must be a uuid'),
  role: z.literal('authenticated'),
  is_anonymous: z.boolean(),
  iat: z.number().int(),
  exp: z.number().int(),
});

/** The header of a JWT this service issues. */
const headerSchema = z.object({
  alg: z.literal('HS256'),
  typ: z.literal('JWT'),
});

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/**
 * Signs a claim set into a JWT.
 *
 * The signature is computed over `header.claims`, so a verifier recomputes
 * the same two segments and compares — there is no way to present a body the
 * signer did not produce.
 */
export function signToken(
  claims: SignableClaims,
  secret: string,
  options: { ttlSeconds?: number; now?: number } = {},
): { token: string; expiresAt: number; issuedAt: number } {
  assertSecret(secret);

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  const issuedAt = now;
  const expiresAt = now + ttl;

  const body: Claims = {
    sub: claims.sub,
    role: 'authenticated',
    is_anonymous: claims.is_anonymous,
    iat: issuedAt,
    exp: expiresAt,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify(body));
  const signingInput = `${header}.${payload}`;
  const signature = sign(secret, signingInput).toString('base64url');

  return { token: `${signingInput}.${signature}`, expiresAt, issuedAt };
}

/**
 * Verifies a JWT and returns its claim set.
 *
 * ★ The signature is compared with `timingSafeEqual`.
 *
 * A byte-by-byte comparison that returns early on the first mismatch leaks
 * the length of the matching prefix, which is enough to reconstruct a
 * signature one byte at a time. The lengths are compared first, because
 * `timingSafeEqual` throws on a length mismatch.
 */
export function verifyToken(
  token: string,
  secret: string,
  options: { now?: number; clockSkewSeconds?: number } = {},
): Claims {
  assertSecret(secret);

  const segments = token.split('.');
  if (segments.length !== 3) {
    throw new TokenError('the token is not a JWT', 'malformed');
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];

  const expected = sign(secret, `${headerSegment}.${payloadSegment}`);
  const presented = base64UrlDecode(signatureSegment);

  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    throw new TokenError('the token signature does not match', 'bad_signature');
  }

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(base64UrlDecode(headerSegment).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadSegment).toString('utf8'));
  } catch {
    throw new TokenError('the token is not valid base64url JSON', 'malformed');
  }

  const parsedHeader = headerSchema.safeParse(header);
  if (!parsedHeader.success) {
    throw new TokenError('the token header is not an HS256 JWT', 'malformed');
  }

  const parsedClaims = claimsSchema.safeParse(payload);
  if (!parsedClaims.success) {
    throw new TokenError('the token claims are not valid', 'malformed');
  }

  // The skew matches PostgREST's, so a token this service issues is accepted
  // by PostgREST at the same moment this service accepts one.
  const skew = options.clockSkewSeconds ?? 30;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (parsedClaims.data.exp + skew < now) {
    throw new TokenError('the token has expired', 'expired');
  }
  if (parsedClaims.data.iat - skew > now) {
    throw new TokenError('the token was issued in the future', 'malformed');
  }

  return parsedClaims.data;
}

/**
 * The raw HMAC signature.
 *
 * Raw bytes, not base64 — the caller encodes them. Base64-encoding here
 * and encoding again at the call site would produce a token whose
 * signature does not verify, and the failure would look like a
 * cryptographic bug rather than a double encoding.
 */
function sign(secret: string, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest();
}

/**
 * Rejects a secret that is absent or too short to be a secret.
 *
 * ★ This runs at startup, not at the first request.
 *
 * A weak secret means every JWT in the system is forgeable, and a request
 * that fails at the boundary reports it to the user as a login failure —
 * which looks like a bug and gets worked around. A startup failure is
 * visible before anyone depends on it.
 */
export function assertSecret(secret: string | undefined): asserts secret is string {
  if (!secret) {
    throw new TokenError('JWT_SECRET is not set', 'missing_secret');
  }
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) {
    throw new TokenError(
      `JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes`,
      'weak_secret',
    );
  }
}

/**
 * The Supabase-compatible sign-in response.
 *
 * The field names are GoTrue's, not ours, because the client is written
 * against the Supabase client library and does not know which backend
 * issued its session. A different shape here would mean a different client
 * per backend, which is exactly what D22 rules out.
 */
export type AnonymousSession = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  user: {
    id: string;
    role: 'authenticated';
    is_anonymous: true;
    aud: string;
    created_at: string;
  };
};

/** Builds the response body, in GoTrue's shape. */
export function anonymousSession(
  token: string,
  claims: Claims,
  options: { now?: number } = {},
): AnonymousSession {
  const now = options.now ?? Math.floor(Date.now() / 1000);

  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: claims.exp - now,
    expires_at: claims.exp,
    user: {
      id: claims.sub,
      role: 'authenticated',
      is_anonymous: true,
      aud: 'authenticated',
      created_at: new Date(claims.iat * 1000).toISOString(),
    },
  };
}
