/**
 * Place search works without a paid search key, and an empty answer is not an outage.
 *
 * ★ THE REPORTED DEFECT: "THE MAP SEARCH IS NOT WORKING ON APP OR WEB — IT RETURNS NO
 * RESULT ON EVERYTHING."
 *
 * The cause was not the client, the debounce, or the map. `/api/place-search` had one
 * provider, and the deployment's Neshan key is a DIRECTIONS key. Against Neshan's
 * search service that answers:
 *
 *   {"status":"ERROR","code":485,"message":"Api Key services not match."}
 *
 * The route mapped every non-200 to `degraded: true`, so the sheet showed "search is
 * unavailable" for every query in both languages — and the real cause was invisible
 * without a request against the provider itself.
 *
 * ★ SO THE LADDER IS WHAT IS TESTED HERE, NOT THE PROVIDER.
 *
 * Two properties, both unobservable against a live service whose answers change daily:
 *
 *  1. an unusable key falls THROUGH to the keyless rung instead of ending the search;
 *  2. a provider that answers with nothing is reported as "no match", not as an
 *     outage — the distinction that made the bug above take a provider request to find.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromNominatim, searchPlaces, toResult, type SearchTransport } from '@/server/routes/place-search';

const NESHAN_485 = JSON.stringify({
  status: 'ERROR',
  code: 485,
  message: 'Api Key services not match.',
});

/** A canned answer for one host, and a record of what was asked. */
interface Stub {
  transport: SearchTransport;
  urls: string[];
}

function stub(routes: Record<string, { status: number; body: string }>): Stub {
  const urls: string[] = [];

  const transport: SearchTransport = async (url) => {
    urls.push(url);
    const host = new URL(url).host;
    const answer = routes[host] ?? { status: 500, body: '' };
    return { status: answer.status, body: answer.body };
  };

  return { transport, urls };
}

function search(query = 'کافه', transport: SearchTransport, bias = '&lat=35.7&lng=51.4') {
  const request = new Request(`https://example.test/api/place-search?q=${encodeURIComponent(query)}${bias}`);
  return searchPlaces(request, transport);
}

const NESHAN_HOST = 'api.neshan.org';
const NOMINATIM_HOST = 'nominatim.openstreetmap.org';

const NESHAN_HIT = JSON.stringify({
  items: [
    {
      title: 'کافه نادری',
      address: 'خیابان جمهوری',
      neighbourhood: 'فردوسی',
      region: 'تهران',
      categories: ['cafe'],
      location: { x: 51.4168, y: 35.6947 },
    },
  ],
});

const NOMINATIM_HIT = JSON.stringify([
  {
    place_id: 211507194,
    lat: '35.6947164',
    lon: '51.4168176',
    category: 'amenity',
    type: 'cafe',
    display_name: 'کافه نادری, جمهوری اسلامی, فردوسی, تهران, ایران',
  },
]);

/** A key, so the first rung is actually attempted. */
function withNeshanKey<T>(run: () => Promise<T>): Promise<T> {
  const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;
  const previous = env.NESHAN_API_KEY;
  env.NESHAN_API_KEY = 'service.test-key';
  return run().finally(() => {
    if (previous === undefined) delete env.NESHAN_API_KEY;
    else env.NESHAN_API_KEY = previous;
  });
}

/* ── The ladder ───────────────────────────────────────────────────────────── */

test('an unusable Neshan key falls through to the keyless rung instead of ending the search', () =>
  withNeshanKey(async () => {
    // Arrange — exactly the deployment's answer.
    const { transport, urls } = stub({
      [NESHAN_HOST]: { status: 403, body: NESHAN_485 },
      [NOMINATIM_HOST]: { status: 200, body: NOMINATIM_HIT },
    });

    // Act
    const response = await search('کافه', transport);
    const body = (await response.json()) as { results: unknown[]; degraded: boolean };

    // Assert — both rungs were asked, and the answer is real results.
    assert.equal(urls.length, 2, 'the ladder stopped after a refused key');
    assert.ok(urls[1]?.includes(NOMINATIM_HOST), 'the keyless rung was never asked');
    assert.equal(body.degraded, false, 'a working keyless rung still reported an outage');
    assert.equal(body.results.length, 1);
  }));

test('with no search key at all, search still works', async () => {
  // Arrange — the default deployment state. `providerKey` falls back to
  // NESHAN_API_KEY, which `setToken`-less runs do not have.
  const { transport, urls } = stub({
    [NOMINATIM_HOST]: { status: 200, body: NOMINATIM_HIT },
  });

  // Act
  const response = await search('کافه', transport);
  const body = (await response.json()) as { results: unknown[]; degraded: boolean };

  // Assert — one rung asked, real results.
  assert.equal(urls.length, 1);
  assert.ok(urls[0]?.includes(NOMINATIM_HOST));
  assert.equal(body.degraded, false);
  assert.equal(body.results.length, 1);
});

