/**
 * Duplicate place detection (PRD-02 FR-2.7, §13.6).
 *
 * ★ THIS MODULE RETURNS A HINT. IT CANNOT REFUSE ANYTHING.
 *
 * There is no `throw` in this file and no boolean that a caller is meant to
 * gate on. A false positive that blocks a legitimate proposal is worse than the
 * duplicate it was trying to prevent: the second person at the same café is
 * making a real statement about where they want to go, and silently dropping it
 * removes a vote the group needed. The client therefore offers the existing
 * proposal as a convenience and keeps "create anyway" available always.
 *
 * ★ A `provider_place_id` MATCH IS AUTHORITATIVE.
 *
 * It is the provider's own identifier for the physical place. The same id is
 * the same venue no matter what either person typed as the title, so it short-
 * circuits the distance test entirely — the two rows may be metres apart in the
 * data and the titles may share no words.
 *
 * ★ THE POSITIONAL TEST NEEDS BOTH DISTANCE AND NAME.
 *
 * Distance alone flags every café on a busy street. Name alone flags every
 * branch of a chain. Both together is the pair that actually means "the same
 * place described twice", which is why the thresholds are conjunctive.
 */

import type { DuplicateHint, Proposal } from '@/src/types/proposal';

/**
 * The radius, in metres, within which two places may be the same.
 *
 * 75 m is roughly a city block — far enough to absorb the difference between
 * two geocoders' idea of one building's entrance, close enough that two
 * genuinely different cafés are not collapsed into one.
 */
export const DUPLICATE_RADIUS_M = 75;

/**
 * How alike two titles must be, on a 0–1 scale.
 *
 * Below this, two nearby places are treated as different. `0.7` tolerates the
 * spelling variation Persian place names actually show (`کافه دیدار` vs
 * `کافه‌ی دیدار`, `Café` vs `Cafe`) without merging `کافه دیدار` and
 * `کافه دیبا`.
 */
export const DUPLICATE_NAME_SIMILARITY = 0.7;

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

export interface PlaceCandidate {
  name: string;
  lat: number;
  lng: number;
  providerPlaceId?: string | null;
}

/**
 * The great-circle distance between two coordinates, in metres.
 *
 * Haversine rather than a flat-earth approximation: the 75 m threshold is small
 * enough that a planar formula's error is irrelevant in Tehran, but the same
 * function runs in the tests that place a candidate in another hemisphere, and
 * an approximation that quietly returns 0 there is a bad thing to build on.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;

  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Normalises a place name for comparison.
 *
 * ★ THE ZERO-WIDTH JOINER IS REMOVED, NOT TREATED AS A SPACE.
 *
 * Persian orthography routinely joins or drops ZWNJ in the same word — `کافه‌ی`
 * and `کافه ی` are the same place typed by two people. Mapping ZWNJ to nothing
 * (rather than to a space) makes both reduce to `کافهی`, which is the form that
 * compares equal. Arabic yeh and kaf are folded to their Persian counterparts
 * for the same reason: a keyboard decides which one the user produced, and the
 * user has no idea the difference exists.
 */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ًٌٍَُِّْ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A 0–1 similarity between two place names.
 *
 * Levenshtein distance over normalised names, scaled by the longer length. It
 * is O(n·m) with `n, m ≤ 120`, which is a few thousand operations per compare
 * and runs once per candidate — small enough that pulling in a string-metric
 * dependency for it would be the larger cost.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = normaliseName(a);
  const right = normaliseName(b);

  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;

  // Two rows of the matrix, rolled each iteration — the full table is never
  // needed and this keeps the allocation constant per call.
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;

    for (let j = 1; j <= right.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;

      current[j] = Math.min(substitution, deletion, insertion);
    }

    [previous, current] = [current, previous];
  }

  const distance = previous[right.length] ?? 0;
  return 1 - distance / Math.max(left.length, right.length);
}

/**
 * The existing place proposal this candidate duplicates, or `null`.
 *
 * Withdrawn proposals are skipped: a withdrawn idea is not something to offer
 * as "vote on the existing one", because there is no longer an existing one to
 * vote on.
 */
export function findDuplicatePlace(
  candidate: PlaceCandidate,
  existing: readonly Proposal[],
): DuplicateHint | null {
  const providerId = candidate.providerPlaceId?.trim();

  for (const proposal of existing) {
    if (proposal.venue == null) continue;
    if (proposal.status === 'WITHDRAWN') continue;

    const existingProviderId = proposal.venue.provider_place_id?.trim();

    // Authoritative: the provider says these are the same physical place.
    if (providerId && existingProviderId && providerId === existingProviderId) {
      return { proposal, reason: 'same_provider_place', metres: null };
    }

    const metres = haversineMeters(candidate, proposal.venue);
    if (metres >= DUPLICATE_RADIUS_M) continue;

    if (nameSimilarity(candidate.name, proposal.venue.name) > DUPLICATE_NAME_SIMILARITY) {
      return { proposal, reason: 'near_and_similar', metres: Math.round(metres) };
    }
  }

  return null;
}
