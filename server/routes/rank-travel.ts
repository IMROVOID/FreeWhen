/**
 * `/api/events/:id/rank` — the server-side travel resolution.
 *
 * ★ A PROVIDER OUTAGE IS A 200 WITH DEGRADED CONFIDENCE, NOT A 5xx.
 *
 * AC-9.6.1 says so explicitly, and the reason is not politeness: returning
 * an error status hides a ranking that would have worked. The user gets a
 * labelled straight-line estimate and a decision; a 5xx gives them neither.
 *
 * ★ THE ENGINE RECEIVES ALREADY-RESOLVED DATA. IT NEVER FETCHES.
 *
 * That is what keeps it pure and its tests provider-independent: the
 * engine is handed a `TravelMeasurement` map and computes with it. A
 * provider swap cannot change an engine result, and the suite proves it by
 * re-running with the adapter swapped (AC-10.4.1, AC-12.1.1).
 *
 * ★ ONE MATRIX CALL PER (MODE, DEPARTURE BUCKET).
 *
 * At 10 participants × 15 venues × 3 modes, one call per pair is 450
 * requests and one call per (mode, bucket) is 3. The difference is the
 * difference between a working demo and a provider that has blocked us
 * (PRD-05 §12.1, layer 3).
 */

import { scoreVenues } from '@/src/engine/score';
import type { Lens, ParticipantContext, VenueContext } from '@/src/engine/types';
import { cacheKey, serveFromCache, type TravelCacheStore } from '@/src/routing/cache';
import { createNeshanMatrixAdapter } from '@/src/routing/adapters/neshan-matrix';
import { createNeshanDirectionAdapter } from '@/src/routing/adapters/neshan-direction';
import { createOrsAdapter } from '@/src/routing/adapters/ors';
import { DEPARTURE_BUCKET_MINUTES } from '@/src/routing/config';
import { defaultLadder, resolveMatrix } from '@/src/routing/ladder';
import { pairKey, type BatchTravelAdapter, type MatrixRequest, type TravelRequest } from '@/src/routing/provider';
import { prefilterDestinations } from '@/src/routing/prefilter';
import type { TravelMeasurement, TransportMode } from '@/src/routing/types';

import { callerIdFrom, isUuid, json } from '../lib/http';
import { clearBackoff, isBackedOff, recordRefusal } from '../lib/provider-backoff';
import { serverProviderKeys } from '../lib/provider-secrets';
import { createProviderTransport } from '../lib/provider-transport';
import { trackRankingDegraded, trackTransitProxyUsed } from '../lib/routing-analytics';
import { resolveCaller, servicePool } from '../lib/supabase';
import { createDatabaseCacheStore } from '../lib/travel-cache';

/** A participant's location, as the server reads it. */
interface StartPointRow extends Record<string, unknown> {
  participant_id: string;
  display_name: string;
  lat_rounded: string;
  lng_rounded: string;
  modes: string[] | null;
  max_travel_minutes: number;
  has_car: boolean;
  access_needs: unknown;
}

/** A venue, as the server reads it. */
interface VenueRow extends Record<string, unknown> {
  id: string;
  name: string;
  lat: string;
  lng: string;
  price_level: number | null;
  opening_hours: unknown;
  accessibility: unknown;
}

/**
 * Snaps an instant to a 15-minute bucket.
 *
 * The bucket is what the cache key uses, so two people departing within the
 * same quarter hour share one measurement (PRD-05 §12.1, layer 4).
 */
export function departureBucket(at: Date): string {
  const ms = DEPARTURE_BUCKET_MINUTES * 60 * 1000;
  const snapped = Math.floor(at.getTime() / ms) * ms;
  return new Date(snapped).toISOString();
}

/**
 * Whether the caller is a participant of the event.
 *
 * ★ THE AUTHORIZATION PREDICATE, AND IT IS THE SAME ONE THE DATABASE USES.
 *
 * The RLS read policies all reduce to `is_event_participant()`, so the
 * server's own check must match it exactly. A server check that used a
 * *different* rule would be a rule the database does not enforce, which is
 * how a service ends up reading what RLS would have hidden.
 */
