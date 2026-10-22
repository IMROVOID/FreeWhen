/**
 * The straight-line pre-filter.
 *
 * ★ IT IS A CANDIDATE REDUCTION ONLY — NEVER A DISPLAYED TIME.
 *
 * The distance this module computes is free, offline and approximate. It
 * exists to shrink the matrix before a provider is called, not to produce a
 * number the user sees. A straight-line figure in the UI must come from the
 * straight-line ADAPTER, with its honest `low` label (PRD-05 §12.1,
 * layer 1).
 *
 * ★ THE DISTANCE IS THE MINIMUM, NOT THE MEAN.
 *
 * A venue 30 km from one member and 2 km from the rest is legitimate: the
 * member who lives far away simply will not go, and the group should still
 * see the venue. A venue 30 km from EVERYONE is a different thing — nobody
 * can reach it, and scoring it wastes provider budget on a pair that will
 * be excluded anyway. A mean would drop the first venue, which is exactly
 * the wrong answer (Plan 04, Task 9).
 */

import { CANDIDATE_CAP, PRE_FILTER_MAX_KM } from './config';
import { haversineMeters } from './adapters/straight-line';
import type { Coordinate } from './types';

/** A point the pre-filter measures from. */
export interface FilterOrigin extends Coordinate {
  /** The id of the point, so a caller can report which one was dropped. */
  id?: string;
}

/** A point the pre-filter measures to. */
export interface FilterDestination extends Coordinate {
  id?: string;
}

/** The outcome of a pre-filter. */
export interface PrefilterResult<T extends FilterDestination> {
  /** The destinations that survived. */
  kept: T[];
  /** The destinations that were dropped, with the distance that dropped them. */
  dropped: Array<{ destination: T; nearestMeters: number }>;
  /** The distance to the nearest origin for each kept destination. */
  nearestMetersById: Map<string, number>;
}

/**
 * The distance from a destination to the NEAREST origin, in metres.
 *
 * Returns `Infinity` when there are no origins at all — with nothing to
 * measure from, no destination is "too far", and the caller keeps them all.
 */
export function nearestOriginMeters(
  destination: Coordinate,
  origins: readonly FilterOrigin[],
): number {
  if (origins.length === 0) return Number.POSITIVE_INFINITY;

  let nearest = Number.POSITIVE_INFINITY;
  for (const origin of origins) {
    const distance = haversineMeters(origin, destination);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

/**
 * Drops the destinations nobody can reach, and caps what is left.
 *
 * The cap is applied AFTER the distance cut, so the cap keeps the NEAREST
 * candidates rather than the first fifteen in whatever order the caller
 * supplied (PRD-05 §12.1, layer 2).
 */
export function prefilterDestinations<T extends FilterDestination>(
  origins: readonly FilterOrigin[],
  destinations: readonly T[],
  options: { maxKm?: number; cap?: number } = {},
): PrefilterResult<T> {
  const maxKm = options.maxKm ?? PRE_FILTER_MAX_KM;
  const cap = options.cap ?? CANDIDATE_CAP;
  const maxMeters = maxKm * 1000;

  const kept: T[] = [];
  const dropped: Array<{ destination: T; nearestMeters: number }> = [];
  const nearestMetersById = new Map<string, number>();

  for (const destination of destinations) {
    const nearest = nearestOriginMeters(destination, origins);

    // ★ WITH NO ORIGINS, NOTHING IS DROPPED.
    // Absence of a location is not a rejection — it is the absence of a
    // basis for a distance cut. The engine's own pre-filter behaves the
    // same way, and the two must agree: a routing pre-filter that dropped
    // every venue for a group with no shared locations would leave the
    // ranking empty, and an empty ranking is a product failure.
    if (origins.length === 0) {
      kept.push(destination);
      continue;
    }

    if (nearest > maxMeters) {
      dropped.push({ destination, nearestMeters: nearest });
      continue;
    }

    kept.push(destination);
    if (destination.id !== undefined) {
      nearestMetersById.set(destination.id, nearest);
    }
  }

  if (kept.length <= cap) {
    return { kept, dropped, nearestMetersById };
  }

  // The cap keeps the nearest candidates.
  const ordered = [...kept].sort(
    (a, b) =>
      nearestOriginMeters(a, origins) - nearestOriginMeters(b, origins),
  );
  const survivors = ordered.slice(0, cap);

  for (const destination of kept) {
    if (!survivors.includes(destination)) {
      dropped.push({
        destination,
        nearestMeters: nearestOriginMeters(destination, origins),
      });
    }
  }

  return { kept: survivors, dropped, nearestMetersById };
}
