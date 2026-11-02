/**
 * Route geometry — the line on the map, resolved server-side.
 *
 * ★ WHY THIS IS A PROXY AND NOT A CLIENT CALL.
 *
 * `src/routing/provider.ts` states the rule for this codebase: the client never
 * opens a socket to a provider that is keyed. It holds there for travel TIME and
 * it holds here for route GEOMETRY, for the same three reasons — the terms, the
 * binary, and the audit trail.
 *
 * The MapBox token this uses is a public `pk.` and could technically be called
 * from the browser. It is proxied anyway, because a second place that decides
 * "which provider, which style, which cache policy" is how the two pictures in
 * this app start disagreeing. One seam, one answer.
 *
 * ★ GEOMETRY DEGRADES TO A STRAIGHT LINE, NEVER TO NOTHING.
 *
 * A route is decoration over a decision the engine already made: the travel
 * minutes come from Neshan/ORS/the ladder and are unaffected by this endpoint. If
 * MapBox Directions refuses, is unreachable, or is not configured, the caller
 * gets `source: 'straight_line'` between the two points and draws a dashed line.
 * That is honest — it says "this is the direction, not the road" — and it is a
 * better outcome than an empty map on an event page whose whole point is showing
 * where people are relative to a place.
 *
 * ★ NO CACHE, DELIBERATELY.
 *
 * Travel time is cached in the database because a provider quota is the binding
 * constraint and two people departing in the same quarter hour share a
 * measurement. A route LINE has no such profile: it is one polyline per venue per
 * viewer, it is not on the ranking hot path, and a stale cache would draw a road
 * that has since closed. `Cache-Control` is a short private window so the browser
 * does not re-request on every scroll.
 */

/** A point on the wire. `lat`/`lng`, never the provider's `lat/lon`. */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/** A resolved line, plus how it was obtained. */
export interface RouteGeometry {
  /**
   * The line, in `[lng, lat]` order — GeoJSON's convention, which is what every
   * renderer's line layer expects.
   */
  points: Array<[number, number]>;
  /** `mapbox` when the provider answered, `straight_line` when it did not. */
  source: 'mapbox' | 'straight_line';
  /** The provider's distance in metres, when it answered. */
  distanceMetres: number | null;
}

/** MapBox Directions, one profile. Driving is the only mode MapBox covers here. */
const DIRECTIONS_URL = 'https://api.mapbox.com/directions/v5/mapbox/driving';

/**
 * The transport a caller injects.
 *
 * The same shape as `src/routing/provider.ts`'s transport, so the server passes
 * its own and a test passes a stub — no module here reaches the network on its
 * own, which is what makes the failure paths testable.
 */
export type GeometryTransport = (
  url: string,
) => Promise<{ status: number; body: string }>;

/** The straight-line answer, which is always available. */
export function straightLineRoute(from: RoutePoint, to: RoutePoint): RouteGeometry {
  return {
    points: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    source: 'straight_line',
    distanceMetres: null,
  };
}

/**
 * The geometry precision MapBox Directions encodes at, and the decoder reads.
 *
 * ★ IT IS 5, AND THAT IS THE PROVIDER'S CONTRACT, NOT A CHOICE.
 *
 * `polyline6` is a valid value for MapBox's MAPS API, but it is NOT one for
 * DIRECTIONS: the `geometries` parameter there accepts `geojson` or `polyline`
 * only, and an unrecognised value is silently ignored rather than rejected. An
 * earlier revision of this file asked for `polyline6`, was answered with a
 * precision-5 polyline, and then decoded it at precision 6 — which divides every
 * coordinate by ten. The whole of Tehran's route came back at (5.14, 3.57) in the
 * Gulf of Guinea, and the map drew a line in the sea. The unit tests did not catch
 * it because they fed the decoder a polyline encoded at the same precision they
 * decoded with; only a live probe against the real service did.
 *
 * So the request asks for what Directions actually offers, and the decoder is told
 * the precision that request produces. The two constants below are therefore
 * pinned to each other by a test.
 */