export async function callerIsParticipant(
  eventId: string,
  userId: string,
): Promise<boolean> {
  const result = await serviceQuery<{ id: string }>(
    `select id from participant where event_id = $1 and auth_user_id = $2 limit 1`,
    [eventId, userId],
  );

  return result.rows.length > 0;
}

/**
 * The event's travel problem, read from the database.
 *
 * ★ THE CALLER MUST BE A PARTICIPANT OF THE EVENT.
 *
 * `resolveCaller` proves the caller is a KNOWN IDENTITY — it is not
 * authorization. Reading an arbitrary event's participants, their snapped
 * start points and their accessibility needs would let any caller
 * enumerate event ids and read a stranger's group's data: their display
 * names, their approximate home areas (through the travel times), and their
 * declared constraints.
 *
 * So the read is JOINED on the caller's own participant row. A caller who
 * is not a participant gets no rows, which is the same answer they get for
 * an event that does not exist (PRD-01 §3, PRD-08 §4).
 */
async function readTravelProblem(
  eventId: string,
  callerUserId: string,
): Promise<{
  participants: ParticipantContext[];
  venues: VenueContext[];
}> {
  const participantResult = await serviceQuery<StartPointRow>(
    `select p.id as participant_id, p.display_name, s.lat_rounded, s.lng_rounded,
            p.modes, p.max_travel_minutes, p.has_car, p.access_needs
       from participant p
       join start_point s on s.participant_id = p.id
      where p.event_id = $1
        and exists (
          select 1 from participant me
           where me.event_id = p.event_id and me.auth_user_id = $2
        )`,
    [eventId, callerUserId],
  );

  const venueResult = await serviceQuery<VenueRow>(
    `select v.id, v.name, v.lat, v.lng, v.price_level, v.opening_hours, v.accessibility
       from venue v
      where v.event_id = $1
        and exists (
          select 1 from participant me
           where me.event_id = v.event_id and me.auth_user_id = $2
        )`,
    [eventId, callerUserId],
  );

  // ★ THE CALLER MUST BE IN THE EVENT AT ALL.
  // A caller who is not a participant gets no participants and no venues —
  // which is the same answer as an event that does not exist, so the route
  // cannot be used to probe for one.
  if (participantResult.rows.length === 0 && venueResult.rows.length === 0) {
    return { participants: [], venues: [] };
  }

  return {
    participants: participantResult.rows.map((row) => ({
      id: row.participant_id,
      name: row.display_name,
      startPoint: {
        lat: Number(row.lat_rounded),
        lng: Number(row.lng_rounded),
        accuracyM: 0,
      },
      modes: (row.modes ?? ['walk']) as TransportMode[],
      hasCar: row.has_car,
      // Carpooling is a P2 feature (PRD-05 §10), so nothing offers a ride
      // yet. The field is reserved in the engine's contract.
      canOfferRides: false,
      maxTravelMinutes: row.max_travel_minutes,
      accessibility: normaliseAccessNeeds(row.access_needs),
      weight: 1,
    })),
    venues: venueResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      lat: Number(row.lat),
      lng: Number(row.lng),
      openingHours: normaliseHours(row.opening_hours),
      priceLevel: (row.price_level as 1 | 2 | 3 | 4 | null) ?? null,
      venueType: null,
      accessibility: normaliseAccessibility(row.accessibility),
      rating: null,
    })),
  };
}

/**
 * A participant's declared accessibility needs.
 *
 * ★ ABSENT IS UNKNOWN, NEVER "NO CONSTRAINT".
 *
 * A blank reads as "no constraint", which is how a wheelchair user ends up
 * at an inaccessible venue (PRD-11 §15.7). Every field defaults to the
 * absence of a declaration, never to a satisfied requirement.
 */
