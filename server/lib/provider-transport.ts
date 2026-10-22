/**
 * The provider transport — the one place an outbound provider call is made.
 *
 * ★ EVERY PROVIDER CALL IS SERVER-SIDE AND GOES THROUGH HERE.
 *
 * The client bundle contains no provider key, so it cannot make a provider
 * call at all. That is the structural form of PRD-10 D9, and it is why the
 * ORS terms obligation holds: there is no client path to a key.
 *
 * ★ THE KEY IS IN A HEADER, NEVER A QUERY STRING.
 *
 * A query string lands in every proxy log and every access log on the path
 * between here and the provider.
 *
 * ★ A TIMEOUT IS A FAILURE, NOT A HANG.
 *
 * A provider that does not answer within the timeout is treated as down. A
 * ranking that arrives late is worse than a ranking that arrives degraded,
 * and the ladder has a labelled fallback that is always available.
 */

import { PROVIDER_TIMEOUT_MS } from '@/src/routing/config';
import type { ProviderResponse, ProviderTransport } from '@/src/routing/provider';

/**
 * The `fetch`-based transport.
 *
 * The platform `fetch` is used directly, so the request is the same one a
 * browser would make — and the timeout is implemented with an abort signal
 * rather than a promise race, so the underlying request is actually
 * cancelled rather than merely abandoned.
 */
export function createProviderTransport(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): ProviderTransport {
  return async (url, init): Promise<ProviderResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: controller.signal,
      });

      return { status: response.status, body: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  };
}
