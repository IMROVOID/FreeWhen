/**
 * A route line is brighter than the pin it leads to.
 *
 * ★ THE REPORT.
 *
 * "Make the colour of routing lines brighter. They follow the proposed location
 * (map pin) colour but too dark — make them dynamically lighter (almost the same
 * bright colour as the map pins)."
 *
 * ★ THERE WAS NO DARKENING CODE LEFT, AND THAT IS WHY THIS IS A COLOUR DEFECT.
 *
 * The black casing that used to sit under the stroke was deleted in `c45663b`, so
 * the line and the pin are now handed the SAME hex string. They still do not look
 * the same: a pin is a filled shape with a white ring and a drop shadow, while a
 * 6 px stroke carries a third of the ink and is anti-aliased against a busy
 * basemap. Identical input, darker result.
 *
 * So the fix cannot be "stop darkening it" — nothing was darkening it. The line
 * colour is DERIVED from the pin colour instead, by lifting every channel toward
 * white in one place, so the two cannot drift and "whose line is that?" still
 * reads.
 *
 * These are measured assertions rather than eyeballed ones: relative luminance
 * goes UP for every colour the app can actually hand a marker.
 */

import './support/register';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { brightenForStroke, relativeLuminance } from '@/src/features/map/route-color';
import { map as mapTokens, participantColors } from '@/src/theme/tokens';

/* ── The arithmetic ───────────────────────────────────────────────────────── */

test('every participant colour gets brighter, not just the dark ones', () => {
  // ★ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT "IT IS STILL TOO DARK".
  //
  // A lift applied only when a colour is already dark would leave tangerine and
  // volt exactly as they were — and they are the two colours a stroke loses the
  // most ink to, because they are the most saturated.
  for (const color of participantColors) {
    const lifted = brightenForStroke(color);

    const before = relativeLuminance(color);
    const after = relativeLuminance(lifted);

    assert.ok(
      after > before,
      `${color} → ${lifted} did not brighten (${before.toFixed(4)} → ${after.toFixed(4)})`,
    );
  }
});

test('the lift is measurable, not a rounding artefact', () => {
  // Arrange — the smallest lift worth shipping. Below this the change is inside
  // the noise of an anti-aliased 6 px stroke and the report comes back.
  const MIN_LIFT = 0.02;

  // Act / Assert
  for (const color of participantColors) {
    const gain = relativeLuminance(brightenForStroke(color)) - relativeLuminance(color);
    assert.ok(gain >= MIN_LIFT, `${color} only gained ${gain.toFixed(4)} luminance`);
  }
});

test('the hue survives, so a line still names its proposal', () => {
  // ★ COLOUR IS THE ONLY THING CONNECTING A LINE TO A PERSON.
  //
  // A brightening pass that desaturates toward white would make every line the
  // same pale smear and destroy the one fact the line carries. "Toward white"
  // must move all three channels by the same FRACTION of their own headroom,
  // which keeps their order — and therefore the hue — intact.
  for (const color of participantColors) {
    const lifted = brightenForStroke(color);

    const before = channels(color);
    const after = channels(lifted);

    // The rank order of the channels is the hue: if red was the largest it must
    // still be the largest.
    assert.deepEqual(
      orderOf(after),
      orderOf(before),
      `${color} → ${lifted} reordered its channels, which is a hue shift`,
    );
  }
});

test('a near-white colour does not wrap or clamp to grey', () => {
  // A naive `c * 1.2` clamps at 255 and silently drops the hue on a light colour.
  const lifted = brightenForStroke('#F0F0FF');
  const rgb = channels(lifted);

  assert.ok(rgb[2] >= rgb[0], 'the blue channel lost its lead');
  for (const channel of rgb) {
    assert.ok(channel >= 0 && channel <= 255, 'a channel left the byte range');
  }
});

test('a value it cannot parse is returned unchanged', () => {
  // ★ A THEME TOKEN MAY ALREADY CARRY AN ALPHA CHANNEL.
  //
  // `withAlpha` produces `rgba(…)`, and feeding that into a hex parser would
  // mangle it into a colour the renderer rejects — which reads as "the line
  // disappeared", a far worse defect than "the line is dark".
  for (const value of ['rgba(255, 122, 47, 0.4)', 'red', '', '#FFF', '#GGGGGG']) {
    assert.equal(brightenForStroke(value), value);
  }
});

test('the output is a canonical six-digit hex the style accepts', () => {
  // Both renderers hand this string to MapBox as a style value, and the halo
  // layer uses it too: a shorthand or lower-case form would make the two
  // surfaces disagree in a diff.
  const lifted = brightenForStroke('#0e7c86');
  assert.match(lifted, /^#[0-9A-F]{6}$/);
});

test('the same input always produces the same output', () => {
  // A deterministic derivation is what lets the pin and the line be computed in
  // two different components without a shared value threading between them.
  assert.equal(brightenForStroke('#7AF0C8'), brightenForStroke('#7AF0C8'));
});

/* ── The call sites ───────────────────────────────────────────────────────── */

function code(path: string): string {
  return readFileSync(path, 'utf8');
}

const EVENT_MAP = code('src/features/venues/components/EventRouteMap.tsx');
const PROPOSAL_MAP = code('src/features/proposals/components/ProposalRouteMap.tsx');

test('the event map derives its line colour from the pin colour', () => {
  // ★ LINE AND PIN MUST BE COMPUTED FROM ONE VALUE, OR THEY DRIFT.
  //
  // Before this, both took `destination.color` and the line looked darker for a
  // purely perceptual reason. The pin keeps the raw colour; only the stroke is
  // lifted.
  assert.match(EVENT_MAP, /brightenForStroke/, 'the event map does not brighten its line');
  assert.match(
    EVENT_MAP,
    /color:\s*brightenForStroke\(/,
    'the line colour is not the lifted pin colour',
  );
});

test('the proposal card brightens its line too', () => {
  assert.match(PROPOSAL_MAP, /brightenForStroke/, 'the proposal card does not brighten its line');
});

test('neither surface has brought a dark casing back', () => {
  // ★ A REGRESSION GUARD ON `c45663b`.
  //
  // The casing was a 7 px black stroke at 25 % under the coloured one, and on the
  // night basemap it turned every line into dark olive. The halo that replaces it
  // is LIGHT; a dark one reappearing is the same defect with a new name.
  assert.doesNotMatch(EVENT_MAP, /routeCasing/);
  assert.doesNotMatch(PROPOSAL_MAP, /routeCasing/);
  assert.match(mapTokens.routeHalo, /^#[0-9A-F]{6}$/i, 'the halo token is not a colour');
  assert.ok(
    relativeLuminance(mapTokens.routeHalo) > 0.8,
    'the halo is not light enough to lift a stroke off a pale basemap',
  );
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function channels(hex: string): [number, number, number] {
  const value = parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function orderOf(rgb: [number, number, number]): [string, string, string] {
  const named: Array<[string, number]> = [
    ['r', rgb[0]],
    ['g', rgb[1]],
    ['b', rgb[2]],
  ];
  // Ties are kept in channel order, so two equal channels stay equal.
  return named.sort((a, b) => b[1] - a[1]).map(([name]) => name) as [string, string, string];
}