function normaliseAccessNeeds(value: unknown): {
  needsStepFree: boolean;
  limitedWalking: boolean;
  maxWalkMinutes: number | null;
  avoidsNightTravel: boolean;
  noWalkAloneAfter: number | null;
} {
  const record = (value ?? {}) as Record<string, unknown>;

  const maxWalk = record.maxWalkMinutes;
  const noWalkAlone = record.noWalkAloneAfter;

  return {
    needsStepFree: record.needsStepFree === true,
    limitedWalking: record.limitedWalking === true,
    maxWalkMinutes: typeof maxWalk === 'number' ? maxWalk : null,
    avoidsNightTravel: record.avoidsNightTravel === true,
    noWalkAloneAfter: typeof noWalkAlone === 'number' ? noWalkAlone : null,
  };
}

/** The accessibility tri-states, with `unknown` as the default. */
function normaliseAccessibility(value: unknown): {
  stepFreeEntrance: 'confirmed_yes' | 'confirmed_no' | 'unknown';
  accessibleRestroom: 'confirmed_yes' | 'confirmed_no' | 'unknown';
  limitedWalkingSuitable: 'confirmed_yes' | 'confirmed_no' | 'unknown';
  source: 'osm' | 'provider' | 'user' | 'none';
} {
  const record = (value ?? {}) as Record<string, unknown>;

  const triState = (input: unknown): 'confirmed_yes' | 'confirmed_no' | 'unknown' =>
    input === 'confirmed_yes' || input === 'confirmed_no' ? input : 'unknown';

  const source = record.source;
  return {
    stepFreeEntrance: triState(record.stepFreeEntrance),
    accessibleRestroom: triState(record.accessibleRestroom),
    limitedWalkingSuitable: triState(record.limitedWalkingSuitable),
    source:
      source === 'osm' || source === 'provider' || source === 'user' ? source : 'none',
  };
}

/**
 * The opening hours, or `null` for unknown.
 *
 * Absent hours are NOT "closed" (PRD-05 §8, TC-7).
 */
function normaliseHours(
  value: unknown,
): { open: number; close: number } | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  const open = record.open;
  const close = record.close;

  if (typeof open !== 'number' || typeof close !== 'number') return null;

  return { open, close };
}

/** The travel measurements, keyed by participant id and then venue id. */
export type MeasurementMap = Record<string, Record<string, TravelMeasurement>>;

/**
 * The outcome of a resolution.
 */
export interface RankTravelResult {
  measurements: MeasurementMap;
  /** The rung the ladder reached. 1 is the best. */
  levelReached: number;
  /** The coverage the resolution achieved. */
  coverage: { resolved: number; total: number };
  /** Whether the transit proxy served anything. */
  transitProxyUsed: boolean;
  /** The participants the proxy served. */
  transitParticipantCount: number;
}

/** The options a resolution accepts. */
export interface ResolveOptions {
  now?: Date;
  /** The instant the journey departs. Snapped to the departure bucket. */
  at?: Date;
  /** The cache. Injected so a test can use an in-memory store. */
  cache?: TravelCacheStore;
  /** The adapters. Injected so a test can use failing stubs. */
  adapters?: BatchTravelAdapter[];
  /** The lens the ranking uses. */
  lens?: Lens;
  /**
   * The caller's user id.
   *
   * The read is JOINED on this, so a caller who is not a participant of the
   * event reads nothing. It is required in production; a test may omit it,
   * and the read then returns nothing — which is the safe direction.
   */
  callerUserId?: string;
}

/**
 * Builds the server's ladder.
 *
 * The provider rungs come first and the offline rungs last, and the order
 * is fixed: Neshan is the only provider with Iranian road data and live
 * local traffic (PRD-10 D6, PRD-05 §12.4).
 *
 * ★ THE BENCHED PROVIDERS ARE SKIPPED BEFORE THE CALL.
 *
 * A provider that has just said "my quota is spent" is not asked again for
 * the next half hour: the ladder moves past it without a network round
 * trip, which is what keeps the ranking fast when a provider is down.
 */
