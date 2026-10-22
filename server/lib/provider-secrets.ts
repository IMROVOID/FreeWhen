/**
 * The provider secrets — the ONLY place a routing key is read.
 *
 * ★ SERVER ONLY. NOTHING UNDER `src/` OR `app/` MAY IMPORT THIS MODULE.
 *
 * Three independent reasons force the boundary (PRD-10 D9):
 *
 *  1. **The OpenRouteService terms forbid client-side API keys outright.**
 *     That is a licence obligation, not a preference.
 *  2. An AI-provider key must not ship inside a binary.
 *  3. The calls must be cacheable, rate-limitable and auditable centrally,
 *     which is what makes the API budget workable and prevents key abuse.
 *
 * `gate:secrets` fails the build when a server-only variable NAME appears
 * under `src/` or `app/`, so the boundary is enforced rather than merely
 * intended.
 *
 * ★ AN ABSENT KEY IS NOT AN ERROR.
 *
 * It means the service is unconfigured, and the ladder treats that exactly
 * as it treats a provider that is down: the rung is skipped and the ranking
 * degrades to a labelled straight-line estimate. Failing loudly here would
 * take down a whole ranking over a missing optional key; the log line is
 * what makes it visible.
 */

import { logSafe } from '@/src/lib/redact';
import type { ProviderKeyProvider, ProviderService } from '@/src/routing/provider';

/**
 * The environment variable each service's key lives in.
 *
 * ★ THE NESHAN KEYS ARE PER-SERVICE.
 *
 * A directions key against the matrix endpoint returns 483
 * `ApiKeyTypeError`. Provisioning one key per service and reading them
 * from distinct variables is what makes that impossible by accident.
 *
 * ★ BUT THE SINGLE `NESHAN_API_KEY` STILL WORKS AS A FALLBACK.
 *
 * The documented variable is one key for every Neshan service, and an
 * operator who has provisioned one would otherwise find the ladder
 * skipping Neshan entirely — a silent degradation with no obvious cause.
 *
 * The per-service variable WINS when it is set, so a deployment that has
 * been split correctly gets the split behaviour, and a deployment that has
 * not gets the single key. The shared key is a compatibility path, not a
 * recommendation: the two services are best served by two keys, and the
 * split is what the fallback is documented to be.
 */
const ENV_BY_SERVICE: Record<ProviderService, string> = {
  neshan_matrix: 'NESHAN_MATRIX_API_KEY',
  neshan_direction: 'NESHAN_DIRECTION_API_KEY',
  ors: 'ORS_API_KEY',
};

/**
 * The fallback variable per service.
 *
 * Only the Neshan services have one. The ORS key is not per-service — the
 * hosted API serves every profile with the same key.
 */
const FALLBACK_ENV_BY_SERVICE: Partial<Record<ProviderService, string>> = {
  neshan_matrix: 'NESHAN_API_KEY',
  neshan_direction: 'NESHAN_API_KEY',
};

/** The variable names, for the server's documentation and diagnostics. */
export const PROVIDER_ENV_NAMES: Record<ProviderService, string> = { ...ENV_BY_SERVICE };

/**
 * The key for a service, or `null` when it is not configured.
 *
 * The value is never logged, never returned in a response, and never
 * written anywhere but into an outbound request header.
 */
export function providerKey(service: ProviderService): string | null {
  const names = [ENV_BY_SERVICE[service], FALLBACK_ENV_BY_SERVICE[service]];

  for (const name of names) {
    if (!name) continue;

    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }

  // Loud, but not fatal: the ladder degrades to the straight-line floor
  // and the ranking still appears.
  logSafe('provider_key_missing', { service });
  return null;
}

/**
 * The key provider the routing adapters are built with.
 *
 * A function rather than a value, so the key is read at the moment of the
 * request and never held in a module-level constant that a heap dump or an
 * accidental import could expose.
 */
export const serverProviderKeys: ProviderKeyProvider = (service) => providerKey(service);
