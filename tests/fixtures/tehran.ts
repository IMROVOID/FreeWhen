/**
 * The verified Tehran fixture — the single source of truth.
 *
 * **Two consumers, one fixture** (PRD-12 §4.2). The engine suite and the
 * seed dataset import this same data. Duplicating it lets the demo and the
 * tests drift, and then the demo shows numbers nothing verifies.
 *
 * The numbers are the worked example from PRD-05 §12A: four members, three
 * venues, a 19:00 weekday event. The travel times are given directly, so
 * the fixture does not depend on a routing provider — the engine is tested
 * against known inputs, and the arithmetic is independently checkable.
 *
 * The expected aggregates, from the exact (unrounded) utilities:
 *
 * | Venue | floor | mean   | gap   |
 * |-------|-------|--------|-------|
 * | V1    | 22.22 | 50.56  | 44.44 |
 * | V2    | 33.33 | 50.28  | 46.67 |
 * | V3    | 16.67 | 37.36  | 58.33 |
 */

import type {
  ParticipantContext,
  TravelMeasurement,
  VenueContext,
} from '@/src/engine/types';

/** The event hour the fixture was worked out for: 19:00 on a weekday. */
export const FIXTURE_EVENT_HOUR = 19;

/** A fixed instant, so no test ever reads the wall clock. */
export const FIXTURE_FETCHED_AT = '2026-08-02T16:00:00.000Z';

/** A participant's travel budget in minutes, and the mode they use. */
interface FixtureMember {
  id: string;
  name: string;
  mode: 'car' | 'transit' | 'walk';
  maxTravelMinutes: number;
  lat: number;
  lng: number;
}

/**
 * The four members.
 *
 * **Darya's budget is 45 minutes, not 60.** That single value produces V1's
 * floor of 22.22 and is the reason Balanced picks V2: Darya is the
 * worst-off member at V1, and V1's 0.28-point mean advantage is noise
 * dressed as a decision (PRD-05 §6.3, TC-3).
 */
const MEMBERS: FixtureMember[] = [
  { id: 'p_ali', name: 'Ali', mode: 'car', maxTravelMinutes: 60, lat: 35.7448, lng: 51.4050 },
  { id: 'p_bahar', name: 'Bahar', mode: 'transit', maxTravelMinutes: 60, lat: 35.7219, lng: 51.3347 },
  { id: 'p_cyrus', name: 'Cyrus', mode: 'transit', maxTravelMinutes: 60, lat: 35.7089, lng: 51.4350 },
  { id: 'p_darya', name: 'Darya', mode: 'walk', maxTravelMinutes: 45, lat: 35.7539, lng: 51.4225 },
];

/** The travel times, in minutes: `[memberIndex][venueIndex]`. */
const MINUTES: number[][] = [
  //  V1  V2  V3
  [30, 12, 15], // Ali   (car)
  [20, 40, 48], // Bahar (transit)
  [22, 38, 50], // Cyrus (transit)
  [35, 22, 28], // Darya (walk)
];

/** The venue ids, in the fixture's order. */
export const FIXTURE_VENUE_IDS = ['v_1', 'v_2', 'v_3'] as const;

/**
 * The cost of each member's journey, in tomans.
 *
 * Darya's V2 cost is `null` — an unknown cost, NOT a zero. It exists so the
 * Cheapest lens can never pick a venue by omission (PRD-05 §8, the edge
 * case checklist).
 *
 * The park is free to enter, so the car and the walk cost nothing there,
 * while the transit fare still applies.
 */
const COSTS: Array<Array<number | null>> = [
  //  V1      V2      V3
  [15000, 15000, 0], // Ali   — driving to the park has no parking fee
  [18000, 18000, 18000], // Bahar — the transit fare still applies
  [18000, 18000, 18000], // Cyrus — the transit fare still applies
  [0, null, 0], // Darya — walking is free, but her V2 cost is unknown
];

/** The participants of the fixture. */
export const TEHRAN_PARTICIPANTS: ParticipantContext[] = MEMBERS.map((member) => ({
  id: member.id,
  name: member.name,
  startPoint: { lat: member.lat, lng: member.lng, accuracyM: 50 },
  modes: [member.mode],
  hasCar: member.mode === 'car',
  canOfferRides: member.mode === 'car',
  maxTravelMinutes: member.maxTravelMinutes,
  accessibility: {
    needsStepFree: false,
    limitedWalking: false,
    maxWalkMinutes: null,
    avoidsNightTravel: false,
    noWalkAloneAfter: null,
  },
  weight: 1,
}));