export function buildServerLadder(): BatchTravelAdapter[] {
  const transport = createProviderTransport();

  const adapters = [
    createNeshanMatrixAdapter({
      transport,
      keys: serverProviderKeys,
      onRefusal: recordProviderRefusal,
    }),
    createNeshanDirectionAdapter({
      transport,
      keys: serverProviderKeys,
      onRefusal: recordProviderRefusal,
    }),
    createOrsAdapter({
      transport,
      keys: serverProviderKeys,
      onRefusal: recordProviderRefusal,
    }),
  ];

  return defaultLadder(
    adapters.map((adapter) => {
      // A benched provider is wrapped so it DECLINES rather than being
      // called. The decline is the same shape as a provider that is down,
      // so the ladder treats it identically.
      if (!adapter.service) return adapter;

      const service = adapter.service;

      return {
        ...adapter,
        async measure(request: TravelRequest) {
          if (isBackedOff(service)) return null;

          const measurement = await adapter.measure(request);

          // ★ A SUCCESS CLEARS THE BENCH.
          //
          // A refusal followed by a success means the window was wrong, and
          // continuing to bench the provider would degrade every ranking
          // for the rest of the window — six hours for Neshan, a day for
          // ORS — on the strength of one stale refusal.
          if (measurement) clearBackoff(service);

          return measurement;
        },
        async measureMatrix(request: MatrixRequest) {
          if (isBackedOff(service)) {
            return { outcomes: new Map(), resolved: 0, total: 0 };
          }

          const result = await adapter.measureMatrix!(request);
          if (result.resolved > 0) clearBackoff(service);

          return result;
        },
      };
    }),
  );
}

/**
 * Records a provider's refusal, so the next resolution skips it.
 */
function recordProviderRefusal(
  service: Parameters<typeof recordRefusal>[0],
  reason: Parameters<typeof recordRefusal>[1],
): void {
  recordRefusal(service, reason);
}

/**
 * Resolves the travel times for an event.
 *
 * ★ NEVER THROWS FOR A PROVIDER FAILURE.
 *
 * The ladder degrades. A database failure DOES throw — there is no honest
 * answer without the data, and inventing one would be worse than an error.
 */
