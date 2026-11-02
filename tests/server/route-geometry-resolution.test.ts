/**
 * The route line follows a street, or admits that it does not.
 *
 * ★ THE REPORT.
 *
 * "The routing line that connects the user's location to the proposed location is
 * not accurate — it looks like simple polygon lines drawn on the streets, not
 * actual routing data from MapBox displayed on the map and streets. It is also a
 * simple straight line on short distances even though there are still streets and
 * paths."
 *
 * ★ WHAT WAS MEASURED FIRST, AND WHY THAT MATTERS.
 *
 * The live deployment already answered with MapBox geometry:
 *
 *     ?from=35.7000,51.4000&to=35.7100,51.4100 → source=mapbox, 2859 m, 11 points
 *     ?from=35.7000,51.4000&to=35.7003,51.4004 → source=mapbox,  784 m,  8 points
 *
 * So "the server returns a straight line" was never the defect, and a fix aimed
 * there would have changed nothing. The two real defects were:
 *
 *  1. **A refusal drawn as a road.** The client overrode every line to
 *     `dashed: false`, so a `straight_line` fallback — the honest answer to a
 *     provider that would not resolve — was drawn as a solid route. A short
 *     distance is where a refusal is most likely, which is why the report pairs
 *     the two complaints: "a simple straight line on short distances".
 *
 *  2. **A refusal CAUSED by the endpoint rounding.** `directionsUrl` rounded each
 *     endpoint to five decimals (~1.1 m) so two viewers at one venue would share a
 *     URL. Two distinct endpoints a couple of metres apart — a pin and a doorway in
 *     the same block — rounded onto the same pair, so the provider was asked for a
 *     zero-length leg, answered with a one-point geometry, the decoder rejected it,
 *     and the map drew the fallback. The rounding is kept for cache identity (it is
 *     a real saving) and broken apart only when it actually collides.
 *
 * ★ AND ONE WRONG TURN, RECORDED HERE SO IT IS NOT REPEATED.
 *
 * The first version of this fix asked for `geometries=polyline6`, on the belief
 * that five decimals were flattening the curve. Directions does not accept that
 * value — it accepts `geojson` or `polyline` — and an unrecognised value is
 * silently ignored. The provider kept answering at precision 5 and the decoder read
 * it as precision 6, which divides every coordinate by ten: Tehran's route came
 * back at (5.14, 3.57), in the Gulf of Guinea. These tests passed throughout,
 * because they encoded their fixtures at the same precision they decoded with. Only
 * a probe against the real service found it. The precision is therefore pinned to
 * the request that produced it, below, and there is a local assertion that the two
 * agree.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  GEOMETRY_PRECISION,
  MAX_ENCODED_POLYLINE,
  decodePolyline,
  directionsUrl,
  resolveRouteGeometry,
  type GeometryTransport,
} from '@/server/routes/route-geometry';

const PK = 'pk.eyJ1IjoiZml4dHVyZSJ9.c2lnbmF0dXJl';
const FROM = { lat: 35.6892, lng: 51.389 };
const TO = { lat: 35.71, lng: 51.42 };

/** Google's polyline encoder, so a fixture can be produced at any precision. */
function encodePolyline(points: Array<[number, number]>, precision = 5): string {
  const factor = 10 ** precision;

  const encodeDelta = (delta: number): string => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    let out = '';
    while (value >= 0x20) {
      out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    return out + String.fromCharCode(value + 63);
  };

  let lastLat = 0;
  let lastLng = 0;
  let out = '';

  for (const [lng, lat] of points) {
    const latE5 = Math.round(lat * factor);
    const lngE5 = Math.round(lng * factor);
    out += encodeDelta(latE5 - lastLat) + encodeDelta(lngE5 - lastLng);
    lastLat = latE5;
    lastLng = lngE5;
  }

  return out;
}

function transport(status: number, body: string, urls: string[] = []): GeometryTransport {
  return async (url) => {
    urls.push(url);
    return { status, body };
  };
}

/* ── 1. The precision the request makes and the decoder reads must agree ──── */

test('the request asks for a format Directions actually offers', () => {
  // ★ `polyline6` IS NOT A DIRECTIONS VALUE, AND ASKING FOR IT WAS A LIVE OUTAGE.
  //
  // Directions accepts `geojson` or `polyline`. Anything else is IGNORED rather
  // than rejected, so the request looked fine and the answer came back at the
  // default precision — which the decoder was then told to read at six decimals.
  const url = directionsUrl(FROM, TO, PK);
  const geometries = new URL(url).searchParams.get('geometries');

  assert.ok(
    geometries === 'polyline' || geometries === 'geojson',
    `Directions does not accept geometries=${geometries}`,
  );
  assert.match(url, /overview=full/, 'the request no longer asks for the full shape');
});

