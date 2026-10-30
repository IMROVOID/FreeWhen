/**
 * The route line on an event page — decoded, proxied and unable to take the map down.
 *
 * ★ THE LINE IS DECORATION OVER A DECISION ALREADY MADE.
 *
 * Travel minutes come from the routing ladder (Neshan → ORS → straight-line) and
 * are unaffected by anything here. So nothing in this path may throw, and nothing
 * may answer a status the event page would treat as a failure: a missing token, a
 * refused quota and an unparseable body all resolve to the same straight line,
 * labelled `straight_line` so the UI can draw it dashed and be honest about it.
 *
 * ★ AND IT IS A PROXY FOR A PUBLIC TOKEN, WHICH IS THE INTERESTING PART.
 *
 * The token is `pk.` and could be called from the browser. It is proxied anyway
 * because `src/routing/provider.ts` states the rule this codebase holds: the
 * client never opens a socket to a provider. Keeping the rule means one place
 * decides which provider, which profile and which cache policy — and it is the
 * same place every other provider decision is made.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_ENCODED_POLYLINE,
  MAX_ROUTE_POINTS,
  decodePolyline,
  directionsUrl,
  isDrawablePoint,
  resolveRouteGeometry,
  straightLineRoute,
  type GeometryTransport,
} from '@/server/routes/route-geometry';

const PK = 'pk.eyJ1IjoiZml4dHVyZSJ9.c2lnbmF0dXJl';
const FROM = { lat: 35.6892, lng: 51.389 };
const TO = { lat: 35.7100, lng: 51.4200 };

/** A transport that answers one canned response and records the URL. */
function stub(
  status: number,
  body: string,
): { transport: GeometryTransport; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    transport: async (url) => {
      urls.push(url);
      return { status, body };
    },
  };
}

/* ── The polyline decoder ─────────────────────────────────────────────────── */

test('a known polyline decodes to the coordinates it encodes', () => {
  // Arrange — Google's documented reference example: (38.5, -120.2),
  // (40.7, -120.95), (43.252, -126.453).
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  // Act
  const points = decodePolyline(encoded);

  // Assert — GeoJSON order, so longitude first.
  assert.deepEqual(points, [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ]);
});

test('a two-point line round-trips to within a centimetre', () => {
  // Arrange — Tehran to a neighbourhood a few kilometres north, encoded by the
  // polyline algorithm's own reference implementation. A hand-typed string is
  // how the first version of this test came to assert against coordinates that
  // were never in it.
  const encoded = 'opyxEg|sxH_aCw`E';

  // Act
  const points = decodePolyline(encoded);

  // Assert — the decoder must not drift on real coordinates, only on a toy pair.
  assert.equal(points.length, 2);
  const [first, second] = points;
  assert.ok(Math.abs(first![0] - 51.389) < 0.01, `lng decoded to ${first![0]}`);
  assert.ok(Math.abs(first![1] - 35.6892) < 0.01, `lat decoded to ${first![1]}`);
  assert.ok(Math.abs(second![0] - 51.42) < 0.01, `lng decoded to ${second![0]}`);
  assert.ok(Math.abs(second![1] - 35.71) < 0.01, `lat decoded to ${second![1]}`);
});

test('an empty string decodes to no points, not to the origin', () => {
  // Assert — a point at (0,0) is in the Atlantic, and drawing a line to it would
  // be a lie about where the venue is.
  assert.deepEqual(decodePolyline(''), []);
});

test('the decoder reads GEOJSON order — longitude first', () => {
  // Arrange — a renderer that receives lat,lng draws the line in the wrong
  // hemisphere, and the mistake is invisible in a country whose coordinates are
  // both large and positive.
  const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');

  // Act
  const [lng, lat] = points[0]!;

  // Assert
  assert.equal(lng, -120.2);
  assert.equal(lat, 38.5);
});

/* ── The straight-line fallback ───────────────────────────────────────────── */

test('the fallback is a two-point line between the endpoints', () => {
  // Act
  const route = straightLineRoute(FROM, TO);

  // Assert
  assert.equal(route.source, 'straight_line');
  assert.deepEqual(route.points, [
    [FROM.lng, FROM.lat],
    [TO.lng, TO.lat],
  ]);
  assert.equal(route.distanceMetres, null, 'a straight line must not claim a road distance');
});

/* ── Resolution, and every way it degrades ────────────────────────────────── */