export async function resolveEventTravel(
  eventId: string,
  options: ResolveOptions = {},
): Promise<RankTravelResult> {
  const now = options.now ?? new Date();
  const at = options.at ?? now;
  const bucket = departureBucket(at);
  const cache = options.cache ?? createDatabaseCacheStore();
  const adapters = options.adapters ?? buildServerLadder();

  // ★ THE CALLER IS PART OF THE AUTHORIZATION, NOT JUST THE IDENTITY.
  //
  // `callerUserId` is the id the read is JOINED on. Without it the read
  // would return any event's data to any known identity.
  const { participants, venues } = await readTravelProblem(eventId, options.callerUserId ?? '');
  const measurements: MeasurementMap = {};

  // The participants, grouped by the mode they travel by. The batching is
  // by (mode, bucket) — one matrix call per group.
  const byMode = new Map<TransportMode, ParticipantContext[]>();
  for (const participant of participants) {
    if (!participant.startPoint) continue;
    const mode = participant.modes[0] ?? 'walk';
    byMode.set(mode, [...(byMode.get(mode) ?? []), participant]);
  }

  let levelReached = 5;
  let resolved = 0;
  let total = 0;
  let transitParticipantCount = 0;

  for (const [mode, members] of byMode) {
    if (members.length === 0) continue;

    // ★ THE PRE-FILTER IS A CANDIDATE REDUCTION, NOT A DISPLAYED TIME.
    // A venue nobody can reach is dropped before the provider is called, so
    // the matrix is not spent on pairs that will be excluded anyway.
    const prefiltered = prefilterDestinations(
      members.map((member) => ({
        lat: member.startPoint!.lat,
        lng: member.startPoint!.lng,
      })),
      venues.map((venue) => ({
        id: venue.id,
        lat: venue.lat,
        lng: venue.lng,
      })),
    );

    const reachable = venues.filter((venue) =>
      prefiltered.kept.some((candidate) => candidate.id === venue.id),
    );

    if (reachable.length === 0) continue;

    // ★ THE CACHE IS CONSULTED FIRST.
    // A cached measurement is served at `medium` — it is a stored result,
    // not a live one, and labelling it `high` would be a lie (PRD-05 §5.5).
    const pending: Array<{ member: ParticipantContext; venue: VenueContext }> = [];
    const perParticipant = new Map<string, Record<string, TravelMeasurement>>();

    for (const member of members) {
      const perVenue: Record<string, TravelMeasurement> = {};

      for (const venue of reachable) {
        const key = cacheKey({
          origin: member.startPoint!,
          destination: { lat: venue.lat, lng: venue.lng },
          mode,
          departureBucket: bucket,
        });

        const record = await cache.get(key);
        if (record) {
          perVenue[venue.id] = serveFromCache(record, mode, now);
          continue;
        }

        pending.push({ member, venue });
      }

      if (Object.keys(perVenue).length > 0) {
        perParticipant.set(member.id, perVenue);
      }
    }

    // Only the pairs the cache missed go to the provider.
    const pendingByMember = new Map<string, VenueContext[]>();
    for (const item of pending) {
      pendingByMember.set(item.member.id, [
        ...(pendingByMember.get(item.member.id) ?? []),
        item.venue,
      ]);
    }

    if (pendingByMember.size > 0) {
      const pendingMembers = members.filter((member) => pendingByMember.has(member.id));
      const pendingVenues = reachable.filter((venue) =>
        pending.some((item) => item.venue.id === venue.id),
      );

      const result = await resolveMatrix(
        {
          origins: pendingMembers.map((member) => ({
            lat: member.startPoint!.lat,
            lng: member.startPoint!.lng,
          })),
          destinations: pendingVenues.map((venue) => ({ lat: venue.lat, lng: venue.lng })),
          mode,
          departureBucket: bucket,
        },
        { adapters },
      );

      levelReached = Math.min(levelReached, result.levelReached);
      resolved += result.coverage.resolved;
      total += result.coverage.total;

      pendingMembers.forEach((member, originIndex) => {
        pendingVenues.forEach((venue, destinationIndex) => {
          const key = pairKey(originIndex, destinationIndex);
          const outcome = result.results.get(key);
          if (!outcome) return;

          // ★ AN `unknown` MEASUREMENT IS NOT A MEASUREMENT.
          //
          // The engine computes a utility from `minutes`, and an
          // `unknown` measurement carries `minutes: 0` — so handing it to
          // the engine scores the journey as an INSTANT trip, with the
          // best possible utility. That is the exact opposite of what
          // "we do not know" means (PRD-05 TC-5, PRD-05 §8).
          //
          // So an unknown measurement is not put into the engine's map at
          // all: the participant is simply NOT MEASURED for that venue,
          // and the engine reports them in `coverage.missing` and excludes
          // them from the aggregation. Absence is not zero.
          if (outcome.measurement.confidence === 'unknown') {
            return;
          }

          const perVenue = perParticipant.get(member.id) ?? {};
          perVenue[venue.id] = outcome.measurement;
          perParticipant.set(member.id, perVenue);

          // The measurement is written back to the cache, so the next event
          // in the same city reads it rather than calling the provider.
          //
          // ★ ONLY A PROVIDER MEASUREMENT IS CACHED.
          //
          // An `unknown` record would be re-served for the whole bucket,
          // poisoning every ranking that reads it. A `straight_line` record
          // is a MODEL, and caching it would keep the provider
          // unconsulted for the whole TTL after a single outage — the
          // model is free and offline, so it is recomputed every time.
          if (outcome.measurement.source === 'straight_line') {
            return;
          }

          void cache.set(
            cacheKey({
              origin: member.startPoint!,
              destination: { lat: venue.lat, lng: venue.lng },
              mode,
              departureBucket: bucket,
            }),
            {
              measurement: outcome.measurement,
              departureBucket: bucket,
              fetchedAt: outcome.measurement.fetchedAt,
            },
          );

          // The transit proxy is permanent, so its use is a fact worth
          // recording — it says how much of the product rides on the
          // estimate.
          if (mode === 'transit') transitParticipantCount += 1;
        });
      });
    }

    for (const [participantId, perVenue] of perParticipant) {
      measurements[participantId] = perVenue;
    }
  }

  // ★ THE METRIC FIRES ONCE PER RESOLUTION, WHATEVER THE LEVEL.
  // A level 1 is the evidence the metric is meaningful; a level 5 is the
  // evidence the fallback is carrying the product (PRD-05 §16).
  trackRankingDegraded({
    eventId,
    levelReached,
    reason: levelReached <= 3 ? 'served' : 'provider_unavailable',
  });

  if (transitParticipantCount > 0) {
    trackTransitProxyUsed({ eventId, participantCount: transitParticipantCount });
  }

  return {
    measurements,
    levelReached,
    coverage: { resolved, total },
    transitProxyUsed: transitParticipantCount > 0,
    transitParticipantCount,
  };
}

