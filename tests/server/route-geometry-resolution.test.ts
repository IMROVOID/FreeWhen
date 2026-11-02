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
 * The live deployment already answers with MapBox geometry:
 *
 *     ?from=35.7000,51.4000&to=35.7100,51.4100 → source=mapbox, 2864 m, 12 points
 *     ?from=35.7000,51.4000&to=35.7003,51.4004 → source=mapbox,  784 m,  8 points
 *
 * So "the server returns a straight line" is NOT the defect, and a fix aimed there
 * would have changed nothing. Two narrow, real defects sit either side of it:
 *
 *  1. **Vertex resolution.** Eight vertices cannot describe a 784 m drive around a
 *     block, and MapBox GL draws straight segments between vertices with no map
 *     matching — so the line cuts across the buildings the street bends around.
 *     That is exactly what "polygon lines drawn on the streets" describes. The
 *     provider will answer at higher precision; the request did not ask for it.
 *
 *  2. **A refusal drawn as a road.** The client overrode every line to
 *     `dashed: false`, so a `straight_line` fallback — the honest answer to a
 *     provider that would not resolve — was drawn as a solid route. A short
 *     distance is where a refusal is most likely (MapBox has no drive network for
 *     a 3 m hop across a footpath), which is why the report pairs the two
 *     complaints: "a simple straight line on short distances".
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
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

/* ── 1. Vertex resolution ─────────────────────────────────────────────────── */

test('the request asks for the geometry precision the map can draw', () => {
  // ★ SIX DECIMALS IS ~11 cm; FIVE IS ~1.1 m.
  //
  // At five decimals a dense city route quantises its vertices onto a 1.1 m grid,
  // which is invisible. The reason to ask for six is that it lets the provider
  // return the FULL vertex list without the encoder rounding adjacent points onto
  // each other and collapsing them — the "polygon lines drawn on the streets"
  // report. `polyline6` is MapBox's documented higher-resolution format and is a
  // plain query parameter.
  const url = directionsUrl(FROM, TO, PK);

  assert.match(url, /geometries=polyline6/, 'the request still asks for the coarse polyline');
  assert.match(url, /overview=full/, 'the request no longer asks for the full shape');
});

test('a six-decimal polyline survives the round trip to under a centimetre', () => {
  // Arrange — two vertices 0.11 m apart, which five decimals cannot tell apart.
  const points: Array<[number, number]> = [
    [51.389, 35.6892],
    [51.389001, 35.689201],
    [51.389002, 35.689199],
  ];

  // Act
  const decoded = decodePolyline(encodePolyline(points, 6), 6);

  // Assert
  assert.equal(decoded.length, points.length);

  for (let index = 0; index < points.length; index += 1) {
    const expected = points[index]!;
    const actual = decoded[index]!;
    assert.ok(
      Math.abs(actual[0] - expected[0]) < 1e-6,
      `vertex ${index} longitude drifted: ${actual[0]} vs ${expected[0]}`,
    );
    assert.ok(
      Math.abs(actual[1] - expected[1]) < 1e-6,
      `vertex ${index} latitude drifted: ${actual[1]} vs ${expected[1]}`,
    );
  }
});

test('a dense route keeps every vertex instead of collapsing them', () => {
  // Arrange — a 400-vertex city route at six decimals. At five decimals adjacent
  // vertices quantise onto the same grid point and the shape flattens into the
  // "polygon lines" the report describes.
  const points: Array<[number, number]> = [];
  for (let step = 0; step < 400; step += 1) {
    points.push([51.389 + step * 0.000004, 35.6892 + step * 0.000003]);
  }

  // Act
  const encoded = encodePolyline(points, 6);
  const decoded = decodePolyline(encoded, 6);

  // Assert
  assert.equal(decoded.length, 400, 'vertices were lost in the round trip');
  assert.equal(
    new Set(decoded.map((point) => `${point[0]},${point[1]}`)).size,
    400,
    'distinct vertices collapsed onto one another',
  );
});

test('the encoded ceiling still refuses an oversized payload', () => {
  // ★ THE DECODER IS UNBOUNDED CPU AND A PROVIDER BODY IS UNTRUSTED INPUT.
  //
  // Six decimals produce longer encodings than five, so the ceiling has to be
  // re-justified rather than raised blindly: a real city route stays well under it.
  assert.ok(MAX_ENCODED_POLYLINE >= 8_192, 'the ceiling was lowered below a real answer');
  assert.ok(MAX_ENCODED_POLYLINE <= 65_536, 'the ceiling no longer bounds the CPU a caller can spend');

  const points: Array<[number, number]> = [];
  for (let step = 0; step < 1_500; step += 1) {
    points.push([51.389 + step * 0.000004, 35.6892 + step * 0.000003]);
  }
  assert.ok(
    encodePolyline(points, 6).length < MAX_ENCODED_POLYLINE,
    'a realistic city route no longer fits under the ceiling',
  );
});

test('a six-decimal answer is decoded as a mapbox route', async () => {
  // Arrange — the provider answering in the format the request now asks for.
  const points: Array<[number, number]> = [
    [51.389, 35.6892],
    [51.38915, 35.68944],
    [51.38962, 35.68961],
    [51.39001, 35.68979],
  ];
  const body = JSON.stringify({
    routes: [{ geometry: encodePolyline(points, 6), distance: 142 }],
  });

  // Act
  const geometry = await resolveRouteGeometry(FROM, TO, PK, transport(200, body));

  // Assert
  assert.equal(geometry.source, 'mapbox');
  assert.equal(geometry.points.length, 4);
});

/* ── 2. A short distance is still a request ───────────────────────────────── */

test('two points a few metres apart are still sent to the provider', () => {
  // ★ THE SHORT-DISTANCE COMPLAINT IS NOT ABOUT THE PROVIDER HAVING NO ROADS.
  //
  // `resolveRouteGeometry` short-circuits when the two endpoints are EQUAL, which
  // is correct. The defect was one layer down: `directionsUrl` rounds each
  // endpoint to five decimals before building the URL, and at five decimals two
  // points 3 m apart can round onto the same pair — so the provider was asked for
  // a zero-length leg and answered with a one-point geometry, which the decoder
  // rejects, which becomes the straight line. The rounding is for cache reuse; it
  // must not make two distinct endpoints identical.
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