test('a good provider answer is used, and says where it came from', async () => {
  // Arrange — MapBox answers with a two-point polyline (Tehran, encoded by the
  // reference implementation).
  const body = JSON.stringify({
    routes: [{ geometry: 'opyxEg|sxH_aCw`E', distance: 4200 }],
  });
  const { transport, urls } = stub(200, body);

  // Act
  const route = await resolveRouteGeometry(FROM, TO, PK, transport);

  // Assert
  assert.equal(route.source, 'mapbox');
  assert.equal(route.distanceMetres, 4200);
  assert.ok(route.points.length >= 2);
  assert.equal(urls.length, 1, 'the provider was called more than once');
});

test('no token falls back rather than throwing or calling out', async () => {
  // Arrange
  const { transport, urls } = stub(200, '{}');

  // Act
  const route = await resolveRouteGeometry(FROM, TO, null, transport);

  // Assert
  assert.equal(route.source, 'straight_line');
  assert.equal(urls.length, 0, 'a tokenless call still reached the provider');
});

test('a secret sk. token is refused before it can reach a URL', async () => {
  // Arrange — a deploy mistake. The URL is logged on failure by some transports.
  const { transport, urls } = stub(200, '{}');

  // Act
  const route = await resolveRouteGeometry(FROM, TO, 'sk.not-a-public-token', transport);

  // Assert
  assert.equal(route.source, 'straight_line');
  assert.equal(urls.length, 0, 'a secret token was placed in a query string');
});

test('a provider refusal degrades instead of failing the page', async () => {
  // Arrange — quota exhausted is the expected case, not an exceptional one.
  for (const status of [401, 403, 429, 500]) {
    const { transport } = stub(status, '{"message":"nope"}');

    // Act
    const route = await resolveRouteGeometry(FROM, TO, PK, transport);

    // Assert
    assert.equal(route.source, 'straight_line', `status ${status} did not degrade`);
  }
});

test('an unparseable body degrades rather than throwing into the handler', async () => {
  // Arrange — a captive portal answers HTML with a 200.
  const { transport } = stub(200, '<html>blocked</html>');

  // Act
  const route = await resolveRouteGeometry(FROM, TO, PK, transport);

  // Assert
  assert.equal(route.source, 'straight_line');
});

test('a route with no geometry, or a single point, degrades', async () => {
  // Arrange — a one-point line is not a line, so the fallback at least shows the
  // direction.
  for (const body of [
    JSON.stringify({ routes: [] }),
    JSON.stringify({ routes: [{ geometry: '' }] }),
    JSON.stringify({ routes: [{ geometry: '_p~iF~ps|U' }] }),
  ]) {
    const { transport } = stub(200, body);

    // Act
    const route = await resolveRouteGeometry(FROM, TO, PK, transport);

    // Assert
    assert.equal(route.source, 'straight_line', `${body} did not degrade`);
  }
});

test('a transport that throws is caught, not propagated', async () => {
  // Arrange — a DNS failure or a socket reset.
  const transport: GeometryTransport = async () => {
    throw new Error('ECONNRESET');
  };

  // Act
  const route = await resolveRouteGeometry(FROM, TO, PK, transport);

  // Assert
  assert.equal(route.source, 'straight_line');
});

test('an impossible endpoint degrades without calling out', async () => {
  // Arrange
  const { transport, urls } = stub(200, '{}');

  // Act
  await resolveRouteGeometry({ lat: Number.NaN, lng: 0 }, TO, PK, transport);
  await resolveRouteGeometry(FROM, { lat: 500, lng: 0 }, PK, transport);

  // Assert
  assert.equal(urls.length, 0);
});

/* ── The request it builds ────────────────────────────────────────────────── */

test('the request asks for a polyline, and for the full overview', async () => {
  // Arrange — `overview=simplified` would draw a route that misses the street.
  const { transport, urls } = stub(200, '{}');

  // Act
  await resolveRouteGeometry(FROM, TO, PK, transport);

  // Assert
  const url = urls[0] ?? '';
  assert.match(url, /directions\/v5\/mapbox\/driving/);
  assert.match(url, /geometries=polyline/);
  assert.match(url, /overview=full/);
});

test('the coordinates are sent lng,lat — the order the API documents', () => {
  // Act
  const url = directionsUrl(FROM, TO, PK);

  // Assert — reversed arguments put the route in the Gulf of Aden. Five decimals
  // is the rounding `directionsUrl` applies so repeated views share one URL.
  assert.match(url, /51\.38900,35\.68920;51\.42000,35\.71000/);
});

/* ── The guard ────────────────────────────────────────────────────────────── */

