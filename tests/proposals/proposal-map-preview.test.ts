/**
 * The proposal box draws its venue, and its foot is the gauge.
 *
 * ★ THE MAP WAS MISSING AND A SENTENCE STOOD IN FOR IT.
 *
 * The venue block carried no picture at all — only a `Button` whose label is
 * «بازکردن در برنامه دیگر», "open in another app". With nothing drawn above the
 * address, a caption about opening an app IS what the reader reports: "the map is
 * not displayed on the proposal boxes, and instead it displays
 * `بازکردن در برنامه دیکر`". A map affordance that is a sentence about another
 * application is indistinguishable from a map that failed to load.
 *
 * ★ AND THE FOOT BELOW THE VOTE BAR WAS DEAD SPACE.
 *
 * `shareBarTail` was `space[3]` of transparent padding under a `space[1]` bar,
 * inside a card whose foot reserved `space[5] + space[3]` to clear it: four pixels
 * of gauge floating above a strip of nothing.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { space } from '@/src/theme/tokens';
import {
  PROPOSAL_MAP_PREVIEW_HEIGHT,
  previewTileUrls,
  tileCoordinate,
} from '@/src/features/proposals/components/ProposalMapPreview';

let renderComponent: typeof import('../ui/support/render').renderComponent;

before(async () => {
  const { initI18n } = await import('@/src/i18n');
  initI18n('fa');
  ({ renderComponent } = await import('../ui/support/render'));
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CARD = code('src/features/proposals/components/ProposalCard.tsx');
const EVENT_HOME = code('app/event/[id]/index.tsx');

/* ── The tile ─────────────────────────────────────────────────────────────── */

test('a point resolves to the tile that contains it', () => {
  // Arrange — Tehran, and London, at the preview zoom. The reference values are the
  // standard slippy-map coordinates for those points.
  const tehran = tileCoordinate(35.6892, 51.389, 15);
  const london = tileCoordinate(51.5074, -0.1278, 15);

  // Act / Assert
  assert.deepEqual(tehran, { x: 21061, y: 12902 });
  assert.deepEqual(london, { x: 16372, y: 10896 });
});

test('an out-of-range latitude is clamped, not searched for', () => {
  // Arrange — a payload can carry any number; the projection is undefined past ±85°.
  for (const lat of [-91, -900, 90, 900]) {
    // Act
    const tile = tileCoordinate(lat, 0, 12);

    // Assert
    assert.ok(Number.isFinite(tile.x) && Number.isFinite(tile.y), `lat ${lat} produced ${tile.x},${tile.y}`);
    assert.ok(tile.y >= 0 && tile.y < 2 ** 12, `lat ${lat} left the grid at y=${tile.y}`);
  }
});

test('longitude wraps at the antimeridian', () => {
  // Arrange — the tile grid is periodic, so 181°E is the same column as 179°W.
  const east = tileCoordinate(0, 181, 10);
  const west = tileCoordinate(0, -179, 10);

  // Act / Assert
  assert.equal(east.x, west.x);
});

test('the preview uses the picker’s provider, layers and key', () => {
  // Arrange — a second rule for what dark looks like is how two maps in one app
  // start disagreeing.
  const light = previewTileUrls(35.6892, 51.389, false);
  const dark = previewTileUrls(35.6892, 51.389, true);

  // Act / Assert
  assert.equal(light.length, 1);
  assert.match(light[0]!, /cartocdn\.com\/rastertiles\/voyager\/15\/\d+\/\d+@2x\.png/);

  // Dark is TWO layers: the canvas, then white place names over it — the pairing
  // `LocationMapPicker` documents.
  assert.equal(dark.length, 2);
  assert.match(dark[0]!, /dark_nolabels/);
  assert.match(dark[1]!, /dark_only_labels/);
});

test('the tile zoom is near enough to tell two streets apart', () => {
  // Arrange — the preview is one tile, 96pt tall.
  const near = tileCoordinate(35.6892, 51.389, 15);
  const oneKmNorth = tileCoordinate(35.6982, 51.389, 15);

  // Act — one kilometre of latitude at zoom 15 is about half a tile.
  assert.ok(Math.abs(oneKmNorth.y - near.y) <= 1, 'a kilometre moves the preview more than one tile');
  assert.ok(PROPOSAL_MAP_PREVIEW_HEIGHT > space[10], 'the preview is too short to read as a map');
});

/* ── The card ─────────────────────────────────────────────────────────────── */

test('the venue block mounts the map preview', () => {
  // Act
  const imports = /import \{ ProposalMapPreview \} from '\.\/ProposalMapPreview'/.test(CARD);
  const mounts = /<ProposalMapPreview/.test(CARD);

  // Assert
  assert.ok(imports, 'the card does not import the preview');
  assert.ok(mounts, 'the card renders no map');
});

