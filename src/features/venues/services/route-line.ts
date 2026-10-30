/**
 * The route line, fetched from the server's geometry proxy.
 *
 * ★ THE CLIENT ASKS ITS OWN API, NEVER MAPBOX.
 *
 * `server/routes/route-geometry.ts` documents why the call is proxied. From this
 * side the reason is simpler: one place decides which provider draws the line,
 * which profile it uses and how a failure is represented, and this module only has
 * to turn an answer into the shapes the map draws.
 *
 * ★ A FAILED LINE IS NOT A FAILED PAGE.
 *
 * The line is decoration over a decision the engine already made — the travel
 * minutes came from the routing ladder and are unaffected. So this NEVER throws
 * and never surfaces an error: a refused request and a `straight_line` answer are
 * the same result to the caller, and the map draws the fallback dashed.
 */

import { apiRequest } from '@/src/lib/api';
import type { Coordinate } from '@/src/routing/types';

/** The line between two points, as the server answers it. */
export interface RouteGeometry {
  /** GeoJSON order — `[lng, lat]`. */
  points: Array<[number, number]>;
  source: 'mapbox' | 'straight_line';
  distanceMetres: number | null;
}

/** The line a caller draws when nothing was fetched: the direct bearing. */
export function fallbackRoute(from: Coordinate, to: Coordinate): RouteGeometry {
  return {
    points: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    source: 'straight_line',
    distanceMetres: null,
  };
}

/** Whether both endpoints can be drawn at all. */
function drawable(point: Coordinate | null | undefined): point is Coordinate {
  return (
    point !== null &&
    point !== undefined &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 85.0511 &&
    Math.abs(point.lng) <= 180
  );
}

/**
 * Fetches the line between two points.
 *
 * Resolves to the straight-line fallback on every failure path — no endpoints, a
 * refused request, a malformed body — so the caller never has to branch on it.
 */
export async function fetchRoute(
  from: Coordinate | null | undefined,
  to: Coordinate | null | undefined,
): Promise<RouteGeometry | null> {
  // No endpoints means no line. `null` is distinct from a fallback: there is
  // nothing to draw between a place and nowhere, and a direction line to (0, 0)
  // would be a lie about where somebody is.
  if (!drawable(from) || !drawable(to)) return null;

  const query = new URLSearchParams({
    fromLat: String(from.lat),
    fromLng: String(from.lng),
    toLat: String(to.lat),
    toLng: String(to.lng),
  });

  try {
    const { data } = await apiRequest<RouteGeometry>(`/api/route/geometry?${query.toString()}`);

    // A body without a usable line is the fallback, not an error: the server
    // already performs this substitution, and a second guess here would draw a
    // line the server refused.
    if (!Array.isArray(data.points) || data.points.length < 2) return fallbackRoute(from, to);

    const sane = data.points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    );

    if (!sane) return fallbackRoute(from, to);

    return {
      points: data.points,
      source: data.source === 'mapbox' ? 'mapbox' : 'straight_line',
      distanceMetres: typeof data.distanceMetres === 'number' ? data.distanceMetres : null,
    };
  } catch {
    return fallbackRoute(from, to);
  }
}