/**
 * `POST /api/events/:id/rank` — the ranked result for an event.
 *
 * ★ THE RESPONSE IS A 200 EVEN WHEN EVERY PROVIDER IS DOWN.
 *
 * The body carries the ranking with its honest confidence labels, and the
 * coverage that says how much of the group it covers.
 */
export async function rankTravelHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const userId = callerIdFrom(request);
  const caller = userId && isUuid(userId) ? await resolveCaller(userId) : null;
  if (!caller) {
    return json(
      { error: 'NOT_PARTICIPANT', messageKey: 'errors.notParticipant' },
      403,
    );
  }

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) {
    return json(
      { error: 'NOT_PARTICIPANT', messageKey: 'errors.notParticipant' },
      403,
    );
  }

  const lens = readLens(request);

  // ★ THE PARTICIPATION CHECK HAPPENS BEFORE ANY DATA IS READ.
  //
  // `resolveCaller` proves the caller is a known identity; it says nothing
  // about whether they are in THIS event. The check is a join on the
  // caller's own participant row, and it is the same predicate every read
  // policy uses (`is_event_participant()`).
  //
  // A non-participant gets `NOT_PARTICIPANT` — the same answer as an event
  // that does not exist, so the route cannot be used to probe for one.
  const participates = await callerIsParticipant(eventId, caller.userId);
  if (!participates) {
    return json(
      { error: 'NOT_PARTICIPANT', messageKey: 'errors.notParticipant' },
      403,
    );
  }

  const resolved = await resolveEventTravel(eventId, { lens, callerUserId: caller.userId });

  const { participants, venues } = await readTravelProblem(eventId, caller.userId);
  const ranking = scoreVenues(participants, venues, lens, {
    measurements: resolved.measurements,
  });

  // The engine's result is a union: the success state carries the ranked
  // venues, and the no-viable state carries the exclusions and the
  // suggestions instead. Both are states, not failures, and both answer
  // 200.
  if (ranking.state === 'NoVenueMeetsThreshold') {
    return json({
      state: ranking.state,
      lens,
      ranking: [],
      coverage: ranking.coverage,
      excluded: ranking.excluded,
      suggestions: ranking.suggestions,
      conflicts: [],
      routing: {
        level_reached: resolved.levelReached,
        coverage: resolved.coverage,
        transit_proxy_used: resolved.transitProxyUsed,
      },
    });
  }

  return json({
    state: ranking.state,
    lens,
    ranking,
    coverage: ranking.coverage,
    excluded: ranking.excluded,
    conflicts: ranking.conflicts,
    // The routing envelope, so the client can say how the ranking was
    // produced without a second request.
    routing: {
      level_reached: resolved.levelReached,
      coverage: resolved.coverage,
      transit_proxy_used: resolved.transitProxyUsed,
    },
  });
}

/** The lens, from the request. The default is `balanced` (PRD-05 §6.3). */
function readLens(request: Request): Lens {
  const url = new URL(request.url);
  const value = url.searchParams.get('lens');
  if (value === 'fastest' || value === 'fairest' || value === 'cheapest') return value;
  return 'balanced';
}

/**
 * The service query, wrapped so the row type is constrained.
 *
 * A thin wrapper rather than a bare `servicePool().query` call, so the
 * generic constraint is expressed once.
 */
async function serviceQuery<T extends Record<string, unknown>>(
  text: string,
  values: unknown[],
): Promise<{ rows: T[] }> {
  return servicePool().query<T>(text, values);
}
