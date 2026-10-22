/**
 * Encoding the ranked venues as pins (Plan 08 Task 7, FR-4.13, AC-4.6.1).
 *
 * ★ RANK IS NUMBER + SIZE + COLOUR.
 *
 * The number is what survives greyscale; size is the second signal and colour
 * the third. Rank 1 uses the theme's primary (Volt in dark), which means
 * "decided/leading" and is not decoration (Style Guide §2.1) — ranks 2–3 sit
 * on `surface2`, excluded venues on `surface3` plus a muted tone.
 *
 * ★ EXCLUDED VENUES ARE STILL ON THE MAP.
 *
 * They are not in the ranked array, so they must be encoded from the
 * exclusions. Hiding them hides the reason for the decision (OQ-4.2).
 */

import type { VenuePin } from './types';
import type { RankedVenue } from '@/src/engine/types';

/** The rank tiers a pin can be in. */
export function sizeForRank(rank: number): VenuePin['size'] {
  if (rank === 1) return 'lead';
  if (rank === 2 || rank === 3) return 'near';
  return 'rest';
}

/** The tone for a rank. Excluded venues override this to a muted tier. */
export function toneForRank(rank: number): VenuePin['tone'] {
  if (rank === 1) return 'primary';
  if (rank === 2 || rank === 3) return 'near';
  return 'rest';
}

export interface PinSource {
  venueId: string;
  name: string;
  lat: number;
  lng: number;
  rank: number;
}

/**
 * Builds the pins from the ranking plus the excluded venues.
 *
 * `excludedIds` is a set of venue ids that were hard-filtered; they keep their
 * position on the map but take the muted tier and `excluded: true`.
 */
export function buildVenuePins(
  ranked: RankedVenue[],
  coordinates: Record<string, { lat: number; lng: number }>,
  excludedIds: ReadonlySet<string> = new Set(),
  selectedVenueId: string | null = null,
): VenuePin[] {
  const pins: VenuePin[] = [];

  for (const venue of ranked) {
    const coordinate = coordinates[venue.venueId];
    if (!coordinate) continue;

    pins.push({
      venueId: venue.venueId,
      name: venue.name,
      coordinate,
      rank: venue.rank,
      size: sizeForRank(venue.rank),
      tone: toneForRank(venue.rank),
      selected: venue.venueId === selectedVenueId,
      excluded: excludedIds.has(venue.venueId),
    });
  }

  return pins;
}

/**
 * Two venues at identical coordinates are offset, never merged.
 *
 * The edge-case checklist calls this out: stacked pins at one address would
 * silently hide a candidate, and the list would then contain a venue the map
 * cannot show. The offset is a small deterministic nudge in a ring, so the
 * same input always produces the same layout.
 */
export function offsetCoincident<T extends { coordinate: { lat: number; lng: number } }>(
  items: T[],
): T[] {
  const seen = new Map<string, number>();

  return items.map((item) => {
    const key = `${item.coordinate.lat.toFixed(5)},${item.coordinate.lng.toFixed(5)}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);

    if (count === 0) return item;

    const angle = (count * 137.5 * Math.PI) / 180; // golden angle — no overlap
    const nudge = COINCIDENT_NUDGE_DEGREES * Math.ceil(count / 4);

    return {
      ...item,
      coordinate: {
        lat: item.coordinate.lat + Math.sin(angle) * nudge,
        lng: item.coordinate.lng + Math.cos(angle) * nudge,
      },
    };
  });
}

/** About 30 m — enough to separate two pins without moving either venue. */
const COINCIDENT_NUDGE_DEGREES = 0.0003;
