/**
 * The local auth service's HTTP routes.
 *
 * These are the paths the local backend serves that Supabase's GoTrue
 * serves on the default backend (PRD-18 §4, row 10):
 *
 * | Path | Purpose |
 * |---|---|
 * | `POST /auth/v1/anonymous` | Mint an anonymous session (GoTrue's `signInAnonymously`) |
 * | `GET /auth/v1/health` | Liveness, and whether the database is reachable |
 *
 * ★ THE PATH IS GOTRUE'S, NOT OURS.
 *
 * The client is written against the Supabase client library and does not
 * know which backend it is talking to. A different path here would mean a
 * different client per backend, which is exactly what D22 rules out. The
 * route table in PRD-18 §4 is the contract, and it says `/auth/v1/*`.
 *
 * ★ THE RESPONSE IS GOTRUE'S SHAPE.
 *
 * `access_token`, `token_type`, `expires_in`, `expires_at`, `user` — the
 * same field names, the same nesting. A client that parses a Supabase
 * session must parse this one without knowing which backend issued it.
 *
 * ★ HANDLERS ARE `Request => Response`.
 *
 * The same seam Plan 05's routes use: no framework, no server object, so
 * the tests exercise the real routing and the real error envelope
 * in-process rather than behind a hand-built HTTP client.
 */

import { z } from 'zod';

import {
  DEFAULT_TOKEN_TTL_SECONDS,
  TokenError,
  anonymousSession,
  assertSecret,
  signToken,
  verifyToken,
  type Claims,
} from './tokens';
import { signInBucketKey, signInLimiter, signInRateLimitHeaders } from './rate-limit';
import { clientIp } from '../lib/rate-limit';

/** The GoTrue-compatible anonymous sign-in path. */
export const ANONYMOUS_PATH = '/auth/v1/anonymous';

/** The health path. */
export const HEALTH_PATH = '/auth/v1/health';

/** The environment variable that overrides the token lifetime. */
export const TTL_ENV_VAR = 'ANON_TOKEN_TTL_SECONDS';

/** The environment variable that holds the signing secret. */
export const SECRET_ENV_VAR = 'JWT_SECRET';

/**
 * The error body, in GoTrue's shape.
 *
 * GoTrue's error shape is `{ code, message, error_code, error }` — a
 * client that reads `error_code` for a rate-limited sign-in expects
 * `rate_limit_exceeded` and not an HTTP-status-only signal.
 */
export type AuthError = {
  code: number;
  message: string;
  error_code: string;
  error: string;
};

const RATE_LIMITED: AuthError = {
  code: 429,
  message: 'Too many requests. Please try again later.',
  error_code: 'rate_limit_exceeded',
  error: 'rate_limit_exceeded',
};

const BAD_REQUEST: AuthError = {
  code: 400,
  message: 'Invalid request body.',
  error_code: 'validation_failed',
  error: 'validation_failed',
};

const SERVER_ERROR: AuthError = {
  code: 500,
  message: 'Unexpected error.',
  error_code: 'unexpected_failure',
  error: 'unexpected_failure',
};

/**
 * The request body GoTrue accepts for anonymous sign-in.
 *
 * GoTrue accepts an empty body. Anything the client sends beyond that is
 * ignored rather than rejected, because a client that adds a field must
 * not break on one backend.
 */
