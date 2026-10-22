/**
 * Server-mediated place search (Plan 06 Task 8, FR-4.24).
 *
 * ★ THE CUSTOM PIN IS A FIRST-CLASS PATH, NOT A FALLBACK.
 *
 * In Tehran the common case is an informal spot — a particular corner of a park,
 * a café that no POI database carries. When search returns nothing, or is
 * degraded because Neshan is unconfigured or out of quota, the sheet keeps the
 * same "pick it on the map" entry it always had. Presenting it as an error path
 * would tell the user their place is invalid.
 */

import { apiRequest } from '@/src/lib/api';
import type { VenueRef } from '@/src/types/proposal';

export interface PlaceResult {
  provider_place_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string | null;
}

export interface PlaceSearchResult {
  results: PlaceResult[];
  /** True when the provider was unavailable — results will be empty. */
  degraded: boolean;
}

/** Below two characters a search costs a provider call and returns noise. */
export const MIN_SEARCH_LENGTH = 2;

export async function searchPlaces(
  term: string,
  bias: { lat: number; lng: number } | null = null,
): Promise<PlaceSearchResult> {
  const trimmed = term.trim();
  if (trimmed.length < MIN_SEARCH_LENGTH) return { results: [], degraded: false };

  const params = new URLSearchParams({ q: trimmed });
  if (bias) {
    params.set('lat', String(bias.lat));
    params.set('lng', String(bias.lng));
  }

  const { data } = await apiRequest<PlaceSearchResult>(`/api/place-search?${params.toString()}`);

  return { results: data.results, degraded: data.degraded };
}

/** A search result as a proposal may reference it. */
export function venueFromResult(result: PlaceResult): VenueRef {
  return {
    name: result.name,
    lat: result.lat,
    lng: result.lng,
    address: result.address,
    provider_place_id: result.provider_place_id,
  };
}

/** A hand-placed pin on the map — no provider id, which is honest. */
export function venueFromPin(
  name: string,
  coordinates: { lat: number; lng: number },
  address: string | null = null,
): VenueRef {
  return {
    name,
    lat: coordinates.lat,
    lng: coordinates.lng,
    address,
    provider_place_id: null,
  };
}
