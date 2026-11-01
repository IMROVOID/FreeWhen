/**
 * A map colour must be a colour the MAP can draw.
 *
 * ★ THE WHITE PIN ON A DEVICE WAS A TYPE BUG, NOT A DESIGN CHOICE.
 *
 * With Material You on — `useDeviceAccent` defaults to TRUE on Android 12+ —
 * `applyDeviceAccent` replaces `primary` and `brand` on the theme with
 * `PlatformColor('@android:color/system_accent1_300')`. That is a React Native
 * descriptor object, not a string: RN resolves it internally when it paints a view,
 * and everything that renders through RN looked correct.
 *
 * The map does not render through RN. Both surfaces hand the value to `mapbox-gl` and
 * to an SVG `fill` attribute, where an object stringifies to `"[object Object]"` — an
 * invalid colour. MapBox ignores it, the SVG path keeps its unstyled default, and the
 * pin came out WHITE on a light basemap while the theme said volt. The browser never
 * showed it because the web build has no Material You.
 *
 * So `mapAppearance` refuses anything that is not a drawable colour string.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { mapAppearance } from '@/src/features/map/appearance';
import { themes } from '@/src/theme/tokens';

/** The shape `PlatformColor(...)` returns: an object RN understands and CSS does not. */
const platformColour = { semantic: ['system_accent1_300'] } as unknown as string;

test('a PlatformColor is refused and the theme accent is used instead', () => {
  // Act
  const dark = mapAppearance('dark', platformColour);
  const light = mapAppearance('light', platformColour);

  // Assert — a real colour either way, and the one the product designed.
  assert.equal(dark.accent, themes.dark.primary);
  assert.equal(light.accent, themes.light.primary);
  assert.equal(typeof dark.accent, 'string');
});

test('a plain colour string passes through untouched', () => {
  assert.equal(mapAppearance('dark', '#D4FF3A').accent, '#D4FF3A');
  assert.equal(mapAppearance('light', 'rgb(1, 2, 3)').accent, 'rgb(1, 2, 3)');
});

test('an empty or stringified-object value is refused', () => {
  // Arrange — `[object Object]` is what an unresolved descriptor becomes in a
  // template literal, which is the exact value the SVG received.
  assert.equal(mapAppearance('dark', '   ').accent, themes.dark.primary);
  assert.equal(mapAppearance('dark', '[object Object]').accent, themes.dark.primary);
});

test('the picker hands the map its resolved accent, not raw theme.primary', () => {
  // Arrange ★ THIS IS THE LINE THE WHITE PIN CAME FROM.
  const picker = read('src/components/ui/LocationMapPicker.tsx');

  // Assert — the marker colour comes from the resolved appearance.
  assert.match(picker, /const accent = appearance\.accent;/, 'the picker does not resolve an accent');
  assert.match(picker, /color: accent,/, 'the pin does not take the resolved accent');
  assert.doesNotMatch(picker, /color: theme\.primary,/, 'the pin takes the raw theme value again');
});

test('the proposal map does the same', () => {
  const proposalMap = read('src/features/proposals/components/ProposalRouteMap.tsx');
  assert.doesNotMatch(proposalMap, /color: theme\.primary,/, 'the proposal pin takes the raw theme value');
  assert.match(proposalMap, /color: appearance\.accent,/);
});

test('every map surface resolves its accent through mapAppearance', () => {
  for (const path of [
    'src/components/ui/LocationMapPicker.tsx',
    'src/features/venues/components/EventRouteMap.tsx',
    'src/features/proposals/components/ProposalRouteMap.tsx',
  ]) {
    assert.match(read(path), /mapAppearance\(/, `${path} builds its accent by hand`);
  }
});

function read(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
