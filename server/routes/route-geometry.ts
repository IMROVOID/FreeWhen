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
 * The longest encoded polyline this server will decode.
 *
 * ★ THE DECODER IS UNBOUNDED CPU, AND A PROVIDER RESPONSE IS UNTRUSTED INPUT.
 *
 * `decodePolyline` emits roughly one point per two characters, so a 100 KB
 * geometry is 50,000 points of synchronous work. The 8-second transport timeout
 * does NOT cover this: it aborts the body READ, and parsing happens after that
 * resolves. A served route for a 2 km walk is a few hundred points; 8 KB of
 * encoded geometry is already an order of magnitude past any real answer, so
 * anything larger is a fault or an attack and degrades to the straight line.
 */
export const MAX_ENCODED_POLYLINE = 8_192;

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

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    // Latitude chunk: 5-bit groups, low bit set means "another chunk follows".
    do {
      // `decodePolyline` is also reachable as a seam for caller-supplied
      // geometry, so a truncated chunk must stop the loop explicitly rather than
      // relying on `NaN >= 0x20` being false by accident.
      byte = encoded.charCodeAt(index++) - 63;
      if (!Number.isFinite(byte) || byte < -63) break;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (!Number.isFinite(byte) || byte < -63) break;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

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

/** The URL for a directions request, with the token appended. */
export function directionsUrl(from: RoutePoint, to: RoutePoint, accessToken: string): string {
  // Five decimals is ~1 m — finer than a route line can be drawn, and it makes two
  // viewers sharing a venue produce the SAME URL, so a proxy or CDN can reuse one
  // provider answer instead of paying for each.
  const fix = (value: number): string => value.toFixed(5);
  const coords = `${fix(from.lng)},${fix(from.lat)};${fix(to.lng)},${fix(to.lat)}`;
  // `geometries=polyline` is the default but is named so a future default change
  // cannot silently start returning GeoJSON into the polyline decoder.
  return `${DIRECTIONS_URL}/${coords}?geometries=polyline&overview=full&access_token=${accessToken}`;
}

/**
 * Resolves a line between two points.
 *
 * Never throws. Every failure — no token, a non-200, unparseable JSON, an empty
 * route — returns the straight-line geometry, because the caller is drawing a
 * map, not gating a decision on this.
 */
export async function resolveRouteGeometry(
  from: RoutePoint,
  to: RoutePoint,
  accessToken: string | null,
  transport: GeometryTransport,
): Promise<RouteGeometry> {
  const fallback = straightLineRoute(from, to);

  if (!isDrawablePoint(from) || !isDrawablePoint(to)) return fallback;

  // ★ TWO IDENTICAL POINTS ARE NOT A JOURNEY.
  //
  // The caller supplies both endpoints, so without this an attacker spends a
  // Directions request per call to be told the distance is zero. The straight
  // line is the correct answer and costs nothing.
  if (from.lat === to.lat && from.lng === to.lng) return fallback;

  if (accessToken === null || accessToken.trim() === '') return fallback;
  // A secret token must never reach a URL, and a `pk.` is the only usable form.
  if (!accessToken.startsWith('pk.')) return fallback;

  try {
    const response = await transport(directionsUrl(from, to, accessToken));
    if (response.status !== 200) return fallback;

    const body = JSON.parse(response.body) as {
      routes?: Array<{ geometry?: unknown; distance?: unknown }>;
    };

    const first = body.routes?.[0];
    if (!first || typeof first.geometry !== 'string') return fallback;

    // Refuse an oversized payload BEFORE spending CPU on it — see the note on
    // MAX_ENCODED_POLYLINE: the transport timeout does not cover parsing.
    if (first.geometry.length > MAX_ENCODED_POLYLINE) return fallback;

    const points = decodePolyline(first.geometry);
    // A one-point line is not a line; the fallback at least shows the direction.
    if (points.length < 2 || points.length > MAX_ROUTE_POINTS) return fallback;

    return {
      points,
      source: 'mapbox',
      distanceMetres: typeof first.distance === 'number' ? first.distance : null,
    };
  } catch {
    return fallback;
  }
}
