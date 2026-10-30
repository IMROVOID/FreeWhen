/**
 * The map layer's testable core (Plan 08 Task 7, 8).
 *
 * ★ THE PRIVACY ASSERTIONS ARE THE POINT OF MOST OF THIS FILE.
 *
 * AC-4.1.1 (approximate areas, never pins), the camera-framing rule
 * (FR-8.16) and the ladder's degradation are all decisions that can be
 * asserted without a renderer — and they are decisions that quietly stop
 * being true if nobody checks them.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  boundingBox,
  configuredProvider,
  isDegradedLevel,
  radiusForAccuracy,
  resolveMapLevel,
} from '../../src/features/map/level';
import { DEFAULT_PITCH, MIN_EVENT_ZOOM } from '../../src/features/map/types';
import { buildVenuePins, offsetCoincident, sizeForRank, toneForRank } from '../../src/features/map/pins';
import { NullMapAdapter } from '../../src/features/map/null-adapter';
import { createMapAdapter } from '../../src/features/map';
import type { RankedVenue } from '../../src/engine/types';

/**
 * Runs `body` with the given public env vars set or cleared, then restores them.
 *
 * `undefined` means "not set" — deleting the key rather than assigning an empty
 * string, because `readEnv` treats an empty value as absent but `hasMapbox` does
 * not distinguish it from garbage.
 */
