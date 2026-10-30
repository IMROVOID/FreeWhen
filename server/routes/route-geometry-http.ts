/**
 * `GET /api/route/geometry?fromLat=&fromLng=&toLat=&toLng=`
 *
 * The line between a participant's start point and a proposed venue.
 *
 * The arithmetic lives in `route-geometry.ts` and is tested without a server; this
 * file is the HTTP seam — parse, limit, call, answer. Everything a reviewer needs
 * to know about WHY it is a proxy rather than a client call is documented there.
 *
 * ★ IT ANSWERS 200 EVEN WHEN THE PROVIDER DID NOT.
 *
 * A straight-line fallback is a legitimate answer, not an error: the map draws a
 * dashed line and the reader understands "this is the direction". A 5xx would
 * instead make the event page look broken over decoration.
 *
 * ★ IT IS RATE LIMITED, AND THAT IS NOT OPTIONAL.
 *
 * Every call spends a metered MapBox quota on behalf of a caller, exactly like
 * place search. A page that draws one line per venue makes several calls per
 * view, so the limit is generous — but it exists, because the alternative is an
 * unmetered egress path into somebody else's account.
 */

import { json, wireError } from '../lib/http';
import { clientIp, limiters } from '../lib/rate-limit';
import { readMapboxPublicToken } from '../lib/provider-secrets';
import { createProviderTransport } from '../lib/provider-transport';
import {
  isDrawablePoint,
  resolveRouteGeometry,
  type RouteGeometry,
} from './route-geometry';

/** Reads a coordinate from the query string. */
function coord(url: URL, latName: string, lngName: string): { lat: number; lng: number } | null {
  const lat = Number(url.searchParams.get(latName));
  const lng = Number(url.searchParams.get(lngName));

  const point = { lat, lng };
  return isDrawablePoint(point) ? point : null;
}

export async function routeGeometryHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const from = coord(url, 'fromLat', 'fromLng');
  const to = coord(url, 'toLat', 'toLng');

  // A malformed pair is a caller bug, not a provider outage — say so rather than
  // returning a line between two defaulted points.
  if (!from || !to) return wireError('VALIDATION_FAILED', {
    fields: { _: 'route.invalidCoordinates' },
  });

  const limited = limiters.geometryByIp.check(`route-geometry:${clientIp(request.headers)}`);
  if (!limited.allowed) {
    // The limiter already knows when this caller may try again; discarding it
    // makes a well-behaved client guess, and guessing usually means hammering.
    return wireError('RATE_LIMITED', {
      headers: { 'retry-after': String(limited.retryAfterSeconds) },
    });
  }

  const geometry: RouteGeometry = await resolveRouteGeometry(
    from,
    to,
    readMapboxPublicToken(),
    (target) => {
      const transport = createProviderTransport();
      return transport(target, { method: 'GET', headers: { accept: 'application/json' } });
    },
  );

  return json(geometry, 200, {
    // A route is one viewer's line: private, briefly cacheable, never shared.
    'Cache-Control': 'private, max-age=300',
  });
}
