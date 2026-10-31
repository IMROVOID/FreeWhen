/**
 * The map surface: two renderers behind one interface, and neither leaks.
 *
 * ★ THE ONLY MECHANISM THAT REMOVES CODE FROM A BUNDLE IS FILE SUBSTITUTION.
 *
 * `src/platform/README.md` states it and this suite holds it: a runtime
 * `Platform.OS === 'web'` branch does not stop the import. The import is evaluated
 * at load, so a native module reached from a shared file crashes the web export
 * before any branch is consulted — and a DOM library reached from a native file
 * crashes on a device.
 *
 * So the properties that matter are structural, and they are asserted here rather
 * than trusted to review:
 *
 *  - the shared file is PURE (types and a throw, no library, no `react-native`);
 *  - each implementation imports exactly one map library;
 *  - the call sites import the bare specifier and never branch on platform.
 *
 * ★ AND THE CAMERA IS THE FEATURE.
 *
 * The product asked for a 3D map with full interaction. A pitch that reaches the
 * renderer as 0, or a zoom that reaches it as NaN, is a flat or black map — both
 * of which look like "the library did not load". The arithmetic that converts the
 * caller's camera into each renderer's own vocabulary is therefore tested here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  clampZoom,
  mapAppearance,
} from '@/src/features/map/appearance';
import {
  DEFAULT_MAP_CENTRE,
  circleRadiusPixels,
  linesFeatureCollection,
  metresPerPixel,
  nearestVenue,
  withAlpha,
} from '@/src/features/map/projection';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SHARED = code('src/components/ui/InteractiveMap.tsx');
const VENUE_NATIVE = code('src/features/venues/components/VenueMap.native.tsx');
const VENUE_WEB = code('src/features/venues/components/VenueMap.web.tsx');
const PICKER_WITH_LABEL = code('src/components/ui/LocationMapPicker.tsx');
const WEB = readFileSync('src/components/ui/InteractiveMap.web.tsx', 'utf8');
const NATIVE = readFileSync('src/components/ui/InteractiveMap.native.tsx', 'utf8');

/* ── Substitution discipline ──────────────────────────────────────────────── */

test('the shared module is pure — no library, no react-native', () => {
  // Act
  const importsLibrary = /from '(mapbox-gl|react-native-maps)'/.test(SHARED);
  const importsRN = /from 'react-native'/.test(SHARED);

  // Assert — it is evaluated by tooling that ignores suffixes, so anything
  // heavier than a type is on the wrong side of the seam.
  assert.equal(importsLibrary, false, 'the shared map module imports a map library');
  assert.equal(importsRN, false, 'the shared map module imports react-native');
});

test('the shared fallback throws a message naming both implementations', () => {
  // Assert — a silent no-op here would render an empty frame forever.
  assert.match(SHARED, /Metro must resolve InteractiveMap\.native\.tsx or InteractiveMap\.web\.tsx/);
});

test('the web implementation imports the DOM library and not the native one', () => {
  assert.match(WEB, /from 'mapbox-gl'/);
  assert.doesNotMatch(WEB, /from 'react-native-maps'/);
});

test('the native implementation hosts the web map in a WebView, not a Google map', () => {
  // ★ `react-native-maps` WAS THE NATIVE RENDERER AND IS GONE.
  //
  // Two device-verified facts removed it: `MapViewManager.setGoogleRenderer`
  // initialises the Google SDK when a MapView is created (so the app crashed with
  // "API key not found"), and `MapUrlTile` attaches MapBox tiles as a
  // `GoogleMap.TileOverlay` — so when Google fails authorisation there is no
  // GoogleMap and MapBox tiles can never draw. The map was Google's, blank.
  //
  // A WebView running the same `mapbox-gl` document removes Google entirely and
  // makes native and web the same map.
  assert.match(NATIVE, /react-native-webview/, 'the native surface does not use a WebView');
  assert.doesNotMatch(
    code('src/components/ui/InteractiveMap.native.tsx'),
    /from 'react-native-maps'/,
    'react-native-maps is still imported',
  );
  assert.doesNotMatch(NATIVE, /from 'mapbox-gl'/, 'the DOM library is imported natively');
  assert.match(NATIVE, /mapbox-gl\.js/, 'the document does not load mapbox-gl');
});

test('the native basemap is MapBox, with no Google map underneath', () => {
  // Arrange — the WebView draws the same style the browser does, so there is no
  // Google canvas to hide. `mapType="none"` existed only to hide one.
  const nativeCode = code('src/components/ui/InteractiveMap.native.tsx');
  assert.doesNotMatch(nativeCode, /mapType/, 'a Google mapType is still being configured');
  assert.match(nativeCode, /styleForTheme\(theme\)/, 'the native style is not the shared resolver');
});

