/**
 * The Neshan direction adapter — rung 2 of the degradation ladder.
 *
 * This is the PER-PAIR fallback. It exists for the case where the matrix
 * endpoint is unavailable or returns too many `NoRoute` elements, and it
 * serves the SAME high confidence the matrix does, because a routed journey
 * is a routed journey.
 *
 * ★ IT IS A FALLBACK, NOT THE DEFAULT PATH.
 *
 * At 10 participants × 15 venues this would be 150 individual requests. It
 * is therefore bounded to the top prefiltered candidates, so a matrix
 * outage cannot generate a burst of 150 calls against a provider that is
 * already struggling (Plan 04, Task 3).
 */

import {
  DIRECTION_FALLBACK_MAX_PAIRS,
  NESHAN_TYPE_BY_MODE,
  PROVIDER_BACKOFF_BASE_MS,
  PROVIDER_ENDPOINTS,
  PROVIDER_RETRY_COUNT,
} from '../config';
import {
  pairKey,
  type BatchTravelAdapter,
  type MatrixOutcome,
  type MatrixRequest,
  type MatrixResult,
  type ProviderAdapterOptions,
  type ProviderService,
  type TravelRequest,
} from '../provider';
import type { Coordinate, TransportMode, TravelMeasurement } from '../types';
import { mapNeshanStatus, neshanActionRetries, refusalReasonFor } from './neshan-errors';

/** The service whose key the direction endpoint requires. */
const SERVICE: ProviderService = 'neshan_direction';

/** One route in a Neshan direction response. */
interface NeshanRoute {
  legs?: Array<{
    distance?: { value?: number };
    duration?: { value?: number };
  }>;
}

/** The Neshan direction response. */
interface NeshanDirectionResponse {
  routes?: NeshanRoute[];
}

/** Builds the direction URL. */
export function buildDirectionUrl(
  origin: Coordinate,
  destination: Coordinate,
  type: 'car' | 'motorcycle',
): string {
  const query = new URLSearchParams({
    type,
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  });

  return `${PROVIDER_ENDPOINTS.neshanDirection}?${query.toString()}`;
}

/**
 * Turns a route into a measurement.
 *
 * A route's duration and distance are the SUM over its legs, in seconds and
 * metres respectively.
 */
function toMeasurement(
  response: NeshanDirectionResponse,
  fetchedAt: string,
): TravelMeasurement | null {
  const route = response.routes?.[0];
  if (!route?.legs?.length) return null;

  let seconds = 0;
  let meters = 0;
  for (const leg of route.legs) {
    seconds += leg.duration?.value ?? 0;
    meters += leg.distance?.value ?? 0;
  }

  if (seconds <= 0) return null;

  return {
    minutes: Math.round(seconds / 60),
    minutesRange: null,
    distanceMeters: Math.round(meters),
    transfers: null,
    walkMinutes: null,
    waitMinutes: null,
    // A provider does not quote a fare. Unknown is unknown.
    costIrr: null,
    parkingCostIrr: null,
    confidence: 'high',
    source: 'neshan_direction',
    fetchedAt,
  };
}

/** The options the direction adapter is built with. */
export type NeshanDirectionOptions = ProviderAdapterOptions

/**
 * The Neshan direction adapter.
 */
export function createNeshanDirectionAdapter(options: NeshanDirectionOptions): BatchTravelAdapter {
  const { transport, keys } = options;
  const now = options.now ?? ((): Date => new Date());
  const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const onRefusal = options.onRefusal;

  /** One request, with the documented retry policy applied. */
  async function fetchRoute(
    origin: Coordinate,
    destination: Coordinate,
    type: 'car' | 'motorcycle',
  ): Promise<TravelMeasurement | null> {
    const key = keys(SERVICE);
    if (!key) return null;

    const url = buildDirectionUrl(origin, destination, type);

    for (let tries = 0; ; tries += 1) {
      let response: { status: number; body: string } | null = null;

      try {
        response = await transport(url, {
          method: 'GET',
          headers: { 'Api-Key': key },
        });
      } catch {
        if (tries < PROVIDER_RETRY_COUNT) {
          await sleep(PROVIDER_BACKOFF_BASE_MS * 2 ** tries);
          continue;
        }
        onRefusal?.(SERVICE, 'transient');
        return null;
      }

      if (response.status >= 200 && response.status < 300) {
        try {
          const parsed = JSON.parse(response.body) as NeshanDirectionResponse;
          return toMeasurement(parsed, now().toISOString());
        } catch {
          return null;
        }
      }

      const action = mapNeshanStatus(response.status);
      if (neshanActionRetries(action) && tries < PROVIDER_RETRY_COUNT) {
        await sleep(PROVIDER_BACKOFF_BASE_MS * 2 ** tries);
        continue;
      }

      // ★ The refusal is recorded with the reason the table implies, so a
      // quota fault benches the provider for hours and a rate cap for a
      // minute.
      onRefusal?.(SERVICE, refusalReasonFor(response.status, action));

      return null;
    }
  }

  return {
    name: 'neshan_direction',
    rung: 2,
    service: SERVICE,

    supports(mode: TransportMode): boolean {
      return NESHAN_TYPE_BY_MODE[mode] !== undefined;
    },

    async measure(request: TravelRequest): Promise<TravelMeasurement | null> {
      const type = NESHAN_TYPE_BY_MODE[request.mode];
      if (!type) return null;

      return fetchRoute(request.origin, request.destination, type);
    },

    async measureMatrix(request: MatrixRequest): Promise<MatrixResult> {
      const type = NESHAN_TYPE_BY_MODE[request.mode];
      if (!type) {
        return { outcomes: new Map(), resolved: 0, total: 0 };
      }

      const total = request.origins.length * request.destinations.length;
      if (total === 0) {
        return { outcomes: new Map(), resolved: 0, total: 0 };
      }

      // ★ THE BOUND COUNTS ATTEMPTS, NOT SUCCESSES.
      //
      // A budget that counts resolutions is defeated by a failing
      // provider: a refusal increments nothing, so the loop keeps asking
      // and issues all 150 requests instead of the 60 the bound promises
      // — exactly the burst the bound exists to prevent.
      const budget = Math.min(total, DIRECTION_FALLBACK_MAX_PAIRS);
      const outcomes = new Map<string, MatrixOutcome>();
      let resolved = 0;
      let attempted = 0;

      outer: for (let originIndex = 0; originIndex < request.origins.length; originIndex += 1) {
        for (
          let destinationIndex = 0;
          destinationIndex < request.destinations.length;
          destinationIndex += 1
        ) {
          if (attempted >= budget) break outer;
          attempted += 1;

          const measurement = await fetchRoute(
            request.origins[originIndex]!,
            request.destinations[destinationIndex]!,
            type,
          );

          const key = pairKey(originIndex, destinationIndex);
          if (measurement) {
            outcomes.set(key, { kind: 'measured', measurement });
            resolved += 1;
          } else {
            outcomes.set(key, { kind: 'unknown' });
          }
        }
      }

      return { outcomes, resolved, total };
    },
  };
}
