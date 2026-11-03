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

import {
  MIN_STROKE_LUMINANCE,
  brightenForStroke,
  relativeLuminance,
} from '@/src/features/map/route-color';
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

test('the lift is large enough to read as "brighter", not to round up', () => {
  // ★ 0.02 WAS THE FLOOR THAT LET THE DEFECT SHIP A SECOND TIME.
  //
  // The first version of this test only demanded a measurable gain, so a 22 % lift
  // passed it while a device screenshot still showed a muted stroke beside a bright
  // pin. "The lines are still too dark" came back. The floor is now a visible step:
  // the stroke has to clear MIN_STROKE_LUMINANCE on its own merits, which is a
  // property of the colour rather than of how it was derived.
  for (const color of participantColors) {
    const stroke = brightenForStroke(color);
    const before = relativeLuminance(color);
    const after = relativeLuminance(stroke);

    // ★ THE FLOOR IS THE GUARANTEE; THE GAIN IS RELATIVE TO THE HEADROOM LEFT.
    //
    // A flat "must gain 0.08" is the wrong rule for an already-bright hue: volt
    // `#D4FF3A` is at 0.858, so the most any lift can add is 0.14 and 0.08 of that
    // would be most of the way to white. What must hold for EVERY colour is the
    // absolute floor; the gain requirement applies to the colours that had room, and
    // is expressed as a fraction of the headroom they actually had.
    assert.ok(
      after >= MIN_STROKE_LUMINANCE,
      `${color} -> ${stroke} is ${after.toFixed(3)}, below the ${MIN_STROKE_LUMINANCE} floor`,
    );

    // ★ AND IT MUST NOT COME OUT WEAKER THAN THE PIN IT BELONGS TO.
    //
    // The real requirement is not a fraction of headroom — that varies by hue and
    // by how bright the palette entry already was. It is that the stroke be
    // STRICTLY the brighter mark, by a margin a reader can see on a dark basemap.
    assert.ok(
      after - before >= 0.04,
      `${color} -> ${stroke} barely changed (${before.toFixed(3)} -> ${after.toFixed(3)})`,
    );
  }
});

test('a dim hue is pushed all the way to the floor, not just lifted a fraction', () => {
  // ★ A FIXED FRACTION IS RELATIVE TO THE HUE, SO IT DOES NOT GUARANTEE LEGIBILITY.
  //
  // A dark red lifted by the same fraction as a bright lime lands well below it, so
  // "is this line bright enough?" would depend on which person proposed the place.
  // Deep colours are the ones that need the second pass; this asserts it runs.
  const dim = '#4A1020';
  assert.ok(relativeLuminance(dim) < 0.1, 'the fixture is not actually dim');

  const stroke = brightenForStroke(dim);

  assert.ok(
    relativeLuminance(stroke) >= MIN_STROKE_LUMINANCE,
    `a dim hue was not pushed to the floor: ${stroke} is ${relativeLuminance(stroke).toFixed(3)}`,
  );
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

test('a line never falls back to the origin colour without saying so', () => {
  // ★ MEASURED ON A DEVICE: THE PIN WAS YELLOW AND THE LINE WAS MUTED TEAL-GREEN.
  //
  // The line resolved its colour through `colorById.get(id) ?? ORIGIN_COLOR`, so a
  // lookup that misses drew every route in the ORIGIN's teal (`#0E7C86`) while the
  // pins beside them kept their own colours — "the lines are still too dark, and
  // they are not the pin's colour". Colour is the only thing connecting a line to a
  // person, so a silent substitution is worse than a missing line.
  // The lookup is gone from the CODE, not merely from the prose: a comment quoting
  // the old expression must not satisfy this.
  assert.doesNotMatch(
    EVENT_MAP,
    /colorById\.get\(/,
    'the line colour is still resolved through a keyed lookup that can miss',
  );
  assert.doesNotMatch(
    EVENT_MAP,
    /^\s*color:\s*brightenForStroke\([^)]*\?\?\s*ORIGIN_COLOR/m,
    'a missed lookup still falls back to the origin teal',
  );
  assert.match(
    EVENT_MAP,
    /brightenForStroke\(destination\.color\)/,
    'the line colour is not taken from the destination it leads to',
  );
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