function withEnv(vars: Record<string, string | undefined>, body: () => void): void {
  const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;
  const before: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(vars)) {
    before[key] = env[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  try {
    body();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

/** A minimal ranked venue. Only the fields the pin encoder reads matter. */
function venue(overrides: Partial<RankedVenue> & { venueId: string; rank: number }): RankedVenue {
  return {
    venueId: overrides.venueId,
    name: overrides.name ?? overrides.venueId,
    // Tehrais, spaced so two fixtures are never coincident.
    lat: overrides.lat ?? 35.7,
    lng: overrides.lng ?? 51.4,
    rank: overrides.rank,
    floor: 50,
    mean: 60,
    gap: 10,
    minutes: 18,
    totalCost: null,
    confidence: 'high',
    reason: { templateId: 'balanced_floor', params: { floorMinutes: 18 } },
    participants: [],
    conflicts: [],
  };
}

describe('AC-4.1.1 — a start point is an area sized to accuracy, never a pin', () => {
  test('a coarse fix produces a larger circle than a fine one', () => {
    // Arrange
    const fine = radiusForAccuracy(300);
    const coarse = radiusForAccuracy(1500);

    // Act / Assert
    assert.ok(coarse > fine, 'a coarser fix must not render tighter');
  });

  test('the radius is floored and capped, so it never implies precision', () => {
    // A 5 m fix is still shown as an area — a pin at a fuzzed coordinate is
    // both misleading and a compliance exposure.
    assert.equal(radiusForAccuracy(5), radiusForAccuracy(0));
    assert.ok(radiusForAccuracy(5) > 0, 'a good fix still renders as an area');

    // A wildly wrong fix does not swallow the city.
    assert.equal(radiusForAccuracy(100_000), radiusForAccuracy(50_000));
  });
});

describe('FR-8.16 — the camera frames the event, never one participant', () => {
  test('the box covers every supplied coordinate', () => {
    // Arrange
    const points = [
      { lat: 35.70, lng: 51.40 },
      { lat: 35.76, lng: 51.45 },
      { lat: 35.73, lng: 51.38 },
    ];

    // Act
    const box = boundingBox(points);

    // Assert — every point is inside, allowing for floating-point drift on
    // the centre-minus-half-span arithmetic.
    assert.ok(box);
    const EPSILON = 1e-9;
    for (const point of points) {
      assert.ok(
        point.lat >= box.southWest.lat - EPSILON && point.lat <= box.northEast.lat + EPSILON,
        `latitude ${point.lat} fell outside the box`,
      );
      assert.ok(
        point.lng >= box.southWest.lng - EPSILON && point.lng <= box.northEast.lng + EPSILON,
        `longitude ${point.lng} fell outside the box`,
      );
    }
  });

  test('all participants in one building still yields a neighbourhood-scale box', () => {
    // Arrange — the degenerate case from the edge-case checklist.
    const sameBuilding = [
      { lat: 35.7, lng: 51.4 },
      { lat: 35.7, lng: 51.4 },
    ];

    // Act
    const box = boundingBox(sameBuilding);

    // Assert — a zero-area box would zoom to a rooftop, which is also a
    // privacy problem: it would reveal a precise position.
    assert.ok(box);
    const latSpan = box.northEast.lat - box.southWest.lat;
    assert.ok(latSpan > 0, 'a degenerate box must be widened');
  });

  test('padding expands the box around its centre', () => {
    // Arrange
    const points = [
      { lat: 35.70, lng: 51.40 },
      { lat: 35.76, lng: 51.46 },
    ];

    // Act
    const tight = boundingBox(points, 0);
    const padded = boundingBox(points, 0.2);

    // Assert
    assert.ok(tight && padded);
    assert.ok(padded.southWest.lat < tight.southWest.lat);
    assert.ok(padded.northEast.lat > tight.northEast.lat);
  });

  test('an empty set returns null rather than a box at the origin', () => {
    assert.equal(boundingBox([]), null);
  });
});

describe('the fallback ladder', () => {
  test('no configured provider rests at list-only on every platform', () => {
    // Level 3 would be a static image this product does not generate.
    assert.equal(resolveMapLevel('native', 'none'), 4);
    assert.equal(resolveMapLevel('web', 'none'), 4);
    assert.equal(resolveMapLevel('node', 'none'), 4);
  });

  test('a configured MapBox provider is level 1 on native AND on the web', () => {
    // ★ WEB WAS LEVEL 4 UNTIL PLAN 64.
    //
    // The old rule was "the web export is a demo surface with no dev-build
    // renderer, so it goes straight to list-only". Plan 64 added
    // `InteractiveMap.web.tsx`: the browser runs `mapbox-gl` against the same
    // style and the same public token as native. A browser now gets a real map,
    // and reporting 4 there would make the analytics a lie about a map that draws.
    assert.equal(resolveMapLevel('native', 'mapbox'), 1);
    assert.equal(resolveMapLevel('web', 'mapbox'), 1);
    assert.equal(resolveMapLevel('native', 'maplibre'), 2);
    assert.equal(resolveMapLevel('web', 'maplibre'), 2);
  });

  test('the test runner stays list-only, because it has no canvas', () => {
    assert.equal(resolveMapLevel('node', 'mapbox'), 4);
  });

  test('levels 3 and 4 are shipping states, not failures', () => {
    assert.equal(isDegradedLevel(3), true);
    assert.equal(isDegradedLevel(4), true);
    assert.equal(isDegradedLevel(1), false);
  });

  test('no provider variable and no token reads as none', () => {
    // ★ THE ENVIRONMENT IS PINNED, NOT ASSUMED.
    //
    // These assertions passed locally and failed on CI, for the same reason in
    // reverse: a developer's shell has no token and CI's does. A test that reads
    // ambient environment is a test of the machine, not of the code — so the two
    // variables are cleared for the duration and restored afterwards.
    withEnv(
      { EXPO_PUBLIC_MAP_PROVIDER: undefined, EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN: undefined },
      () => {
        assert.equal(configuredProvider(), 'none');
      },
    );
  });

  test('the factory returns a working adapter at every level', () => {
    // With no token the ladder rests honestly at list-only.
    withEnv({ EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN: undefined }, () => {
      const adapter = createMapAdapter('native');
      assert.ok(adapter.configure instanceof Function);
      assert.equal(adapter.level, 4);
    });

    // A token produces level 1, which is what a configured deployment sees.
    withEnv({ EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN: 'pk.abc.def' }, () => {
      const adapter = createMapAdapter('native');
      assert.equal(adapter.level, 1);
    });
  });

  test('a build with a token but no provider variable is still configured', () => {
    // TWO VARIABLES FOR ONE FACT IS ONE VARIABLE TOO MANY.
    //
    // EXPO_PUBLIC_MAP_PROVIDER predates the migration and an operator may never
    // have set it. Requiring BOTH means a deployment that passes its token still
    // reports list-only - a map that silently never appears.
    const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;
    const before = env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;

    try {
      env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN = 'pk.abc.def';
      assert.equal(configuredProvider(), 'mapbox');
      assert.equal(resolveMapLevel('web'), 1);
    } finally {
      if (before === undefined) delete env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
      else env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN = before;
    }
  });

  test('an explicit provider variable still wins over the token', () => {
    // An operator who wants to pin one provider keeps that control.
    const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;
    const before = {
      provider: env.EXPO_PUBLIC_MAP_PROVIDER,
      token: env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN,
    };

    try {
      env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN = 'pk.abc.def';
      env.EXPO_PUBLIC_MAP_PROVIDER = 'maplibre';
      assert.equal(configuredProvider(), 'maplibre');
    } finally {
      if (before.provider === undefined) delete env.EXPO_PUBLIC_MAP_PROVIDER;
      else env.EXPO_PUBLIC_MAP_PROVIDER = before.provider;
      if (before.token === undefined) delete env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
      else env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN = before.token;
    }
  });

  test('a token produces the real adapter, and its absence produces the null one', async () => {
    // Arrange
    const env = (globalThis as { process: { env: Record<string, string | undefined> } }).process.env;
    const before = env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
    const { MapboxMapAdapter } = await import('@/src/features/map/mapbox-adapter');

    try {
      env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN = 'pk.abc.def';
      const withToken = createMapAdapter('web');

      delete env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
      const without = createMapAdapter('web');

      // Assert - level 1 with a real adapter, level 4 without: never level 1 while
      // drawing nothing, which would make `map_viewed.render_level` a lie.
      assert.ok(withToken instanceof MapboxMapAdapter, 'a token did not produce the real adapter');
      assert.equal(withToken.level, 1);
      assert.equal(without.level, 4);
      assert.equal(without instanceof MapboxMapAdapter, false);
    } finally {
      if (before === undefined) delete env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN;
      else env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN = before;
    }
  });
});

describe('AC-4.6.1 — rank is number + size + colour, never colour alone', () => {
  test('the leading venue is in the top tier on every axis', () => {
    assert.equal(sizeForRank(1), 'lead');
    assert.equal(toneForRank(1), 'primary');
  });

  test('ranks 2–3 form one tier and everything after forms another', () => {
    assert.equal(sizeForRank(2), 'near');
    assert.equal(sizeForRank(3), 'near');
    assert.equal(sizeForRank(4), 'rest');
    assert.equal(toneForRank(4), 'rest');
  });

  test('every pin carries its rank number, not only a tone', () => {
    // Arrange
    const ranked = [venue({ venueId: 'a', rank: 1 }), venue({ venueId: 'b', rank: 2 })];
    const coordinates = {
      a: { lat: 35.7, lng: 51.4 },
      b: { lat: 35.71, lng: 51.41 },
    };

    // Act
    const pins = buildVenuePins(ranked, coordinates);

    // Assert — the numeral is what survives greyscale.
    assert.equal(pins.length, 2);
    assert.deepEqual(pins.map((pin) => pin.rank), [1, 2]);
  });

  test('an excluded venue keeps its place but takes the muted tier', () => {
    // Arrange
    const ranked = [venue({ venueId: 'a', rank: 1 })];
    const coordinates = { a: { lat: 35.7, lng: 51.4 } };

    // Act
    const pins = buildVenuePins(ranked, coordinates, new Set(['a']));

    // Assert — still on the map (OQ-4.2), flagged for the muted treatment.
    assert.equal(pins.length, 1);
    assert.equal(pins[0]?.excluded, true);
  });

  test('a venue with no coordinate is omitted rather than pinned at zero', () => {
    // Arrange
    const ranked = [venue({ venueId: 'a', rank: 1 })];

    // Act
    const pins = buildVenuePins(ranked, {});

    // Assert — a pin at (0, 0) would be a lie about where the venue is.
    assert.equal(pins.length, 0);
  });
});

describe('two venues at identical coordinates are offset, never merged', () => {
  test('coincident pins are nudged apart deterministically', () => {
    // Arrange
    const items = [
      { venueId: 'a', coordinate: { lat: 35.7, lng: 51.4 } },
      { venueId: 'b', coordinate: { lat: 35.7, lng: 51.4 } },
    ];

    // Act
    const first = offsetCoincident(items);
    const second = offsetCoincident(items);

    // Assert — both are kept, and separated.
    assert.equal(first.length, 2);
    assert.notDeepEqual(first[0]?.coordinate, first[1]?.coordinate);
    // Deterministic: the same input produces the same layout.
    assert.deepEqual(first, second);
  });

  test('distinct coordinates are left exactly where they are', () => {
    // Arrange
    const items = [
      { venueId: 'a', coordinate: { lat: 35.7, lng: 51.4 } },
      { venueId: 'b', coordinate: { lat: 35.8, lng: 51.5 } },
    ];

    // Act
    const result = offsetCoincident(items);

    // Assert
    assert.deepEqual(result[0]?.coordinate, items[0]?.coordinate);
    assert.deepEqual(result[1]?.coordinate, items[1]?.coordinate);
  });
});

describe('the null adapter (level 4)', () => {
  test('accepts every adapter call without drawing anything', () => {
    // Arrange
    const adapter = new NullMapAdapter(4);
    const box = boundingBox([{ lat: 35.7, lng: 51.4 }]);
    assert.ok(box);

    // Act — none of these may throw; the screen calls all of them.
    adapter.configure();
    adapter.setCamera({ bounds: box, minZoom: MIN_EVENT_ZOOM, pitch: DEFAULT_PITCH });
    adapter.setParticipantAreas([]);
    adapter.setVenuePins([]);
    adapter.setTheme('light');
    adapter.revealMeetPoint({ lat: 35.7, lng: 51.4 });

    // Assert
    assert.equal(adapter.level, 4);
    assert.equal(adapter.theme, 'light');
  });

  test('map→list selection reaches its listener', () => {
    // Arrange
    const adapter = new NullMapAdapter(4);
    const seen: string[] = [];
    const unsubscribe = adapter.onSelectVenue((venueId) => seen.push(venueId));

    // Act
    adapter.emitSelectVenue('venue-1');
    unsubscribe();
    adapter.emitSelectVenue('venue-2');

    // Assert — selecting a pin reports it, and unsubscribing stops it.
    assert.deepEqual(seen, ['venue-1']);
  });
});