const signInBodySchema = z
  .object({
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * The identity store the service writes to.
 *
 * An interface rather than a direct database call, so the service can be
 * tested without a database and so the storage choice is not baked into
 * the route.
 */
export interface UserStore {
  /**
   * Creates an anonymous user and returns its id.
   *
   * The row is written BEFORE the token is signed, because `sub` must be an
   * id that already exists — `participant.auth_user_id` references it, and
   * a token whose subject does not exist would fail every insert.
   */
  createAnonymousUser(): Promise<string>;
  /** Whether the store is reachable. */
  ping(): Promise<boolean>;
}

export type AuthServiceConfig = {
  /** The signing secret. At least 32 bytes. */
  secret: string;
  /** The token lifetime, in seconds. */
  ttlSeconds: number;
};

export type AuthServiceOptions = {
  secret?: string;
  ttlSeconds?: number;
  env?: Record<string, string | undefined>;
  now?: () => number;
};

/**
 * Reads the configuration from the environment, with the documented
 * defaults.
 *
 * ★ The secret is validated HERE, at construction, not at the first
 * request. A missing or weak `JWT_SECRET` must stop the service from
 * starting, because a service that starts without one fails later as a
 * login error the user cannot diagnose.
 */
export function readConfig(options: AuthServiceOptions = {}): AuthServiceConfig {
  const env = options.env ?? process.env;

  const secret = options.secret ?? env[SECRET_ENV_VAR];
  assertSecret(secret);

  const ttlSeconds =
    options.ttlSeconds ?? readPositiveInt(env[TTL_ENV_VAR]) ?? DEFAULT_TOKEN_TTL_SECONDS;

  return { secret, ttlSeconds };
}

function readPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** The health payload. */
export type AuthHealth = {
  status: 'ok' | 'degraded';
  backend: 'local_pg';
  database: 'reachable' | 'unreachable';
  token_ttl_seconds: number;
};

/** The sign-in response, in GoTrue's shape. */
export type AuthSessionBody = ReturnType<typeof anonymousSession>;

/**
 * The auth service.
 *
 * ★ THE ORDER IS RATE LIMIT → CREATE USER → SIGN TOKEN.
 *
 * The limit is checked FIRST, so a client that has exhausted its budget
 * does not create a user row. Creating one and then refusing the token
 * would leave an orphan `auth.users` row per rejected request, and the
 * cleanup job would have to sweep rows that were never used.
 */
export class AuthService {
  private readonly config: AuthServiceConfig;
  private readonly now: () => number;

  constructor(
    private readonly store: UserStore,
    options: AuthServiceOptions = {},
  ) {
    this.config = readConfig(options);
    this.now = options.now ?? Date.now;
  }

  /** The configuration in effect. */
  get settings(): Readonly<AuthServiceConfig> {
    return this.config;
  }

  /**
   * Mints an anonymous session.
   *
   * Returns the GoTrue-shaped body, or an error body with the status it
   * implies.
   */
  async signInAnonymously(
    ip: string,
  ): Promise<{ status: number; body: AuthSessionBody | AuthError; headers: Record<string, string> }> {
    // ★ THE BUCKET KEY IS THE SAME ONE THE API USES.
    //
    // The auth service and the API's sign-in path must spend ONE budget
    // between them, or a client gets 30/hour from each.
    const limit = signInLimiter().check(signInBucketKey(ip));
    const headers = signInRateLimitHeaders(limit);

    if (!limit.allowed) {
      return { status: 429, body: RATE_LIMITED, headers };
    }

    let userId: string;
    try {
      userId = await this.store.createAnonymousUser();
    } catch {
      // The status, not the error: a message that echoes a driver failure
      // publishes the connection string's host and user.
      return { status: 500, body: SERVER_ERROR, headers };
    }

    const now = Math.floor(this.now() / 1000);

    const { token } = signToken(
      { sub: userId, is_anonymous: true },
      this.config.secret,
      { ttlSeconds: this.config.ttlSeconds, now },
    );

    const claims = verifyToken(token, this.config.secret, { now });

    return { status: 200, body: anonymousSession(token, claims, { now }), headers };
  }

  /** The health payload. */
  async health(): Promise<{ status: number; body: AuthHealth }> {
    const reachable = await this.store.ping().catch(() => false);

    const body: AuthHealth = {
      status: reachable ? 'ok' : 'degraded',
      backend: 'local_pg',
      database: reachable ? 'reachable' : 'unreachable',
      token_ttl_seconds: this.config.ttlSeconds,
    };

    return { status: reachable ? 200 : 503, body };
  }
}

/**
 * Parses and validates a sign-in request body.
 *
 * ★ An empty body is VALID — GoTrue accepts it, and the client sends one.
 */
export function parseSignInBody(raw: string): { ok: true } | { ok: false; error: AuthError } {
  if (!raw.trim()) return { ok: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: BAD_REQUEST };
  }

  const result = signInBodySchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: BAD_REQUEST };
  }

  return { ok: true };
}

/**
 * Verifies a bearer token from a request header.
 *
 * Returns the claim set, or `undefined` when the header is absent or the
 * token is not valid. A caller that needs to distinguish "no token" from
 * "bad token" can: the error code says which.
 */
export function bearerClaims(
  authorization: string | null | undefined,
  secret: string,
  options: { now?: number } = {},
): { ok: true; claims: Claims } | { ok: false; error: TokenError | undefined } {
  if (!authorization) {
    return { ok: false, error: undefined };
  }

  const [scheme, value] = authorization.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) {
    return { ok: false, error: undefined };
  }

  try {
    return { ok: true, claims: verifyToken(value, secret, options) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof TokenError ? error : new TokenError('invalid token', 'malformed'),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The HTTP handlers
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/**
 * `POST /auth/v1/anonymous`.
 *
 * The GoTrue-compatible anonymous sign-in.
 */
export function createAnonymousHandler(service: AuthService) {
  return async function handleAnonymousSignIn(request: Request): Promise<Response> {
    let raw = '';
    try {
      raw = await request.text();
    } catch {
      raw = '';
    }

    const parsed = parseSignInBody(raw);
    if (!parsed.ok) {
      return jsonResponse(parsed.error, parsed.error.code);
    }

    const result = await service.signInAnonymously(clientIp(request.headers));

    return jsonResponse(result.body, result.status, result.headers);
  };
}

/**
 * `GET /auth/v1/health`.
 */
export function createHealthHandler(service: AuthService) {
  return async function handleAuthHealth(_request?: Request): Promise<Response> {
    const result = await service.health();
    return jsonResponse(result.body, result.status);
  };
}
