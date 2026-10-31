/**
 * `/api/place-search` — place search, server-mediated
 * (Plan 06 Task 8, PRD-04 §4.5, PRD-10 D9).
 *
 * ★ THE CLIENT NEVER CALLS A PROVIDER (SERVER_MEDIATION).
 *
 * The search sheet calls this endpoint; this endpoint holds whatever key a provider
 * needs. That is the whole reason the endpoint exists — a key in the bundle is a key
 * in every stranger's hands, and `gate:secrets` fails the build if a server-only
 * variable name reaches `src/` or `app/`.
 *
 * ★ THE PROVIDER LADDER, BECAUSE ONE PAID KEY WAS THE WHOLE SEARCH.
 *
 * There was one rung: Neshan, and `degraded: true` whenever Neshan was unconfigured
 * or answered non-200. Deployed, that key is a DIRECTIONS key — Neshan answers
 * `{"status":"ERROR","code":485,"message":"Api Key services not match."}` because
 * search is a separate service with a separate key. The route turned that into
 * "search unavailable", so the reported symptom was "the map search returns no
 * result for everything", on app and web alike.
 *
 * Two rungs now, in cost order:
 *
 *   1. **Neshan search** — best Iranian coverage, needs `NESHAN_SEARCH_API_KEY`.
 *      A key is a key, not a promise: a 485 from a directions key falls through
 *      exactly like an absent one, because that is what it is.
 *   2. **Nominatim** — keyless, worldwide, and the reason search works at all on a
 *      deployment that has only configured routing.
 *
 * ★ AN EMPTY ANSWER IS NOT AN OUTAGE.
 *
 * `results: []` with `degraded: false` means "no place matches that"; the sheet
 * says so. `degraded: true` means "nobody could be asked", and the sheet offers the
 * custom pin instead. Conflating them told a user who misspelled a street that the
 * product's search was broken — and told a user whose key was invalid the same
 * thing, which is why the real cause took a request against the provider to find.
 *
 * ★ NO LOCATION REQUIRED (FR-4.25).
 *
 * The bias coordinate is optional. Searching «کافه» without one is a worse search,
 * not a forbidden one.
 */

import { json, wireError } from '../lib/http';
import { createProviderTransport } from '../lib/provider-transport';
import { clientIp, limiters } from '../lib/rate-limit';

/** Neshan's search endpoint. The key travels in a header. */
const NESHAN_SEARCH_URL = 'https://api.neshan.org/v1/search';

/** Nominatim's search endpoint. Keyless, and requires an identifying agent. */
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * The agent Nominatim's usage policy requires.
 *
 * It is not decoration: a request without one is liable to be answered with a 403
 * and no explanation, which would look exactly like the outage this ladder exists
 * to avoid.
 */
const NOMINATIM_AGENT = 'freewhen-place-search/1.0 (+https://freewhen.rovoid.tech)';

const MAX_RESULTS = 8;

