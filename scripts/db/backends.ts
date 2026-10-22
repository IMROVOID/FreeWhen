/**
 * The backend switch (PRD-10 D22, PRD-09 §4.0.1).
 *
 * Two backends ship side by side:
 *
 * | `DATABASE_BACKEND` | Backend | JWT issuer | Realtime |
 * |---|---|---|---|
 * | `supabase` (default) | self-hosted Supabase | GoTrue | Supabase Realtime |
 * | `local_pg` | plain PostgreSQL + PostgREST | `server/auth` | the WebSocket bridge |
 *
 * ★ The switch changes the UPSTREAM, never the contract.
 *
 * The paths, the token shape and the event contract are identical on both
 * (PRD-18 §4). A client written against the Supabase library talks to the
 * local backend without knowing which one it is on — that is the whole
 * point of D22, and it is why the token service mints GoTrue's exact
 * claim set rather than a convenient one.
 *
 * ★ Supabase is the DEFAULT.
 *
 * The default is not a formality: it is the backend that is tested
 * together and pinned. `local_pg` exists for hosts that offer a managed
 * Postgres but cannot run the five-container stack. A host that can run
 * the stack should run Supabase.
 *
 * ★ An unknown value FAILS LOUDLY.
 *
 * A typo in `DATABASE_BACKEND` must not silently select the default: the
 * host would serve the Supabase paths while the operator believed they had
 * deployed the local one, and the failure would surface as a 404 in
 * production.
 */

export const BACKENDS = ['supabase', 'local_pg'] as const;

export type Backend = (typeof BACKENDS)[number];

/** The default backend. Supabase, because it is the tested-together one. */
export const DEFAULT_BACKEND: Backend = 'supabase';

/** The environment variable that selects the backend. */
export const BACKEND_ENV_VAR = 'DATABASE_BACKEND';

/** Raised when `DATABASE_BACKEND` names a backend that does not exist. */
export class UnknownBackendError extends Error {
  constructor(readonly value: string) {
    super(
      `unknown DATABASE_BACKEND ${JSON.stringify(value)} — expected one of ${BACKENDS.join(', ')}`,
    );
    this.name = 'UnknownBackendError';
  }
}

/**
 * Parses a backend name.
 *
 * ★ An absent value is the DEFAULT; an unknown value is an error.
 */
export function parseBackend(
  value: string | undefined | null,
  fallback: Backend = DEFAULT_BACKEND,
): Backend {
  if (value === undefined || value === null || value.trim() === '') {
    return fallback;
  }

  const normalised = value.trim().toLowerCase();

  if ((BACKENDS as readonly string[]).includes(normalised)) {
    return normalised as Backend;
  }

  throw new UnknownBackendError(value);
}

/** The backend in effect, from the environment. */
export function currentBackend(env: Record<string, string | undefined> = process.env): Backend {
  return parseBackend(env[BACKEND_ENV_VAR]);
}

/** Whether the local-Postgres backend is in effect. */
export function isLocalPg(env: Record<string, string | undefined> = process.env): boolean {
  return currentBackend(env) === 'local_pg';
}

/**
 * The upstream URLs for a backend.
 *
 * ★ The PATHS are the same on both backends.
 *
 * `/auth/v1`, `/rest/v1` and `/realtime/v1` are the paths the host serves
 * on both (PRD-18 §4, rows 10–12). What differs is which service answers
 * them, and that is a proxy concern — the Caddyfile routes the same paths
 * to a different upstream. These URLs are what the CLIENT and the server
 * use to reach the host, and they are therefore backend-independent by
 * construction.
 */
export type BackendEndpoints = {
  /** The base URL of the host. */
  baseUrl: string;
  /** The anonymous sign-in path. */
  authPath: string;
  /** The PostgREST path. */
  restPath: string;
  /** The realtime path. */
  realtimePath: string;
};

/**
 * The endpoints for a backend.
 *
 * The base URL differs because the two backends are typically reached at
 * different addresses during development — a Supabase stack on one port,
 * a plain PostgREST on another. In production both sit behind the same
 * Caddy, and the base URL is the same.
 */
export function endpointsFor(
  backend: Backend,
  options: { supabaseUrl?: string; localPgUrl?: string } = {},
): BackendEndpoints {
  if (backend === 'supabase') {
    const base = options.supabaseUrl ?? 'http://127.0.0.1:54321';
    return {
      baseUrl: base,
      authPath: '/auth/v1',
      restPath: '/rest/v1',
      realtimePath: '/realtime/v1',
    };
  }

  const base = options.localPgUrl ?? 'http://127.0.0.1:3000';
  return {
    baseUrl: base,
    authPath: '/auth/v1',
    restPath: '/rest/v1',
    realtimePath: '/realtime/v1',
  };
}

/**
 * Whether a backend mints its own tokens.
 *
 * On Supabase, GoTrue does. On local Postgres, this repository's token
 * service does — which is why the claim set is pinned to GoTrue's.
 */
export function issuesTokensLocally(backend: Backend): boolean {
  return backend === 'local_pg';
}

/**
 * Whether a backend uses the realtime bridge.
 */
export function usesRealtimeBridge(backend: Backend): boolean {
  return backend === 'local_pg';
}