test('the decoder reads exactly the precision the request produces', () => {
  // ★ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT THE 10× COORDINATE BUG.
  //
  // A `polyline` answer is precision 5; a `geojson` answer is not a polyline at
  // all. The decoder's precision must be the one the requested format encodes at,
  // or every coordinate is scaled by a power of ten.
  const url = directionsUrl(FROM, TO, PK);
  const geometries = new URL(url).searchParams.get('geometries');

  const expected = geometries === 'polyline' ? 5 : null;
  if (expected !== null) {
    assert.equal(
      GEOMETRY_PRECISION,
      expected,
      `geometries=${geometries} encodes at ${expected} decimals but the decoder reads ${GEOMETRY_PRECISION}`,
    );
  }
});

test('a precision-5 polyline round-trips onto the coordinates it encodes', () => {
  // Arrange — a real Tehran leg, encoded the way the provider encodes it.
  const points: Array<[number, number]> = [
    [51.4, 35.70013],
    [51.40037, 35.70014],
    [51.40023, 35.69933],
    [51.39811, 35.69929],
  ];

  // Act
  const decoded = decodePolyline(encodePolyline(points, 5), GEOMETRY_PRECISION);

  // Assert — within half a grid cell (~5 m at this latitude) of the input, and
  // emphatically not a tenth of it.
  for (let index = 0; index < points.length; index += 1) {
    const expected = points[index]!;
    const actual = decoded[index]!;
    assert.ok(
      Math.abs(actual[0] - expected[0]) < 1e-4,
      `vertex ${index} longitude drifted: ${actual[0]} vs ${expected[0]}`,
    );
    assert.ok(
      Math.abs(actual[1] - expected[1]) < 1e-4,
      `vertex ${index} latitude drifted: ${actual[1]} vs ${expected[1]}`,
    );
  }
});

test('a Tehran route never decodes into the Gulf of Guinea', () => {
  // ★ THE EXACT SHAPE OF THE SHIPPED BUG, AS A REGRESSION GUARD.
  //
  // Decoding precision-5 geometry at 6 divides every coordinate by ten: 51.4
  // becomes 5.14 and 35.7 becomes 3.57, which are real coordinates — off the coast
  // of Africa. The check is coarse on purpose: it does not care what the route is,
  // only that it is in the city it was asked about.
  const points: Array<[number, number]> = [
    [51.4, 35.70013],
    [51.400263, 35.70016],
  ];
  const decoded = decodePolyline(encodePolyline(points, 5), GEOMETRY_PRECISION);

  for (const [lng, lat] of decoded) {
    assert.ok(lng > 50 && lng < 53, `longitude ${lng} is not in Tehran`);
    assert.ok(lat > 34 && lat < 37, `latitude ${lat} is not in Tehran`);
  }
});

test('the encoded ceiling still refuses an oversized payload', () => {
  // ★ THE DECODER IS UNBOUNDED CPU AND A PROVIDER BODY IS UNTRUSTED INPUT.
  //
  // The transport timeout aborts the body READ; parsing happens after that
  // resolves, synchronously, at about one point per two characters. The cap is
  // applied on the ENCODED length so the work is never started.
  assert.ok(MAX_ENCODED_POLYLINE >= 8_192, 'the ceiling was lowered below a real answer');
  assert.ok(MAX_ENCODED_POLYLINE <= 65_536, 'the ceiling no longer bounds the work');

  const points: Array<[number, number]> = [];
  for (let step = 0; step < 1_500; step += 1) {
    points.push([51.389 + step * 0.0004, 35.6892 + step * 0.0003]);
  }
  assert.ok(
    encodePolyline(points, 5).length < MAX_ENCODED_POLYLINE,
    'a realistic city route no longer fits under the ceiling',
  );
});

test('a real provider answer is decoded as a mapbox route', async () => {
  // Arrange — the provider answering the way it actually answers: precision 5.
  const points: Array<[number, number]> = [
    [51.389, 35.6892],
    [51.38915, 35.68944],
    [51.38962, 35.68961],
    [51.39001, 35.68979],
  ];
  const body = JSON.stringify({
    routes: [{ geometry: encodePolyline(points, 5), distance: 142 }],
  });

  // Act
  const geometry = await resolveRouteGeometry(FROM, TO, PK, transport(200, body));

  // Assert
  assert.equal(geometry.source, 'mapbox');
  assert.equal(geometry.points.length, 4);
  assert.ok(geometry.points[0]![0] > 50, 'the decoded route left the city');
});

/* ── 2. A short distance is still a request ───────────────────────────────── */

