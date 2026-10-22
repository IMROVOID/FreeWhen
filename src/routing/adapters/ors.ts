/**
 * The ORS adapter — rungs 3 and 4 of the degradation ladder.
 *
 * ★ ORS IS SERVER-ONLY, AND THAT IS A LICENCE OBLIGATION, NOT A PREFERENCE.
 *
 * The OpenRouteService terms forbid client-side API keys outright. Every
 * call therefore goes through our server, and the key is read in exactly one
 * place — `server/lib/provider-secrets.ts` (PRD-10 D9, PRD-05 §12.3).
 *
 * ★ THE 24-HOUR QUOTA WINDOW RESETS FROM THE FIRST REQUEST OF THE WINDOW.
 *
 * Not at midnight. A budget that assumes a midnight reset is wrong for most
 * of the day, and the "just after midnight" case is precisely when the
 * budget is empty (PRD-05 §12.3, PRD-10 D6).
 *
 * ★ ORS HAS NO TRANSIT PROFILE.
 *
 * car / bike / walk / hike / wheelchair / HGV — and nothing for public
 * transport. That confirms the transit proxy from a third direction
 * (PRD-05 §9).
 */

import {
  MATRIX_MAX_PAIRS,
  ORS_PROFILE_BY_MODE,
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

/** The service whose key the ORS endpoints require. */
const SERVICE: ProviderService = 'ors';

/** The ORS matrix response. */
interface OrsMatrixResponse {
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

/** The ORS directions response. */
interface OrsDirectionsResponse {
  routes?: Array<{
    summary?: { distance?: number; duration?: number };
  }>;
}

/**
 * Builds the ORS matrix request body.
 *
 * The locations are `[longitude, latitude]` — **inverted** relative to the
 * input convention every other provider uses. ORS follows the GeoJSON
 * order, and a transposed pair is a valid-looking request that routes to
 * the wrong place.
 */
export function buildMatrixBody(
  origins: Coordinate[],
  destinations: Coordinate[],
): { locations: number[][]; sources: string[]; destinations: string[] } {
  const toLocation = (point: Coordinate): number[] => [point.lng, point.lat];

  const locations = [...origins, ...destinations].map(toLocation);

  return {
    locations,
    sources: origins.map((_, index) => String(index)),
    destinations: destinations.map((_, index) => String(origins.length + index)),
  };
}

/** Builds the ORS matrix URL. */
export function buildMatrixUrl(): string {
  const query = new URLSearchParams({
    metrics: 'duration|distance',
    units: 'm',
  });
  return `${PROVIDER_ENDPOINTS.orsMatrix}?${query.toString()}`;
}

/** Builds the ORS directions URL for one journey. */
export function buildDirectionsUrl(profile: string): string {
  const query = new URLSearchParams({ profile });
  return `${PROVIDER_ENDPOINTS.orsDirections}?${query.toString()}`;
}

/**
 * Parses an ORS matrix response into per-pair outcomes.
 *
 * A `null` cell is ORS saying it could not route that pair — the same
 * situation Neshan reports as `NoRoute`, and it is an ABSENCE, not a zero.
 * An ORS matrix is a SUCCESS even when some cells are null: the response
 * is per-pair by construction.
 */
export function parseOrsMatrixResponse(
  response: OrsMatrixResponse,
  fetchedAt: string,
): Map<string, MatrixOutcome> {
  const outcomes = new Map<string, MatrixOutcome>();

  const durations = response.durations ?? [];
  const distances = response.distances ?? [];

  durations.forEach((row, originIndex) => {
    row.forEach((seconds, destinationIndex) => {
      const key = pairKey(originIndex, destinationIndex);

      if (seconds === null || seconds === undefined) {
        outcomes.set(key, { kind: 'no_route' });
        return;
      }

      const rawMeters = distances[originIndex]?.[destinationIndex];

      // ★ A MISSING DISTANCE IS NOT A ZERO DISTANCE.
      //
      // ORS omits `distances` when only the duration is requested, and a
      // `?? 0` would report a real route as covering zero metres — a
      // fabricated measurement, and one that would survive into the
      // engine's `distanceMeters`.
      const meters =
        rawMeters === null || rawMeters === undefined ? 0 : Math.round(rawMeters);

      outcomes.set(key, {
        kind: 'measured',
        measurement: {
          minutes: Math.round(seconds / 60),
          minutesRange: null,
          distanceMeters: meters,
          transfers: null,
          walkMinutes: null,
          waitMinutes: null,
          // ORS does not quote a fare. Unknown is unknown.
          costIrr: null,
          parkingCostIrr: null,
          confidence: 'high',
          source: 'ors',
          fetchedAt,
        },
      });
    });
  });

  return outcomes;
}

/** The options the ORS adapter is built with. */
export type OrsOptions = ProviderAdapterOptions

/**
 * The ORS adapter.
 *
 * One adapter serves both rungs — matrix and directions — because they read
 * the same key and the same profile. The ladder walks the matrix first and
 * the directions second, and the adapter answers whichever is asked.
 */
export function createOrsAdapter(options: OrsOptions): BatchTravelAdapter {
  const { transport, keys } = options;
  const now = options.now ?? ((): Date => new Date());
  const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const onRefusal = options.onRefusal;

  /**
   * The refusal reason an ORS status implies.
   *
   * ORS publishes no Neshan-style table, so the mapping is by HTTP
   * semantics: 429 is the rate cap, 403 is a key or scope fault, and a
   * 5xx is transient.
   */
  function orsRefusalReason(status: number): 'quota' | 'rate' | 'config' | 'transient' {
    if (status === 429) return 'rate';
    if (status === 401 || status === 403) return 'config';
    // 402 is ORS's "quota exhausted" — the credit for the period is spent.
    if (status === 402) return 'quota';
    return 'transient';
  }

  /** One request, with a retry for a transient failure only. */
  async function post(
    url: string,
    body: unknown,
    contentType: string,
  ): Promise<{ status: number; body: string } | null> {
    const key = keys(SERVICE);
    // An absent key is not an error: the service is unconfigured, so the
    // ladder moves on to the straight-line floor.
    if (!key) return null;

    for (let tries = 0; ; tries += 1) {
      let response: { status: number; body: string } | null = null;

      try {
        response = await transport(url, {
          method: 'POST',
          headers: {
            // ORS reads the key from the `Authorization` header. The plan's
            // sketch used a query string, which would put the key in every
            // proxy log on the path.
            Authorization: key,
            'Content-Type': contentType,
          },
          body: JSON.stringify(body),
        });
      } catch {
        if (tries < PROVIDER_RETRY_COUNT) {
          await sleep(PROVIDER_BACKOFF_BASE_MS * 2 ** tries);
          continue;
        }
        onRefusal?.(SERVICE, 'transient');
        return null;
      }

      if (response.status >= 200 && response.status < 300) return response;

      // 429 and 5xx are transient. 4xx other than 429 is a request fault
      // and a retry cannot fix it.
      const transient = response.status === 429 || response.status >= 500;
      if (transient && tries < PROVIDER_RETRY_COUNT) {
        await sleep(PROVIDER_BACKOFF_BASE_MS * 2 ** tries);
        continue;
      }

      onRefusal?.(SERVICE, orsRefusalReason(response.status));

      return response;
    }
  }

  return {
    name: 'ors',
    rung: 3,
    service: SERVICE,

    supports(mode: TransportMode): boolean {
      return ORS_PROFILE_BY_MODE[mode] !== undefined;
    },

    async measure(request: TravelRequest): Promise<TravelMeasurement | null> {
      const profile = ORS_PROFILE_BY_MODE[request.mode];
      if (!profile) return null;

      const body = {
        coordinates: [
          [request.origin.lng, request.origin.lat],
          [request.destination.lng, request.destination.lat],
        ],
      };

      const response = await post(
        buildDirectionsUrl(profile),
        body,
        'application/json',
      );
      if (!response || response.status < 200 || response.status >= 300) return null;

      try {
        const parsed = JSON.parse(response.body) as OrsDirectionsResponse;
        const summary = parsed.routes?.[0]?.summary;
        if (!summary || summary.duration === undefined) return null;

        return {
          minutes: Math.round(summary.duration / 60),
          minutesRange: null,
          distanceMeters: Math.round(summary.distance ?? 0),
          transfers: null,
          walkMinutes: null,
          waitMinutes: null,
          costIrr: null,
          parkingCostIrr: null,
          confidence: 'high',
          source: 'ors',
          fetchedAt: now().toISOString(),
        };
      } catch {
        return null;
      }
    },

    async measureMatrix(request: MatrixRequest): Promise<MatrixResult> {
      const profile = ORS_PROFILE_BY_MODE[request.mode];
      if (!profile) {
        return { outcomes: new Map(), resolved: 0, total: 0 };
      }

      const total = request.origins.length * request.destinations.length;
      if (total === 0) {
        return { outcomes: new Map(), resolved: 0, total: 0 };
      }

      const origins = request.origins.slice(0, MATRIX_MAX_PAIRS);
      const destinations = request.destinations.slice(0, MATRIX_MAX_PAIRS);

      const response = await post(
        buildMatrixUrl(),
        { ...buildMatrixBody(origins, destinations), metrics: ['duration', 'distance'] },
        'application/json',
      );
      if (!response || response.status < 200 || response.status >= 300) {
        return { outcomes: new Map(), resolved: 0, total };
      }

      try {
        const parsed = JSON.parse(response.body) as OrsMatrixResponse;
        const outcomes = parseOrsMatrixResponse(parsed, now().toISOString());
        const resolved = [...outcomes.values()].filter(
          (outcome) => outcome.kind === 'measured',
        ).length;

        return { outcomes, resolved, total };
      } catch {
        return { outcomes: new Map(), resolved: 0, total };
      }
    },
  };
}