test('both renderers load the same style for a theme', () => {
  // Act
  const web = /styleForTheme\(theme\)/.test(WEB);
  const native = /styleForTheme\(theme\)/.test(NATIVE);

  // Assert — two providers would be two maps that disagree about what dark is.
  assert.ok(web, 'the web map does not take its style from the shared resolver');
  assert.ok(native, 'the native map does not take its style from the shared resolver');
});

/* ── Interaction ──────────────────────────────────────────────────────────── */

test('the press handler reports a coordinate in lat/lng, not an event', () => {
  // Assert — the browser reads mapbox-gl's event, the device gets a bridge message;
  // both normalise to `{lat, lng}` so callers never see a library shape.
  assert.match(WEB, /pressRef\.current\?\.\(\{\s*lat: event\.lngLat\.lat,\s*lng: event\.lngLat\.lng,?\s*\}\)/s);
  assert.match(NATIVE, /onPress\?\.\(\{\s*lat: message\.lat,\s*lng: message\.lng\s*\}\)/s);
});

test('camera changes are reported after every settled move, in the shared shape', () => {
  assert.match(WEB, /map\.on\('moveend'/);
  // The document listens for `moveend` too, and reports it over the bridge.
  assert.match(NATIVE, /map\.on\('moveend'/);
  assert.match(WEB, /centre: \{ lat: centre\.lat, lng: centre\.lng \}/);
  assert.match(NATIVE, /centre: \{ lat: message\.lat, lng: message\.lng \}/);
});

test('a read-only map is expressible, which is what makes "view not change" real', () => {
  // Assert — the event page omits `onPress`; the surface must not synthesise one.
  assert.match(SHARED, /onPress\?: \(coordinate: Coordinate\) => void;/);
});

test('the web map is constructed once, so a re-render does not rebuild the canvas', () => {
  // Arrange — the construction effect's dependency list is the mechanism.
  const constructs = /new mapboxgl\.Map\(/.test(WEB);
  const deps = /eslint-disable-next-line react-hooks\/exhaustive-deps\s*\n\s*\}, \[\]\);/.test(WEB);

  // Act / Assert — a re-render that tore down the map would reset the camera the
  // user had just placed, and would leak a canvas per keystroke.
  assert.ok(constructs, 'the map is never constructed');
  assert.ok(deps, 'the construction effect re-runs, so every render rebuilds the map');
});

test('the callbacks are read through refs, not captured at construction', () => {
  // Arrange — a responder built once closes over the first render's props forever.
  // This codebase has already paid for that defect once, in the pan handler.
  assert.match(WEB, /const pressRef = useRef\(onPress\)/);
  assert.match(WEB, /pressRef\.current = onPress/);
  assert.match(WEB, /pressRef\.current\?\./);
});

test('a missing token reports unavailable instead of drawing an empty map', () => {
  // Assert — the caller needs to show its stated state, not a blank rectangle.
  assert.match(WEB, /readMapboxToken\(\)/);
  assert.match(WEB, /unavailableRef\.current\?\.\(\)/);
  assert.match(NATIVE, /readMapboxToken\(\)/);
  assert.match(NATIVE, /onUnavailable\?\.\(\)/);
});

test('a zero-height frame is reported, not silently drawn', () => {
  // Arrange — `mapbox-gl` measures its container on init and draws nothing into a
  // 0×0 box with no error. That is a silent blank, the exact failure the previous
  // tile implementation paid for twice.
  assert.match(WEB, /getBoundingClientRect\(\)/);
  assert.match(WEB, /box\.width <= 0 \|\| box\.height <= 0/);
});

/* ── Appearance ───────────────────────────────────────────────────────────── */

test('the appearance carries the pitch and the accent to the renderer', () => {
  // Act
  const appearance = mapAppearance('dark', '#7C4DFF');

  // Assert — 3D at rest, and the product's own accent rather than a map default.
  assert.ok(appearance.pitch > 0);
  assert.equal(appearance.accent, '#7C4DFF');
});

test('zoom is clamped so a bad payload cannot flatten the camera', () => {
  // Act / Assert
  assert.equal(clampZoom(Number.NaN), 12);
  assert.ok(clampZoom(-5) >= MIN_MAP_ZOOM);
  assert.ok(clampZoom(50) <= MAX_MAP_ZOOM);
});

/* ── Route lines ──────────────────────────────────────────────────────────── */

test('a line becomes one GeoJSON feature, in lng/lat order', () => {
  // Arrange
  const lines = [
    { id: 'route-1', points: [[51.389, 35.6892], [51.42, 35.71]] as Array<[number, number]>, color: '#0055FF' },
  ];

  // Act
  const collection = linesFeatureCollection(lines);

  // Assert — the order is already GeoJSON, so it is never switched downstream.
  assert.equal(collection.features.length, 1);
  const feature = collection.features[0] as { geometry: { coordinates: number[][] } };
  assert.deepEqual(feature.geometry.coordinates, [[51.389, 35.6892], [51.42, 35.71]]);
});

test('a straight-line fallback is marked dashed, so the picture stays honest', () => {
  // Arrange
  const lines = [
    {
      id: 'route-1',
      points: [[51.389, 35.6892], [51.42, 35.71]] as Array<[number, number]>,
      color: '#0055FF',
      dashed: true,
    },
  ];

  // Act
  const feature = linesFeatureCollection(lines).features[0] as {
    properties: { dashed: boolean };
  };

  // Assert
  assert.equal(feature.properties.dashed, true);
});

test('a one-point line is dropped rather than drawn as a dot', () => {
  // Arrange
  const lines = [
    { id: 'degenerate', points: [[51.389, 35.6892]] as Array<[number, number]>, color: '#0055FF' },
  ];

  // Act / Assert
  assert.equal(linesFeatureCollection(lines).features.length, 0);
});

/* ── Approximate areas ────────────────────────────────────────────────────── */

test('an area is sized in metres, then converted to pixels for the projection', () => {
  // Arrange — the circle must never imply more precision than the fix had.
  const pixelsAt14 = circleRadiusPixels(1000, 35.6892, 14);
  const pixelsAt16 = circleRadiusPixels(1000, 35.6892, 16);

  // Assert — two zoom levels closer QUARTERS the pixel radius: a ground distance
  // covers four times as many pixels per zoom step, so a fixed 1 km circle gets
  // proportionally smaller on screen.
  assert.ok(pixelsAt14 > 0);
  assert.ok(
    Math.abs(pixelsAt16 / pixelsAt14 - 4) < 1e-6,
    `zoom 16/14 ratio was ${pixelsAt16 / pixelsAt14}, expected 4`,
  );
});

test('a zero or impossible radius draws nothing rather than an inverted circle', () => {
  assert.equal(circleRadiusPixels(0, 35, 14), 0);
  assert.equal(circleRadiusPixels(-500, 35, 14), 0);
  assert.equal(circleRadiusPixels(Number.NaN, 35, 14), 0);
});

test('an area fill derives its alpha from a hex accent, and leaves rgba alone', () => {
  // Act / Assert — a token that is already `rgba()` must not be mangled into a
  // colour the renderer rejects.
  assert.equal(withAlpha('#7C4DFF', 0.18), 'rgba(124, 77, 255, 0.18)');
  assert.equal(withAlpha('rgba(0,0,0,0.5)', 0.18), 'rgba(0,0,0,0.5)');
});

test('the metres-per-pixel shrinks with latitude, as Mercator requires', () => {
  // Assert — a constant would draw a circle of the wrong size at any latitude
  // but the equator, which in Tehran is a visible error.
  assert.ok(metresPerPixel(0, 14) > metresPerPixel(60, 14));
});

/* ── The two renderers must not disagree ─────────────────────────────────── */

test('the marker transform is COMPUTED, never appended to', () => {
  // ★ A REGRESSION FOUND IN REVIEW, AND IT COMPOUNDED.
  //
  // `element.style.transform = element.style.transform + ' scale(1.35)'` grew the
  // selected pin by 35% on EVERY marker effect run — and the effect re-runs on any
  // change to `markers`, which on the picker is every drag and every search result.
  const transform = /element\.style\.transform = ([\s\S]{0,320}?);\n/.exec(WEB)?.[1] ?? '';

  assert.ok(transform.length > 0, 'the marker transform was not found');
  assert.doesNotMatch(
    transform,
    /element\.style\.transform/,
    'the transform is read back from the element, so `scale()` compounds on every run',
  );
});

test('an approximate area is a POLYGON, not a Point a fill layer cannot draw', () => {
  // ★ The web map added a `Point` source and a `fill` layer over it. A fill layer
  // has no geometry for a point, so it drew NOTHING: participant areas were
  // invisible in the browser.
  assert.match(WEB, /type: 'Polygon'/, 'the web area is not a polygon');
  assert.doesNotMatch(
    WEB,
    /geometry: \{\s*type: 'Point',/,
    'the web area is still a Point, which a fill layer cannot draw',
  );
});

test('a closed ring, or the renderer draws nothing', () => {
  // Assert — GeoJSON polygons repeat their first position as their last.
  assert.match(WEB, /coordinates\.push\(coordinates\[0\]/);
});

test('a style reload redraws the overlays, so re-theming keeps the route', () => {
  // ★ `map.setStyle()` drops every custom source and layer. The lines effect keyed
  // on `[lines, circles, isReady]` never re-ran, because `isReady` flips back to
  // true without those changing — so switching theme deleted the route for good.
  assert.match(WEB, /styleVersion/, 'no style-version counter, so a reload loses the overlays');
  assert.match(
    WEB,
    /\}, \[lines, circles, isReady, styleVersion\]\);/,
    'the layers effect does not depend on the style version',
  );
});

test('an unchanged style is not re-applied', () => {
  // Assert — `setStyle` is destructive; the mount path must not pay for it.
  assert.match(WEB, /appliedStyleRef\.current === wanted/);
});

test('both renderers pin the same projection, so neither tilts differently', () => {
  // Assert — the globe projection corrupted a pitched transform at city zoom; both
  // surfaces now state mercator explicitly.
  assert.match(WEB, /projection: 'mercator'/);
  assert.match(NATIVE, /projection: 'mercator'/);
});

test('the native camera follows the caller through the bridge', () => {
  // ★ The camera used to be read once into `initialRegion`, so the picker's zoom
  // buttons and GPS button did nothing on a device while working in the browser.
  assert.match(NATIVE, /window\.__apply/, 'the document exposes no update entry point');
  assert.match(NATIVE, /map\.jumpTo\(/, 'the document never moves the camera');
  assert.match(NATIVE, /camera,\s*\n\s*lines:/, 'the camera is not pushed to the document');
});

test('the native map opens pitched, so the APK rests in 3D', () => {
  // ★ A Google region cannot carry a tilt; the document's own map can.
  assert.match(NATIVE, /pitch: \$\{camera\.pitch\}/, 'the document is not given a pitch');
  assert.match(NATIVE, /maxPitch: 85/, 'the pitch ceiling is not declared');
});

/* ── One hit test, one fallback centre ───────────────────────────────────── */

test('a tap selects the nearest pin, and past the radius selects nothing', () => {
  // Arrange
  const pins = [
    { venueId: 'a', coordinate: { lat: 35.7, lng: 51.4 } },
    { venueId: 'b', coordinate: { lat: 35.8, lng: 51.5 } },
  ];

  // Act / Assert
  assert.equal(nearestVenue(pins, { lat: 35.7001, lng: 51.4001 }), 'a');
  assert.equal(nearestVenue(pins, { lat: 35.7999, lng: 51.4999 }), 'b');
  // Empty map is not the farthest venue.
  assert.equal(nearestVenue(pins, { lat: 36.5, lng: 52.5 }), null);
  assert.equal(nearestVenue([], { lat: 35.7, lng: 51.4 }), null);
});

test('both village renderers use the same hit test and the same fallback centre', () => {
  // Assert — duplicated under two names with two return shapes is how siblings drift.
  assert.match(VENUE_NATIVE, /nearestVenue\(pins, coordinate\)/);
  assert.match(VENUE_WEB, /nearestVenue\(pins, coordinate\)/);
  assert.doesNotMatch(VENUE_NATIVE, /function nearestPin/);
  assert.doesNotMatch(VENUE_WEB, /function nearestVenue/);
  assert.match(VENUE_NATIVE, /DEFAULT_MAP_CENTRE/);
  assert.match(VENUE_WEB, /DEFAULT_MAP_CENTRE/);
});

test('the fallback centre is one named constant', () => {
  // Assert — a map that frames a different city per component is unfindable.
  assert.ok(Number.isFinite(DEFAULT_MAP_CENTRE.lat) && Number.isFinite(DEFAULT_MAP_CENTRE.lng));
});

test('a marker is announced, not just drawn', () => {
  // ★ A REVIEW CAUGHT THIS AS MISSING, AND IT WAS ONLY MISSING FROM THE WRAPPER.
  //
  // `mapbox-gl` reparents the element it is given inside its own
  // `.mapboxgl-marker` div, so an inspector looking at that wrapper sees a childless
  // node. The role and label are on the element this file creates, which is what a
  // screen reader announces. Pinned here so neither is dropped in a refactor.
  assert.match(WEB, /setAttribute\('role', 'img'\)/, 'the marker is not exposed as an image');
  assert.match(WEB, /setAttribute\('aria-label', marker\.label\)/, 'the marker has no accessible name');
});

test('the marker’s accessible name comes from the caller, never from its position', () => {
  // Assert — "pin 1" is a coordinate; the label is the place or participant name.
  assert.match(WEB, /aria-label', marker\.label/);
  assert.match(PICKER_WITH_LABEL, /label: placeName \|\| t\('proposals\.place\.customPin'\)/);
});