export const GEOMETRY_PRECISION = 5;

/** The `geometries=` value that pairs with `GEOMETRY_PRECISION`. */
const GEOMETRIES_PARAM = 'polyline';

/**
 * The precision the ENDPOINTS are rounded to in the provider URL.
 *
 * Deliberately NOT `GEOMETRY_PRECISION`: this one is a cache identity, not a shape
 * resolution. See `directionsUrl`.
 */
export const ROUTE_URL_DECIMALS = 5;

/**
 * The longest encoded polyline this server will decode.
 *
 * ★ THE DECODER IS UNBOUNDED CPU, AND A PROVIDER RESPONSE IS UNTRUSTED INPUT.
 *
 * `decodePolyline` emits roughly one point per two characters, so a 100 KB
 * geometry is 50,000 points of synchronous work. The 8-second transport timeout
 * does NOT cover this: it aborts the body READ, and parsing happens after that
 * resolves. A served route for a 2 km walk is a few hundred points; 32 KB of
 * encoded geometry — which is what six decimals costs for an order of magnitude
 * more vertices than any real answer — is still well past anything the provider
 * produces, so the ceiling remains a fault boundary rather than a route limit.
 */
export const MAX_ENCODED_POLYLINE = 32_768;

/**
 * The most points a drawn route may carry.
 *
 * A `overview=full` route across a city is under a thousand points. Beyond this
 * the line is not more accurate, it is just expensive to hand to a renderer.
 */
export const MAX_ROUTE_POINTS = 2_000;

/**
 * Parses MapBox's `routes[0].geometry` — an encoded polyline.
 *
 * ★ THE DECODER IS INLINED BECAUSE THE ALTERNATIVE IS A DEPENDENCY.
 *
 * `@mapbox/polyline` is a 4 KB package for 20 lines of arithmetic that is fully
 * specified by Google's polyline algorithm. The two failure modes — an off-by-one
 * in the chunk continuation and a sign error — are covered by the unit tests
 * attached to this file.
 */
export function decodePolyline(encoded: string, precision = 5): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const factor = 10 ** precision;

  let index = 0;
  let lat = 0;
  let lng = 0;

  /**
   * The next signed delta, advancing `index` past its last 5-bit group.
   *
   * ★ THE TERMINATION BIT IS READ OUT OF THE *MASKED* VALUE, NOT THE RAW BYTE.
   *
   * Each group contributes its low five bits; the SIXTH bit — the one that says
   * "another group follows" — is `chunk >= 0x20` on the masked value. Testing the !"
   * raw byte instead is the same question only when no higher bit is set, and a
   * payload character above `0x7f` sets plenty of them: the loop then kept consuming
   * groups that belonged to the NEXT coordinate. `@` (code 64 → 1 after the offset)
   * is exactly such a character, and it silently corrupted the third point of the
   * reference polyline while the first two decoded correctly.
   */
  function nextDelta(): number {
    let shift = 0;
    let result = 0;

    for (;;) {
      // `decodePolyline` is also reachable as a seam for caller-supplied geometry,
      // so a truncated chunk must stop rather than run off the end of the string.
      if (index >= encoded.length) break;

      const chunk = encoded.charCodeAt(index++) - 63;
      if (!Number.isFinite(chunk) || chunk < 0) break;

      result |= (chunk & 0x1f) << shift;
      shift += 5;

      if (chunk < 0x20) break;
    }

    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    lat += nextDelta();
    lng += nextDelta();

    // GeoJSON order: longitude first.
    points.push([lng / factor, lat / factor]);
  }

  return points;
}

/** Whether a value is a coordinate the map can draw. */
export function isDrawablePoint(value: unknown): value is RoutePoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Partial<RoutePoint>;
  return (
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 85.0511 &&
    Math.abs(point.lng) <= 180
  );
}