export interface PlaceResult {
  /** The provider's place id — authoritative for duplicate detection. */
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

/** One entry of Nominatim's `jsonv2` response. */
interface NominatimItem {
  place_id?: unknown;
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  class?: unknown;
  type?: unknown;
}

/**
 * Neshan answers `location: {x: lng, y: lat}` — X IS LONGITUDE.
 *
 * Swapping them puts every result in the ocean off Somalia, and the bug is
 * invisible in a Persian-language test that only checks the title.
 */
export function toResult(item: NeshanItem): PlaceResult | null {
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
 * Nominatim hands back strings, and `display_name` is the whole address.
 *
 * The name is its first comma-separated part — "کافه نادری, تهران, ایران" is a place
 * called «کافه نادری» — and the rest is the address. Keeping the full string as the
 * name would put a street, a city and a country in a one-line row that clips.
 */
export function fromNominatim(item: NominatimItem): PlaceResult | null {
  const lat = typeof item.lat === 'string' ? Number(item.lat) : NaN;
  const lng = typeof item.lon === 'string' ? Number(item.lon) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (typeof item.display_name !== 'string' || item.display_name.trim() === '') return null;

  const [head, ...rest] = item.display_name.split(',');
  const name = (head ?? '').trim();
  if (name === '') return null;

  const address = rest.join(',').trim();

  return {
    provider_place_id: `osm:${String(item.place_id ?? `${lat},${lng}`)}`,
    name,
    address: address === '' ? null : address,
    lat,
    lng,
    // Nominatim splits the class and the type; the pair is what a caller can
    // compare against, and neither half alone is a category.
    category:
      typeof item.class === 'string' && typeof item.type === 'string'
        ? `${item.class}:${item.type}`
        : null,
  };
}

/** What one rung answered. */
interface RungOutcome {
  results: PlaceResult[];
  /** The provider answered successfully — including with zero results. */
  answered: boolean;
}

/**
 * The transport a caller injects.
 *
 * The same shape `route-geometry.ts` uses, and for the same reason: the ladder's
 * ORDER and its empty-versus-outage rule are the two things worth asserting, and
 * neither can be asserted against a live provider whose answer changes daily.
 */
export type SearchTransport = ReturnType<typeof createProviderTransport>;

/**
 * `GET /api/place-search?q=<term>&lat=&lng=`
 *
 * The identity is not required: place search reveals nothing about an event, and
 * requiring a participant row would block the proposal flow for a guest who has
 * not joined yet. It is still rate-limited per address, because it spends a metered
 * provider quota on someone else's behalf.
 *
 * Kept single-argument because it is registered as a route handler and handed
 * `(request, params)`; `searchPlaces` below is the injectable form.
 */
export function placeSearchHandler(request: Request): Promise<Response> {
  return searchPlaces(request, createProviderTransport());
}

/**
 * The ladder itself, with the transport supplied.
 *
 * Exported so `tests/server/place-search-fallback.test.ts` can assert the ORDER and
 * the empty-versus-outage rule against canned answers — neither is observable
 * against a live provider, whose answers change daily.
 */
export async function searchPlaces(
  request: Request,
  transport: SearchTransport,
): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  if (query.length < 2) return json({ results: [], degraded: false });

  const limited = limiters.searchByIp.check(`place-search:${clientIp(request.headers)}`);
  if (!limited.allowed) return wireError('RATE_LIMITED');

  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const bias =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  // ★ THE FIRST RUNG THAT ANSWERS WINS, INCLUDING WHEN IT ANSWERS "NOTHING".
  //
  // A non-empty result set from a stronger provider stops the ladder; so does a
  // successful empty answer, because "Neshan searched and found nothing" is a real
  // fact about the query and asking a second provider would contradict it. Only a
  // rung that could not be ASKED falls through.
  for (const rung of [
    () => neshanRung(transport, query, bias),
    () => nominatimRung(transport, query, bias),
  ]) {
    const outcome = await rung();

    // A degraded provider is a STATE, not an empty list — and a rung that answered
    // with nothing is a third state.
    if (outcome.answered) {
      return json({ results: outcome.results, degraded: false });
    }
  }

  // Nobody could be asked. The client's custom-pin path is a first-class route
  // (FR-4.24), so this is a redirect rather than an error the user must resolve.
  return json({ results: [], degraded: true });
}

/** Neshan, when this deployment has a key for its SEARCH service. */
async function neshanRung(
  transport: ReturnType<typeof createProviderTransport>,
  query: string,
  bias: { lat: number; lng: number } | null,
): Promise<RungOutcome> {
  const key = neshanSearchKey();
  if (!key) return { results: [], answered: false };

  const params = new URLSearchParams({ term: query });
  // The bias is optional; a non-finite value is simply not sent.
  if (bias) {
    params.set('lat', String(bias.lat));
    params.set('lng', String(bias.lng));
  }

  try {
    const response = await transport(`${NESHAN_SEARCH_URL}?${params.toString()}`, {
      method: 'GET',
      headers: { 'Api-Key': key, accept: 'application/json' },
    });

    // ★ A NON-200 IS "COULD NOT BE ASKED", AND 485 IS THE USUAL REASON.
    //
    // `483 ApiKeyTypeError` / `485 Api Key services not match` mean the key belongs
    // to a different Neshan service — a routing key, most often. There is no
    // partial answer to salvage, so this rung reports that it never got one and the
    // ladder tries the keyless rung instead of declaring search broken.
    if (response.status !== 200) return { results: [], answered: false };

    const payload = JSON.parse(response.body) as { items?: unknown };
    const items = Array.isArray(payload.items) ? payload.items : [];

    const results = items
      .map((item) => toResult(item as NeshanItem))
      .filter((result): result is PlaceResult => result !== null)
      .slice(0, MAX_RESULTS);

    return { results, answered: true };
  } catch {
    return { results: [], answered: false };
  }
}

/**
 * Nominatim, keyless.
 *
 * ★ THE BIAS BECOMES A BOUNDING BOX DATA STRUCTURE, NOT AN ANCHOR ORDER.
 *
 * Nominatim has no "near this point" parameter; it has `viewbox` + `bounded`, and
 * the box is derived here instead of asking the provider to sort by distance —
 * which it does not do. Roughly 25 km each way, which is a city.
 */
async function nominatimRung(
  transport: ReturnType<typeof createProviderTransport>,
  query: string,
  bias: { lat: number; lng: number } | null,
): Promise<RungOutcome> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(MAX_RESULTS),
    'accept-language': 'fa,en',
  });

  if (bias) {
    const span = 0.25;
    params.set(
      'viewbox',
      [
        bias.lng - span,
        bias.lat + span,
        bias.lng + span,
        bias.lat - span,
      ].join(','),
    );
    // Not `bounded`: a place the user names outside the box must still be found.
    // The box ranks what is inside it higher, which is all a bias should do.
  }

  try {
    const response = await transport(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        // Required by the provider's usage policy — see NOMINATIM_AGENT.
        'User-Agent': NOMINATIM_AGENT,
        accept: 'application/json',
      },
    });

    if (response.status !== 200) return { results: [], answered: false };

    const payload = JSON.parse(response.body) as unknown;
    const items = Array.isArray(payload) ? payload : [];

    const results = items
      .map((item) => fromNominatim(item as NominatimItem))
      .filter((result): result is PlaceResult => result !== null)
      .slice(0, MAX_RESULTS);

    return { results, answered: true };
  } catch {
    return { results: [], answered: false };
  }
}

/**
 * The Neshan search key, or `null` when Neshan search is not configured.
 *
 * Search is its own Neshan service with its own key: a directions key used against
 * the search endpoint answers `485 Api Key services not match`. It is read here
 * rather than through `providerKey` because the routing seam's `ProviderService`
 * vocabulary covers the travel services only, and a search key is not one.
 *
 * `NESHAN_SEARCH_API_KEY` wins, and `NESHAN_API_KEY` is the documented single key
 * for operators who provisioned one — the same compatibility rule the routing
 * ladder applies.
 */
function neshanSearchKey(): string | null {
  for (const name of ['NESHAN_SEARCH_API_KEY', 'NESHAN_API_KEY']) {
    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }

  return null;
}
