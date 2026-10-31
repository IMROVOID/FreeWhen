/**
 * Real road geometry, and two providers so there is one in this country.
 *
 * ★ THE REPORT: "THE ROUTING LINES ARE JUST STRAIGHT DASHED LINES".
 *
 * They were straight because every call to the geometry proxy answered
 * `source: 'straight_line'`. Two independent reasons:
 *
 *  1. The deployment's MapBox token is refused (`403`), so the only provider the
 *     endpoint knew about could never answer;
 *  2. MapBox's driving profile has thin coverage in Iran in any case, which is why
 *     the travel-TIME ladder in this codebase does not use it either.
 *
 * So the resolver gains a second rung — the Iranian provider this product already
 * pays for, whose direction endpoint returns a polyline — and the straight line
 * stays the terminal fallback rather than the normal answer.
 *
 * ★ AND THE DECODER IS THE THING THAT CAN SILENTLY BE WRONG.
 *
 * A polyline decoder that is off by one, or that swaps lat and lng, produces a
 * plausible line in the wrong place. It is asserted against a known-good encoding
 * below.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  decodePolyline,
  resolveRouteGeometry,
  straightLineRoute,
  type GeometryTransport,
} from '@/server/routes/route-geometry';
import { routeGeometryHandler } from '@/server/routes/route-geometry-http';

const TEHRAN = { lat: 35.6892, lng: 51.389 };
const VANAK = { lat: 35.7575, lng: 51.4105 };

/** A transport that answers one canned body for every URL. */
function stub(status: number, body: unknown): GeometryTransport & { calls: string[] } {
  const calls: string[] = [];
  const transport = (async (url: string) => {
    calls.push(url);
    return { status, body: JSON.stringify(body) };
  }) as GeometryTransport & { calls: string[] };
  transport.calls = calls;
  return transport;
}

/**
 * Google's own documented example, spelled in code points.
 *
 * ★ IT CONTAINS A BACKTICK, WHICH A QUOTED SOURCE STRING CANNOT CARRY UNESCAPED.
 *
 * `_p~iF~ps|U_ulLnnqC_mqNvxq`@` is the encoder's reference output for the three
 * points asserted below, and the backtick before the final `@` encodes that group's
 * continuation bit. Writing it literally is a syntax error in a template string and
 * gets mangled by editors and patch tools, so the example is spelled as code points
 * and cannot be silently corrupted.
 */
const ENCODED = String.fromCharCode(
  95, 112, 126, 105, 70, 126, 112, 115, 124, 85, 95, 117, 108, 76, 110, 110, 113, 67, 95, 109, 113,
  78, 118, 120, 113, 96, 64,
);

/* ── The decoder ──────────────────────────────────────────────────────────── */

test('the polyline decoder reverses the documented encoding', () => {
  // Arrange — Google's own example, which decodes to three points.
  const points = decodePolyline(ENCODED);

  // Assert — longitude first, as GeoJSON has it.
  assert.equal(points.length, 3);
  assert.deepEqual(points[0], [-120.2, 38.5]);
  assert.deepEqual(points[1], [-120.95, 40.7]);
  assert.deepEqual(points[2], [-126.453, 43.252]);
});

test('a truncated polyline stops instead of emitting NaN', () => {
  // Arrange — the last chunk claims a continuation that is not there.
  const points = decodePolyline('_p~iF~ps|U_ulL');

  // Assert
  assert.ok(points.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)));
});

/* ── The providers ────────────────────────────────────────────────────────── */

test('MapBox answers, so no second provider is asked', async () => {
  // Arrange
  const transport = stub(200, { routes: [{ geometry: ENCODED, distance: 1200 }] });

  // Act
  const geometry = await resolveRouteGeometry(TEHRAN, VANAK, 'pk.test', transport, {
    neshanKey: 'service.key',
  });

  // Assert
  assert.equal(geometry.source, 'mapbox');
  assert.equal(geometry.points.length, 3);
  assert.equal(transport.calls.length, 1, 'a working first provider was not enough');
});

test('a refused MapBox token falls through to the second provider', async () => {
  // Arrange — the deployment's actual state: MapBox answers 403.
  const transport = stub(403, { message: 'Not Authorized' });
  const originalFetch = globalThis.fetch;
  let neshanCalled = false;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    neshanCalled = true;
    assert.match(String(input), /api\.neshan\.org\/v4\/direction/);
    return new Response(
      JSON.stringify({
        routes: [{ overview_polyline: { points: ENCODED }, legs: [{ distance: { value: 1400 } }] }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    // Act
    const geometry = await resolveRouteGeometry(TEHRAN, VANAK, 'pk.test', transport, {
      neshanKey: 'service.key',
    });

    // Assert
    assert.equal(neshanCalled, true, 'MapBox refused and nothing else was tried');
    assert.equal(geometry.source, 'mapbox');
    assert.equal(geometry.points.length, 3);
    assert.equal(geometry.distanceMetres, 1400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('with both providers refusing, the straight line is the last word', async () => {
  // Arrange
  const transport = stub(403, {});
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;

  try {
    // Act
    const geometry = await resolveRouteGeometry(TEHRAN, VANAK, 'pk.test', transport, {
      neshanKey: 'service.key',
    });

    // Assert
    assert.equal(geometry.source, 'straight_line');
    assert.deepEqual(geometry.points, [
      [TEHRAN.lng, TEHRAN.lat],
      [VANAK.lng, VANAK.lat],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('no second key configured means no second attempt', async () => {
  // Arrange
  const transport = stub(403, {});
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // Act
    const geometry = await resolveRouteGeometry(TEHRAN, VANAK, 'pk.test', transport);

    // Assert — an unconfigured provider is skipped, not probed.
    assert.equal(called, false);
    assert.equal(geometry.source, 'straight_line');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('two identical points cost nothing, as before', async () => {
  // Assert — the abuse guard survives the second rung.
  const transport = stub(200, { routes: [{ geometry: ENCODED }] });
  const geometry = await resolveRouteGeometry(TEHRAN, TEHRAN, 'pk.test', transport, {
    neshanKey: 'service.key',
  });

  assert.equal(geometry.source, 'straight_line');
  assert.equal(transport.calls.length, 0);
  assert.deepEqual(geometry, straightLineRoute(TEHRAN, TEHRAN));
});

test('the Neshan key travels in a header, never in the URL', async () => {
  // Arrange — a key in a query string lands in every proxy and access log.
  const transport = stub(403, {});
  const originalFetch = globalThis.fetch;
  let seen: { url: string; key: string | null } = { url: '', key: null };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen = { url: String(input), key: headers.get('api-key') };
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try {
    // Act
    await resolveRouteGeometry(TEHRAN, VANAK, 'pk.test', transport, { neshanKey: 'secret-value' });

    // Assert
    assert.equal(seen.key, 'secret-value');
    assert.doesNotMatch(seen.url, /secret-value/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ── The handler wires them ───────────────────────────────────────────────── */

test('the HTTP handler passes the second provider through', () => {
  // Assert — a resolver that supports a fallback nobody hands a key to is dead code.
  const handler = readFileSync('server/routes/route-geometry-http.ts', 'utf8');
  assert.match(handler, /neshanKey: providerKey\('neshan_direction'\)/);
  assert.match(handler, /readMapboxPublicToken\(\)/);
  assert.equal(typeof routeGeometryHandler, 'function');
});