/**
 * The URL for a directions request, with the token appended.
 *
 * ★ TWO DIFFERENT ROUNDINGS, FOR TWO DIFFERENT QUESTIONS.
 *
 * The ENDPOINT is rounded to five decimals (~1.1 m) so that two viewers standing at
 * the same venue produce byte-identical URLs and a cache can answer the second one
 * for free. That property is kept deliberately — it is the difference between one
 * metered call and one per viewer.
 *
 * The GEOMETRY is requested at six decimals (`polyline6`), because that is a
 * separate knob: how finely the provider encodes the SHAPE it computed. Five
 * decimals there quantised adjacent vertices onto each other and flattened the
 * curve, which is the reported "polygon lines drawn on the streets".
 *
 * ★ AND THE ROUNDING CANNOT BE ALLOWED TO FUSE TWO DISTINCT ENDPOINTS.
 *
 * That is the short-distance defect. At five decimals a proposed place and a start
 * point a couple of metres apart — a pin and a doorway, both in the same block —
 * rounded onto the SAME pair, so the provider was asked for a zero-length leg. It
 * answered with a one-point geometry, the decoder rejected it as "not a line", and
 * the map drew the straight-line fallback: "it is a simple straight line on short
 * distances even though there is still a street between them".
 *
 * So the endpoints are rounded for the cache key, and THEN nudged apart if the
 * rounding collided. A real answer comes back for a real 3 m journey, and two
 * viewers at the same venue still share one URL, because their rounding agrees
 * long before the nudge applies.
 */
export function directionsUrl(from: RoutePoint, to: RoutePoint, accessToken: string): string {
  const round = (value: number): string => value.toFixed(ROUTE_URL_DECIMALS);

  const fromLng = round(from.lng);
  let fromLat = round(from.lat);
  const toLng = round(to.lng);
  const toLat = round(to.lat);

  // ★ ONLY A ROUNDING COLLISION IS BROKEN, AND ONLY BY ONE UNIT.
  //
  // The endpoints were distinct on the way in (`resolveRouteGeometry` short-circuits
  // an identical pair), so reaching here with equal strings means the 1.1 m grid
  // fused them. Advancing `from` one step of the grid is the smallest change that
  // restores the journey without inventing a distance: 1.1 m.
  if (fromLng === toLng && fromLat === toLat) {
    fromLat = (Number(fromLat) + 10 ** -ROUTE_URL_DECIMALS).toFixed(ROUTE_URL_DECIMALS);
  }

  const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
  // `geometries` is named explicitly rather than left to the default, so a future
  // change to MapBox's default cannot silently start returning a coarser shape
  // than `decodePolyline` was told to read.
  return `${DIRECTIONS_URL}/${coords}?geometries=${GEOMETRIES_PARAM}&overview=full&steps=false&access_token=${accessToken}`;
}

/**
 * Resolves a line between two points.
 *
 * Never throws. Every failure — no token, a non-200, unparseable JSON, an empty
 * route — returns the straight-line geometry, because the caller is drawing a
 * map, not gating a decision on this.
 *
 * ★ TWO PROVIDERS, IN ORDER, BECAUSE ONE OF THEM DOES NOT COVER THIS COUNTRY.
 *
 * The report was "the lines are just straight dashed lines, not real navigation
 * routes". The lines were straight because MapBox Directions refuses this account's
 * token — every call degraded to the fallback, so the map never drew a road. MapBox's
 * driving profile has thin coverage in Iran in any case, which is why the travel-TIME
 * ladder does not use it either; Neshan is the Iranian provider this product already
 * pays for, and its direction endpoint returns the same route as a polyline.
 *
 * So MapBox is tried first (it is the token every deployment already has), and
 * Neshan — when a direction key is configured — answers when MapBox cannot.
 */