test('the stale label is no longer the visible content of the venue block', () => {
  // Arrange — `proposals.card.openInMaps` is «بازکردن در برنامه دیگر» in Persian.
  // It survives as the map affordance's ACCESSIBLE NAME, which is correct; what it
  // must not do is stand where the picture belongs.
  const venueBlock = /proposal\.venue && \(([\s\S]*?)\n {6}\)\}/.exec(CARD)?.[1] ?? '';

  // Act
  const visibleLabel = /<Text[\s\S]{0,200}?proposals\.card\.openInMaps/.test(venueBlock);
  const asAccessibilityLabel = /accessibilityLabel=\{t\('proposals\.card\.openInMaps'\)\}/.test(
    venueBlock,
  );
  const asButton = /<Button[\s\S]{0,200}?proposals\.card\.openInMaps/.test(venueBlock);

  // Assert
  assert.ok(venueBlock.length > 0, 'the venue block was not found');
  assert.ok(!visibleLabel, 'the venue block still prints "open in another app" as text');
  assert.ok(!asButton, 'the venue block still renders a labelled button where a map belongs');
  assert.ok(asAccessibilityLabel, 'the map affordance lost its accessible name');
});

test('a rendered preview carries the venue’s point and a description', async () => {
  // Arrange
  const { ProposalMapPreview } = await import(
    '@/src/features/proposals/components/ProposalMapPreview'
  );

  // Act
  const screen = renderComponent(ProposalMapPreview, {
    lat: 35.6892,
    lng: 51.389,
    label: 'کافه مرکزی',
    testID: 'preview',
  });

  // Assert — the picture is information, so it has a description; an empty alt would
  // make the one element that says WHERE silent to a screen reader.
  assert.match(screen.html, /21061\/12902/, 'the preview does not carry the venue’s tile');
  assert.ok(screen.html.includes('کافه مرکزی'), 'the preview has no accessible description');
});

test('an impossible coordinate degrades to a pin, not to a label', async () => {
  // Arrange
  const { ProposalMapPreview } = await import(
    '@/src/features/proposals/components/ProposalMapPreview'
  );

  // Act
  const screen = renderComponent(ProposalMapPreview, {
    lat: Number.NaN,
    lng: 0,
    label: 'کافه',
    testID: 'preview',
  });

  // Assert — a place at no coordinates is still a place: the block shows a pin rather
  // than turning into an error message about one.
  assert.ok(!/img|cartocdn/.test(screen.html), 'a NaN coordinate still requested a tile');
  assert.match(screen.html, /data-testid="preview"/, 'the block disappeared instead of degrading');
});

/* ── The foot ─────────────────────────────────────────────────────────────── */

test('nothing is padded under the vote bar', () => {
  // Arrange — "remove the spacing/padding under the votes bar on the proposal boxes".
  const slot = /shareSlot:\s*\{([\s\S]*?)\n {2}\},/.exec(CARD)?.[1] ?? '';
  const tail = /const shareBarTail = (\d+);/.exec(CARD)?.[1];

  // Act / Assert
  assert.equal(tail, '0', 'the transparent strip below the gauge is back');
  assert.ok(!/paddingBottom:\s*space\[/.test(slot), 'the gauge still pads its own bottom edge');
  assert.ok(/bottom: 0/.test(slot), 'the gauge is not on the card’s bottom edge');
});

test('the card reserves exactly the gauge at its foot', () => {
  // Arrange — the reservation used to be `space[5] + space[3]`: the card's own
  // padding plus sixteen pixels for a strip that no longer exists.
  const reserved = /cardWithShare:\s*\{\s*paddingBottom:\s*space\[(\d+)\] \+ space\[(\d+)\]/;
  const match = reserved.exec(CARD);

  // Act / Assert
  assert.ok(match, 'the foot is not a plain two-step reservation');
  const cardPadding = Number(match[1]);
  const gauge = Number(match[2]);

  // The gauge is one step tall (`VoteShareBar` is `space[1]`), so the foot is the
  // card's padding plus that step — not the padding plus a dead tail.
  assert.ok(cardPadding > 0, 'the card reserves no bottom padding at all');
  assert.equal(gauge, 1, `the foot reserves ${gauge} steps for a one-step gauge`);
});

test('the vote buttons are further from the box than before', () => {
  // Arrange — "increase the spacing between the proposal boxes and the vote buttons".
  const block = /proposalBlock:\s*\{([\s\S]*?)\n {2}\},/.exec(EVENT_HOME)?.[1] ?? '';
  const list = /list:\s*\{([\s\S]*?)\n {2}\},/.exec(EVENT_HOME)?.[1] ?? '';

  // Act
  const blockGap = Number(/gap:\s*space\[(\d+)\]/.exec(block)?.[1] ?? -1);
  const listGap = Number(/gap:\s*space\[(\d+)\]/.exec(list)?.[1] ?? -1);

  // Assert — the pair reads as one unit, and two proposals still separate.
  assert.ok(blockGap >= 4, `a card and its vote buttons are only ${blockGap} apart`);
  assert.ok(listGap > blockGap, `the list gap ${listGap} does not separate two proposals more than ${blockGap}`);
});