test('a Neshan key that works is preferred, and the keyless rung is never asked', () =>
  withNeshanKey(async () => {
    // Arrange
    const { transport, urls } = stub({
      [NESHAN_HOST]: { status: 200, body: NESHAN_HIT },
      [NOMINATIM_HOST]: { status: 200, body: NOMINATIM_HIT },
    });

    // Act
    const response = await search('کافه', transport);
    const body = (await response.json()) as {
      results: Array<{ name: string; lat: number; lng: number }>;
      degraded: boolean;
    };

    // Assert — one request, and the coordinates are the right way round.
    assert.equal(urls.length, 1, 'the ladder asked a second provider after a good answer');
    assert.equal(body.results[0]?.name, 'کافه نادری');
    assert.equal(body.results[0]?.lat, 35.6947);
    assert.equal(body.results[0]?.lng, 51.4168);
  }));

test('nobody could be asked is the only degraded answer', async () => {
  // Arrange — both rungs refuse.
  const { transport } = stub({
    [NESHAN_HOST]: { status: 403, body: NESHAN_485 },
    [NOMINATIM_HOST]: { status: 403, body: 'blocked' },
  });

  // Act
  const response = await search('کافه', transport);
  const body = (await response.json()) as { results: unknown[]; degraded: boolean };

  // Assert — this is the state that offers the custom pin.
  assert.deepEqual(body.results, []);
  assert.equal(body.degraded, true, 'two refused rungs did not report degraded');
});

test('a provider that answers with nothing is a no-match, not an outage', async () => {
  // Arrange ★ THIS IS THE DISTINCTION THAT HID THE BUG.
  //
  // "Neshan searched and found nothing" and "Neshan refused the key" both used to
  // arrive as `degraded`, so a misspelled street read as broken search — and so did
  // the deployment's real cause.
  const { transport } = stub({
    [NOMINATIM_HOST]: { status: 200, body: '[]' },
  });

  // Act
  const response = await search('zzzz-nothing', transport);
  const body = (await response.json()) as { results: unknown[]; degraded: boolean };

  // Assert
  assert.deepEqual(body.results, []);
  assert.equal(body.degraded, false, 'an empty answer was reported as an outage');
});

test('a successful empty answer stops the ladder', () =>
  withNeshanKey(async () => {
    // Arrange — the stronger provider searched and found nothing.
    const { transport, urls } = stub({
      [NESHAN_HOST]: { status: 200, body: JSON.stringify({ items: [] }) },
      [NOMINATIM_HOST]: { status: 200, body: NOMINATIM_HIT },
    });

    // Act
    const response = await search('zzzz-nothing', transport);
    const body = (await response.json()) as { results: unknown[]; degraded: boolean };

    // Assert — a second provider contradicting an answer is not a better answer.
    assert.equal(urls.length, 1, 'the ladder overrode a provider that had answered');
    assert.deepEqual(body.results, []);
    assert.equal(body.degraded, false);
  }));

test('a query shorter than two characters never reaches a provider', async () => {
  // Arrange
  const { transport, urls } = stub({
    [NOMINATIM_HOST]: { status: 200, body: NOMINATIM_HIT },
  });

  // Act
  const response = await search('ک', transport);
  const body = (await response.json()) as { results: unknown[]; degraded: boolean };

  // Assert
  assert.deepEqual(urls, []);
  assert.deepEqual(body.results, []);
  assert.equal(body.degraded, false);
});

/* ── The parsers ──────────────────────────────────────────────────────────── */

test('Nominatim’s display name becomes a name and an address', () => {
  // Arrange — `display_name` is the whole address, and a one-line result row that
  // holds a street, a city and a country clips the only word that matters.
  const result = fromNominatim({
    place_id: 1,
    lat: '35.6947164',
    lon: '51.4168176',
    class: 'amenity',
    type: 'cafe',
    display_name: 'کافه نادری, خیابان جمهوری, تهران, ایران',
  });

  // Assert
  assert.ok(result);
  assert.equal(result.name, 'کافه نادری');
  assert.equal(result.address, 'خیابان جمهوری, تهران, ایران');
  assert.equal(result.lat, 35.6947164);
  assert.equal(result.lng, 51.4168176);
  assert.equal(result.category, 'amenity:cafe');
});

test('a Nominatim entry with no usable coordinates is dropped, not pinned at zero', () => {
  // Assert — a place at (0, 0) is in the Atlantic, and it would rank as a real option.
  assert.equal(fromNominatim({ place_id: 2, display_name: 'x', lat: 'x', lon: '51' }), null);
  assert.equal(fromNominatim({ place_id: 3, display_name: '', lat: '35', lon: '51' }), null);
});

test('Neshan’s x is longitude and its y is latitude', () => {
  // ★ SWAPPING THESE PUTS EVERY RESULT IN THE OCEAN OFF SOMALIA, and a test that only
  // checks the title would never notice. Asserted on a result the fixture pins to
  // Tehran.
  const result = toResult({ title: 'کافه نادری', location: { x: 51.4168, y: 35.6947 } });

  // Assert
  assert.ok(result);
  assert.equal(result.lat, 35.6947);
  assert.equal(result.lng, 51.4168);
});