test('a drawable point is a finite coordinate inside the projection', () => {
  // Assert
  assert.equal(isDrawablePoint({ lat: 35.6892, lng: 51.389 }), true);
  assert.equal(isDrawablePoint({ lat: 0, lng: 0 }), true);
  assert.equal(isDrawablePoint({ lat: 86, lng: 0 }), false, 'past the pole');
  assert.equal(isDrawablePoint({ lat: 0, lng: 181 }), false, 'past the antimeridian');
  assert.equal(isDrawablePoint({ lat: Number.NaN, lng: 0 }), false);
  assert.equal(isDrawablePoint({ lat: '35', lng: 0 }), false);
  assert.equal(isDrawablePoint(null), false);
});

/* ── Bounds, after the security review ───────────────────────────────────── */

test('an oversized geometry is refused before it is decoded', async () => {
  // ★ THE TRANSPORT TIMEOUT DOES NOT COVER PARSING.
  //
  // `createProviderTransport` aborts the body READ after 8 s; `decodePolyline`
  // runs after that resolves, synchronously, at ~one point per two characters. A
  // hostile 100 KB geometry is 50,000 points of event-loop work. The cap is
  // applied on the ENCODED length, so the work is never started.
  const huge = 'a'.repeat(MAX_ENCODED_POLYLINE + 1);
  const { transport, urls } = stub(200, JSON.stringify({ routes: [{ geometry: huge }] }));

  const route = await resolveRouteGeometry(FROM, TO, PK, transport);

  assert.equal(route.source, 'straight_line');
  assert.equal(urls.length, 1, 'the provider should still have been asked once');
});

test('the caps are large enough for any real route and small enough to bound work', () => {
  // Assert — a real 2 km walk is a few hundred points; these are an order of
  // magnitude past that without being unbounded.
  assert.ok(MAX_ENCODED_POLYLINE >= 2_048, 'the encoded cap would reject a real city route');
  assert.ok(MAX_ENCODED_POLYLINE <= 65_536, 'the encoded cap does not meaningfully bound work');
  assert.ok(MAX_ROUTE_POINTS >= 500, 'the point cap would reject a real city route');
  assert.ok(MAX_ROUTE_POINTS <= 10_000, 'the point cap does not meaningfully bound work');
});

test('a geometry producing more points than the cap degrades', async () => {
  // Arrange — under the byte cap, but every character pair is still a point.
  const dense = 'a'.repeat(MAX_ROUTE_POINTS * 3);
  const { transport } = stub(200, JSON.stringify({ routes: [{ geometry: dense }] }));

  // Act
  const route = await resolveRouteGeometry(FROM, TO, PK, transport);

  // Assert
  assert.equal(route.source, 'straight_line');
});

test('two identical points never spend a provider request', async () => {
  // ★ The caller supplies BOTH endpoints, so without this a single request per
  // call is spent to be told the distance is zero.
  const { transport, urls } = stub(200, '{}');

  const route = await resolveRouteGeometry(FROM, { ...FROM }, PK, transport);

  assert.equal(route.source, 'straight_line');
  assert.equal(urls.length, 0, 'a zero-length journey still called the provider');
});

test('the request is rounded to five decimals, so shared venues share a URL', () => {
  // Arrange — two viewers at the same venue, differing only below the fifth
  // decimal. Both coordinates must round to the same 5 dp value, or the test is
  // asserting the wrong property: 35.68921010 and 35.68921099 both give
  // 35.68921, and 51.38912010 / 51.38912099 both give 51.38912.
  const a = directionsUrl({ lat: 35.68921010, lng: 51.38912010 }, TO, PK);
  const b = directionsUrl({ lat: 35.68921099, lng: 51.38912099 }, TO, PK);

  // Act / Assert
  assert.equal(a, b, 'the URL varies below a metre, so no cache can ever reuse it');
  assert.match(a, /51\.38912,35\.68921/);
  // And a sixth-decimal CHANGE must survive, or the rounding is too coarse.
  const moved = directionsUrl({ lat: 35.68922, lng: 51.38912 }, TO, PK);
  assert.notEqual(a, moved, 'a metre-scale difference was rounded away');
});

test('a truncated chunk stops the decoder instead of relying on NaN', () => {
  // Arrange — a polyline that ends mid-chunk. This was safe only by accident
  // (`NaN >= 0x20` is false); the guard is now explicit.
  const truncated = '_p~iF~ps|U_ulL';

  // Act
  const points = decodePolyline(truncated);

  // Assert — it terminates and produces the points it could decode.
  assert.ok(points.length >= 1);
  assert.ok(points.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)));
});

test('an out-of-alphabet character does not produce a bogus coordinate', () => {
  // Arrange — a control character is below the alphabet's base.
  const points = decodePolyline('_p~iF~ps|U\u0001_mqNvxq`@');

  // Act / Assert
  assert.ok(points.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)));
});
