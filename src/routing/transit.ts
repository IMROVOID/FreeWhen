/**
 * The transit wrapper — the ONLY transit path in the product.
 *
 * ★ THE TRANSIT PROXY IS PERMANENT. NOT A STOPGAP.
 *
 * No evaluated provider offers Iranian public-transit routing. Neshan's
 * `type` accepts only `car` and `motorcycle`; ORS has car, bike, walk, hike,
 * wheelchair and HGV, and no transit. Google has transit but is
 * contractually unavailable for Iran. And no usable Tehran GTFS feed
 * exists: Transitland — the authoritative aggregator — returns zero Iranian
 * operators, and the single real feed carries no licence, so it cannot be
 * redistributed (PRD-05 §9, Research F2, PRD-10 D7).
 *
 * **Do not plan an OTP2 or Valhalla deployment expecting a feed to appear.**
 * If a feed is ever obtained by other means, this wrapper is replaced and
 * the engine is untouched either way.
 *
 * ★ `confidence` IS `low` UNCONDITIONALLY.
 *
 * No input — a short trip, a dense corridor, high-confidence car data for
 * the other participants in the group — may raise it (PRD-05 TC-18). A
 * transit estimate rendered like a measurement is the failure mode that
 * destroys the product's credibility.
 */

import { estimateTransitProxy } from '@/src/engine/transit-proxy';

import type { TravelRequest } from './provider';
import type { TravelMeasurement } from './types';

/**
 * The confidence the proxy may carry: `low`, always.
 *
 * Declared as a literal type so it cannot be widened by accident.
 */
export const TRANSIT_PROXY_CONFIDENCE = 'low' as const;

/** The source the proxy reports: `straight_line`. */
export const TRANSIT_PROXY_SOURCE = 'straight_line' as const;

/**
 * Estimates a transit journey.
 *
 * The estimate itself is computed by the engine's proxy — the same function
 * the engine's own TC-18 case exercises, so the two cannot drift.
 */
export function estimateTransit(request: TravelRequest): TravelMeasurement {
  const measurement = estimateTransitProxy({
    from: request.origin,
    to: request.destination,
    fetchedAt: request.departureBucket,
  });

  return {
    ...measurement,
    // ★ The two properties, asserted rather than assumed. The engine's
    // proxy already holds them; restating them here means a change to the
    // engine's proxy cannot silently weaken the transit guarantee.
    confidence: TRANSIT_PROXY_CONFIDENCE,
    source: TRANSIT_PROXY_SOURCE,
  };
}

/**
 * Whether a measurement may keep its confidence.
 *
 * The transit guard. It is applied by the LADDER, not by this module, so a
 * future adapter cannot accidentally break it by being more confident than
 * the truth allows (Plan 04, Task 7).
 *
 * A transit measurement is `low` whatever produced it. A non-transit
 * measurement keeps whatever confidence its adapter gave it.
 */
export function mayKeepConfidence(
  mode: TravelRequest['mode'],
  confidence: TravelMeasurement['confidence'],
): TravelMeasurement['confidence'] {
  if (mode === 'transit') return TRANSIT_PROXY_CONFIDENCE;
  return confidence;
}