export async function resolveRouteGeometry(
  from: RoutePoint,
  to: RoutePoint,
  accessToken: string | null,
  transport: GeometryTransport,
  alternatives: RouteAlternatives = {},
): Promise<RouteGeometry> {
  const fallback = straightLineRoute(from, to);

  if (!isDrawablePoint(from) || !isDrawablePoint(to)) return fallback;

  // ★ TWO IDENTICAL POINTS ARE NOT A JOURNEY.
  //
  // The caller supplies both endpoints, so without this an attacker spends a
  // Directions request per call to be told the distance is zero. The straight
  // line is the correct answer and costs nothing.
  if (from.lat === to.lat && from.lng === to.lng) return fallback;

  const mapbox = await resolveWithMapbox(from, to, accessToken, transport);
  if (mapbox !== null) return mapbox;

  return (await resolveWithNeshan(from, to, alternatives)) ?? fallback;
}

/** The providers `resolveRouteGeometry` may fall back to. */
export interface RouteAlternatives {
  /** A Neshan direction key, when the deployment has one. */
  neshanKey?: string | null;
}

/** MapBox Directions, or `null` when it could not answer. */
async function resolveWithMapbox(
  from: RoutePoint,
  to: RoutePoint,
  accessToken: string | null,
  transport: GeometryTransport,
): Promise<RouteGeometry | null> {
  if (accessToken === null || accessToken.trim() === '') return null;
  // A secret token must never reach a URL, and a `pk.` is the only usable form.
  if (!accessToken.startsWith('pk.')) return null;

  try {
    const response = await transport(directionsUrl(from, to, accessToken));
    if (response.status !== 200) return null;

    const body = JSON.parse(response.body) as {
      routes?: Array<{ geometry?: unknown; distance?: unknown }>;
    };

    const first = body.routes?.[0];
    if (!first || typeof first.geometry !== 'string') return null;

    // Refuse an oversized payload BEFORE spending CPU on it — see the note on
    // MAX_ENCODED_POLYLINE: the transport timeout does not cover parsing.
    if (first.geometry.length > MAX_ENCODED_POLYLINE) return null;

    const points = decodePolyline(first.geometry, GEOMETRY_PRECISION);
    // A one-point line is not a line; the caller's fallback at least shows the
    // direction.
    if (points.length < 2 || points.length > MAX_ROUTE_POINTS) return null;

    return {
      points,
      source: 'mapbox',
      distanceMetres: typeof first.distance === 'number' ? first.distance : null,
    };
  } catch {
    return null;
  }
}

/**
 * Neshan, whose direction endpoint answers with the route's points already decoded.
 *
 * It takes the key in an `Api-Key` HEADER rather than in the URL, so the key never
 * reaches a log line or a proxy's cache key.
 */
async function resolveWithNeshan(
  from: RoutePoint,
  to: RoutePoint,
  alternatives: RouteAlternatives,
): Promise<RouteGeometry | null> {
  const key = alternatives.neshanKey?.trim() ?? '';
  if (key === '') return null;

  const query = new URLSearchParams({
    type: 'car',
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
  });

  try {
    const response = await fetch(`https://api.neshan.org/v4/direction?${query.toString()}`, {
      method: 'GET',
      headers: { 'Api-Key': key, accept: 'application/json' },
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
    });

    if (response.status !== 200) return null;

    const body = (await response.json()) as {
      routes?: Array<{
        overview_polyline?: { points?: unknown };
        legs?: Array<{ distance?: { value?: number } }>;
      }>;
    };

    const first = body.routes?.[0];
    const encoded = first?.overview_polyline?.points;
    if (typeof encoded !== 'string' || encoded.length === 0) return null;
    if (encoded.length > MAX_ENCODED_POLYLINE) return null;

    const points = decodePolyline(encoded, GEOMETRY_PRECISION);
    if (points.length < 2 || points.length > MAX_ROUTE_POINTS) return null;

    const distance = (first?.legs ?? []).reduce(
      (total, leg) => total + (leg.distance?.value ?? 0),
      0,
    );

    return {
      points,
      // Reported as `mapbox` so the client's union — and its "is this a road?"
      // branch — does not need a third member for the same fact.
      source: 'mapbox',
      distanceMetres: distance > 0 ? Math.round(distance) : null,
    };
  } catch {
    return null;
  }
}
