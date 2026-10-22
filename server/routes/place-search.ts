/**
 * `/api/place-search` — Neshan place search, server-mediated
 * (Plan 06 Task 8, PRD-04 §4.5, PRD-10 D9).
 *
 * ★ THE CLIENT NEVER CALLS NESHAN (SERVER_MEDIATION).
 *
 * The search sheet calls this endpoint; this endpoint holds the key. That is the
 * whole reason the endpoint exists — a key in the bundle is a key in every
 * stranger's hands, and `gate:secrets` fails the build if a server-only variable
 * name reaches `src/` or `app/`.
 *
 * ★ ABSENT KEY IS DEGRADED, NOT BROKEN.
 *
 * An unconfigured Neshan answers `200` with `degraded: true` and no results. The
 * sheet then falls through to its custom-pin path, which is a first-class route
 * anyway rather than a fallback (FR-4.24) — a park corner or a well-known café
 * that no POI database carries.
 *
 * ★ NO LOCATION REQUIRED (FR-4.25).
 *
 * The bias coordinate is optional. Searching "کافه" without one is a worse
 * search, not a forbidden one.
 */

import { json, wireError } from '../lib/http';
import { createProviderTransport } from '../lib/provider-transport';
import { clientIp, limiters } from '../lib/rate-limit';

/** Neshan's search endpoint. The key travels in a header. */
const NESHAN_SEARCH_URL = 'https://api.neshan.org/v1/search';

const MAX_RESULTS = 8;

export interface PlaceResult {
  /** The Neshan place id — authoritative for duplicate detection. */
  provider_place_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string | null;
}

/** One entry of Neshan's search response. */
interface NeshanItem {
  title?: unknown;
  address?: unknown;
  neighbourhood?: unknown;
  region?: unknown;
  categories?: unknown;
  location?: { x?: unknown; y?: unknown };
}

/**
 * Neshan answers `location: {x: lng, y: lat}` — X IS LONGITUDE.
 *
 * Swapping them puts every result in the ocean off Somalia, and the bug is
 * invisible in a Persian-language test that only checks the title.
 */
function toResult(item: NeshanItem): PlaceResult | null {
  const x = item.location?.x;
  const y = item.location?.y;

  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (typeof item.title !== 'string' || item.title.trim() === '') return null;

  const address = [item.address, item.neighbourhood, item.region]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join('، ');

  const category =
    Array.isArray(item.categories) && typeof item.categories[0] === 'string'
      ? item.categories[0]
      : null;

  return {
    // Neshan's search payload carries no stable id on every result, so the
    // title/coordinate pair is the identity the provider actually offers.
    provider_place_id: `${item.title}@${y.toFixed(6)},${x.toFixed(6)}`,
    name: item.title.trim(),
    address: address === '' ? null : address,
    lat: y,
    lng: x,
    category,
  };
}

/**
 * `GET /api/place-search?q=<term>&lat=&lng=`
 *
 * The identity is not required: place search reveals nothing about an event, and
 * requiring a participant row would block the proposal flow for a guest who has
 * not joined yet. It is still rate-limited per address, because it spends a
 * metered provider quota on someone else's behalf.
 */
export async function placeSearchHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (query.length < 2) return json({ results: [], degraded: false });

  const limited = limiters.searchByIp.check(`place-search:${clientIp(request.headers)}`);
  if (!limited.allowed) return wireError('RATE_LIMITED');

  const key = neshanSearchKey();
  if (!key) return json({ results: [], degraded: true });

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));

  const params = new URLSearchParams({ term: query });
  // The bias is optional; a non-finite value is simply not sent.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    params.set('lat', String(lat));
    params.set('lng', String(lng));
  }

  try {
    const transport = createProviderTransport();
    const response = await transport(`${NESHAN_SEARCH_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { 'Api-Key': key, accept: 'application/json' },
    });

    if (response.status !== 200) return json({ results: [], degraded: true });

    const payload = JSON.parse(response.body) as { items?: unknown };
    const items = Array.isArray(payload.items) ? payload.items : [];

    const results = items
      .map((item) => toResult(item as NeshanItem))
      .filter((result): result is PlaceResult => result !== null)
      .slice(0, MAX_RESULTS);

    return json({ results, degraded: false });
  } catch {
    // A provider that throws is a provider that is down. The client still has
    // its custom-pin path, so this is a degraded answer rather than an error
    // the user has to resolve before they can propose a place.
    return json({ results: [], degraded: true });
  }
}

/**
 * The Neshan search key, or `null` when search is not configured.
 *
 * Search is its own Neshan service with its own key: a directions key used
 * against the search endpoint answers `483 ApiKeyTypeError`. It is read here
 * rather than through `providerKey` because the routing seam's
 * `ProviderService` vocabulary covers the travel services only, and a search
 * key is not a travel service.
 *
 * `NESHAN_SEARCH_API_KEY` wins, and `NESHAN_API_KEY` is the documented single
 * key for operators who provisioned one — the same compatibility rule the
 * routing ladder applies.
 */
function neshanSearchKey(): string | null {
  for (const name of ['NESHAN_SEARCH_API_KEY', 'NESHAN_API_KEY']) {
    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }

  return null;
}