/** The venues of the fixture. */
export const TEHRAN_VENUES: VenueContext[] = [
  {
    id: 'v_1',
    name: 'کافه دیدار',
    lat: 35.7389,
    lng: 51.4100,
    // Known hours, open at 19:00.
    openingHours: { open: 9, close: 23 },
    priceLevel: 2,
    venueType: 'cafe',
    accessibility: {
      stepFreeEntrance: 'unknown',
      accessibleRestroom: 'unknown',
      limitedWalkingSuitable: 'unknown',
      source: 'none',
    },
    rating: 4.4,
  },
  {
    id: 'v_2',
    name: 'رستوران مرکزی',
    lat: 35.7000,
    lng: 51.4000,
    openingHours: { open: 12, close: 24 },
    priceLevel: 3,
    venueType: 'restaurant',
    accessibility: {
      stepFreeEntrance: 'confirmed_yes',
      accessibleRestroom: 'confirmed_yes',
      limitedWalkingSuitable: 'confirmed_yes',
      source: 'osm',
    },
    rating: 4.6,
  },
  {
    id: 'v_3',
    name: 'پارک لاله',
    lat: 35.7390,
    lng: 51.3620,
    openingHours: { open: 8, close: 20 },
    priceLevel: 1,
    venueType: 'park',
    accessibility: {
      stepFreeEntrance: 'confirmed_no',
      accessibleRestroom: 'confirmed_no',
      limitedWalkingSuitable: 'confirmed_yes',
      source: 'osm',
    },
    rating: 4.2,
  },
];

/** Builds a travel measurement for the fixture. */
function measurement(
  minutes: number,
  costIrr: number | null,
  mode: string,
): TravelMeasurement {
  return {
    minutes,
    // A modelled figure always carries a range. A bare integer would read
    // as a measurement (PRD-05 §9, TC-18).
    minutesRange: [Math.max(0, Math.floor(minutes * 0.75)), Math.ceil(minutes * 1.25)],
    distanceMeters: Math.round(minutes * 400),
    transfers: mode === 'transit' ? 1 : null,
    walkMinutes: mode === 'transit' ? 8 : mode === 'walk' ? minutes : 0,
    waitMinutes: null,
    costIrr,
    parkingCostIrr: null,
    confidence: 'low',
    source: 'straight_line',
    fetchedAt: FIXTURE_FETCHED_AT,
  };
}

/** The travel measurements, keyed by participant id and then venue id. */
export const TEHRAN_MEASUREMENTS: Record<string, Record<string, TravelMeasurement>> =
  Object.fromEntries(
    MEMBERS.map((member, memberIndex) => [
      member.id,
      Object.fromEntries(
        FIXTURE_VENUE_IDS.map((venueId, venueIndex) => [
          venueId,
          measurement(
            MINUTES[memberIndex]![venueIndex]!,
            COSTS[memberIndex]![venueIndex]!,
            member.mode,
          ),
        ]),
      ),
    ]),
  );

/** The fixture, in one object. */
export const TEHRAN_FIXTURE = {
  eventHour: FIXTURE_EVENT_HOUR,
  participants: TEHRAN_PARTICIPANTS,
  venues: TEHRAN_VENUES,
  measurements: TEHRAN_MEASUREMENTS,
  venueIds: FIXTURE_VENUE_IDS,
} as const;

/**
 * The expected aggregates, from the exact utilities.
 *
 * These are the numbers the suite asserts. They were recomputed
 * independently during the research and are the check on the engine's
 * arithmetic (PRD-05 §12A, TC-16).
 */
export const EXPECTED_AGGREGATES = {
  v_1: { floor: 22.22, mean: 50.56, gap: 44.44 },
  v_2: { floor: 33.33, mean: 50.28, gap: 46.67 },
  v_3: { floor: 16.67, mean: 37.36, gap: 58.33 },
} as const;

/**
 * The fixture as the SEED reproduces it.
 *
 * **The second consumer of the same data.** The engine suite and the
 * database seed must not drift apart, or the demo shows a number nothing
 * verifies (PRD-12 §4.2). The seed stores the Persian display names, the
 * travel minutes and Darya's 45-minute cap; this block is the machine-
 * readable form of that same table, and `scripts/db/verify-fixture.ts`
 * asserts the seed against it.
 *
 * The names are the seed's display names, which is what the seed's rows
 * carry. The engine's own fixture uses the Latin names the PRD's worked
 * example uses, and maps them onto these — the pair is one fixture, not
 * two.
 */
export const SEED_FIXTURE = {
  /** The display names the seed stores, in the PRD's order. */
  participants: [
    { key: 'Ali', name: 'علی', dMax: 60, minutes: [30, 12, 15] },
    { key: 'Bahar', name: 'بهار', dMax: 60, minutes: [20, 40, 48] },
    { key: 'Cyrus', name: 'سیروس', dMax: 60, minutes: [22, 38, 50] },
    { key: 'Darya', name: 'داریا', dMax: 45, minutes: [35, 22, 28] },
  ],
  /** The venues, in the PRD's order. The seed's ids are UUIDs. */
  venues: ['V1', 'V2', 'V3'],
  /** The floors, means and gaps PRD-05 §12A publishes, in venue order. */
  expected: {
    floor: [22.22, 33.33, 16.67],
    mean: [50.56, 50.28, 37.36],
    gap: [44.44, 46.67, 58.33],
  },
  /** Balanced picks the higher floor — V2, despite V1's mean advantage. */
  balancedWinner: 'V2',
};