test('two points a few metres apart are still sent to the provider', () => {
  // ★ THE SHORT-DISTANCE COMPLAINT IS NOT ABOUT THE PROVIDER HAVING NO ROADS.
  //
  // `resolveRouteGeometry` short-circuits when the two endpoints are EQUAL, which
  // is correct. The defect was one layer down: `directionsUrl` rounded each
  // endpoint to five decimals before building the URL, and two points 3 m apart
  // could round onto the same pair — so the provider was asked for a zero-length
  // leg and answered with a one-point geometry the decoder rejects, which becomes
  // the straight line. The rounding is for cache reuse; it must not make two
  // distinct endpoints identical.
  const from = { lat: 35.6892, lng: 51.389 };
  const to = { lat: 35.689227, lng: 51.389031 };

  const url = directionsUrl(from, to, PK);
  const coordinates = /directions\/v5\/[^/]+\/([^?]+)/.exec(url)?.[1] ?? '';
  const [first, second] = coordinates.split(';');

  assert.ok(first && second, 'the URL does not carry two endpoints');
  assert.notEqual(first, second, 'two distinct endpoints were rounded onto each other');
});

test('a genuinely zero-length journey is not sent at all', async () => {
  // The one case that SHOULD short-circuit, kept: an attacker otherwise spends a
  // metered Directions call per request to be told the distance is zero.
  const urls: string[] = [];
  const geometry = await resolveRouteGeometry(FROM, { ...FROM }, PK, transport(200, '{}', urls));

  assert.equal(geometry.source, 'straight_line');
  assert.equal(urls.length, 0, 'a zero-length route still spent a provider call');
});

test('two viewers at one venue still share a cache key', () => {
  // The rounding's actual purpose, which the fix must not throw away.
  const a = directionsUrl({ lat: 35.68921010, lng: 51.38912010 }, TO, PK);
  const b = directionsUrl({ lat: 35.68921099, lng: 51.38912099 }, TO, PK);

  assert.equal(a, b, 'the URL varies below a metre, so no cache can reuse it');
});

/* ── 3. A refusal is not drawn as a road ──────────────────────────────────── */

test('a refused request reports a straight line, which the client can dash', async () => {
  // Arrange — the provider refusing (quota, coverage, a token problem).
  const geometry = await resolveRouteGeometry(FROM, TO, PK, transport(422, '{"message":"no route"}'));

  // Assert — the source is the ONLY signal the drawing has for "this is not a
  // street", so it has to be set honestly.
  assert.equal(geometry.source, 'straight_line');
  assert.equal(geometry.points.length, 2);
});

function code(path: string): string {
  return readFileSync(path, 'utf8');
}

const EVENT_MAP = code('src/features/venues/components/EventRouteMap.tsx');
const PROPOSAL_MAP = code('src/features/proposals/components/ProposalRouteMap.tsx');

test('the event map dashes exactly the lines that are not roads', () => {
  // ★ THE OVERRIDE IS WHAT MADE A REFUSAL LOOK LIKE A ROUTE.
  //
  // `EventRouteMap` set `dashed: false` on every line, with a comment claiming the
  // request wanted a route rather than a direction. But a straight line between
  // two points is not a route — it is the direction the provider would not
  // resolve — and drawing it solid told the reader a road existed where none had
  // been asked for.
  assert.match(
    EVENT_MAP,
    /dashed:\s*geometry\.source === 'straight_line'/,
    'the event map no longer dashes a fallback',
  );
  assert.doesNotMatch(
    EVENT_MAP,
    /^\s*dashed:\s*false,\s*$/m,
    'the event map still forces every line solid',
  );
});

test('the proposal card dashes exactly the lines that are not roads', () => {
  assert.match(
    PROPOSAL_MAP,
    /dashed:\s*route\.source === 'straight_line'/,
    'the proposal card no longer dashes a fallback',
  );
  assert.doesNotMatch(
    PROPOSAL_MAP,
    /^\s*dashed:\s*false,\s*$/m,
    'the proposal card still forces every line solid',
  );
});

test('the renderers can actually draw a dash pattern as data', () => {
  // ★ A `case` BRANCH OF A BARE ARRAY IS READ AS AN EXPRESSION.
  //
  // The route layer once refused to compile because of it, which silently made
  // every line solid — the exact symptom that would make this whole fix invisible.
  for (const path of [
    'src/components/ui/InteractiveMap.web.tsx',
    'src/components/ui/InteractiveMap.native.tsx',
  ]) {
    assert.match(
      code(path),
      /\['literal', \[2, 2\]\]/,
      `${path} does not wrap its dash pattern as data`,
    );
  }
});
