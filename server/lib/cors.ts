/**
 * Which request origins the API answers with CORS headers.
 *
 * ★ A SINGLE EXACT-MATCH STRING WAS NOT ENOUGH.
 *
 * `APP_ORIGIN` used to be compared with `===` against the request's `Origin`,
 * so a deployment that served the app from more than one host — a
 * `*.vercel.app` preview URL plus a verified custom domain, which is the normal
 * arrangement — accepted only whichever one the variable happened to name. The
 * other host got no `access-control-allow-origin` back and the browser refused
 * the preflight, which surfaces as the whole API being dead on the custom
 * domain while it works fine on the platform domain.
 *
 * ★ STILL NEVER A WILDCARD.
 *
 * Reflecting the request's own `Origin` (or answering `*`) would let any site
 * read authenticated responses, because the API authenticates with a header
 * rather than a cookie. The allowlist stays explicit and fails CLOSED: an
 * unset variable allows nothing rather than everything.
 *
 * Kept in its own import-free module so the rule is unit-testable without
 * standing up a request.
 */

/** A parsed allowlist, or the empty list when nothing is configured. */
export type AllowedOrigins = readonly string[];

/**
 * Split the configured value into origins.
 *
 * Accepts a comma-separated list because that is what a CI variable can
 * realistically hold. Entries are trimmed and stripped of a trailing slash: an
 * `Origin` header never carries one, so `https://x/` would otherwise never
 * match `https://x`.
 */
export function parseAllowedOrigins(configured: string | undefined): AllowedOrigins {
  if (!configured) return [];

  return configured
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => entry.length > 0);
}

/**
 * Whether this request origin may receive CORS headers.
 *
 * A missing `Origin` header is NOT an allowed origin: a same-origin navigation
 * sends none, CORS does not apply to it, and answering with `allow-origin`
 * would be meaningless rather than permissive.
 */
export function isAllowedOrigin(allowed: AllowedOrigins, origin: string | null): boolean {
  if (!origin) return false;
  return allowed.includes(origin.replace(/\/+$/, ''));
}
