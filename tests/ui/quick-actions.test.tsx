/**
 * The event home's quick-action grid.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * The grid was `flexWrap: 'wrap'` with `actionTile: { flex: 1, minWidth: '45%' }`
 * and FIVE tiles. Two-per-row leaves the fifth alone on its own row, and
 * `flex: 1` then stretched it into a full-width bar pinned under the content,
 * visually detached from the two pairs above it.
 *
 * ★ THE FIRST FIX WAS WRONG, AND THIS FILE USED TO ENCODE IT.
 *
 * Settings was added here as a sixth tile purely so the COUNT became even — and
 * the tests were written to assert that count. It made `/settings` reachable,
 * but it put an app-wide door in a grid of per-event commands, so the grid read
 * as "every button in the product". The count was never the invariant; a full
 * ROW is. Settings now lives on the app's home screen, the grid is back to the
 * five things an event has, and the last tile spans its row through the layout.
 *
 * These assertions are about COUNTS and LABELS in rendered markup, because that
 * is exactly what was wrong: the number of tiles and who was missing.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

import { initI18n } from '@/src/i18n';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

/** The five per-event actions, wired to no-op handlers. */
function renderGrid(overrides: Partial<Record<'onOpenManagement', () => void>> = {}) {
  return import('@/src/features/events/components/QuickActionsGrid').then(({ QuickActionsGrid }) =>
    renderComponent(QuickActionsGrid, {
      onOpenSlots: () => undefined,
      onShare: () => undefined,
      onOpenActivity: () => undefined,
      onOpenChat: () => undefined,
      onOpenManagement: () => undefined,
      ...overrides,
    }),
  );
}

describe('event home quick actions', () => {
  test('the grid carries only the per-event actions', async () => {
    // Act
    const screen = await renderGrid();

    // Assert — five event commands. Settings is NOT one of them: it is the
    // app's door, and it lives on `/`. Counted by the accessible button role
    // because react-native-web's `Pressable` does not forward `testID` to the
    // DOM, and semantic attributes are what a reader and the platform see.
    const tiles = screen.html.match(/role="button"/g) ?? [];
    assert.equal(tiles.length, 5, `expected 5 event tiles, found ${tiles.length}`);
    assert.equal(screen.has('تنظیمات'), false, 'the event grid still offers Settings');
  });

  test('★ exactly one tile spans a row, so no row is left half empty', async () => {
    // Act — five tiles over two columns leaves one row incomplete, so the last
    // tile must fill it. Counted in the markup, because the invariant is about
    // the rendered style and not about the source.
    const screen = await renderGrid();

    // Assert
    const fullWidth = screen.html.match(/flex-basis:\s*100%/g) ?? [];
    assert.equal(fullWidth.length, 1, `expected one full-width tile, found ${fullWidth.length}`);
  });

  test('every event action has a tile', async () => {
    // Act
    const screen = await renderGrid();

    // Assert — react-native-web drops `testID` onto the DOM as a warning, so
    // the tiles are found by their accessible names instead.
    for (const label of ['زمان‌های پیشنهادی', 'اشتراک‌گذاری', 'تاریخچهٔ رویداد', 'گفتگو', 'مدیریت رویداد']) {
      assert.ok(screen.has(label), `no tile is labelled "${label}"`);
    }
  });

  test('the management tile renders and is wired to its handler', async () => {
    // Arrange
    let opened = 0;

    // Act — the handler is passed in and must be ATTACHED to a real control,
    // so the assertion below is about the wiring, not about the label.
    const screen = await renderGrid({ onOpenManagement: () => (opened += 1) });

    // Assert — five distinct controls, each labelled. A tile that renders but
    // does not open is the bug `/settings` already had, so the controls are
    // counted rather than assumed.
    const buttons = screen.html.match(/role="button"/g) ?? [];
    assert.equal(buttons.length, 5, `expected 5 wired controls, found ${buttons.length}`);
    assert.ok(screen.has('مدیریت رویداد'), 'the management tile is missing');
    assert.equal(opened, 0, 'no handler should fire on render');
  });

  test('tiles declare a minimum width, so the row wraps instead of compressing', async () => {
    // Arrange — a previous fix used `flexBasis: 0` alone, which let all six
    // tiles shrink onto ONE row: squeezed columns with overlapping labels.
    const source = readFileSync('src/features/events/components/QuickActionsGrid.tsx', 'utf8');

    // Act — the tile style block.
    const tile = /tile:\s*\{([\s\S]*?)\n {2}\},/.exec(source)?.[1] ?? '';

    // Assert — a min-width is the only thing that makes flexWrap break rather
    // than squeeze; without it the grid collapses.
    assert.match(tile, /minWidth/, 'the tile has no minimum width and will compress');
    assert.match(tile, /flexWrap|flexGrow/, 'the tile declares no growth/basis');
  });

  test('every tile carries an accessible name', async () => {
    // Act
    const screen = await renderGrid();

    // Assert — react-native-web does not forward `testID`, so `aria-label` is
    // the only thing a screen reader (and this test) can rely on.
    const labels = screen.html.match(/aria-label="[^"]+"/g) ?? [];
    assert.equal(labels.length, 5, `expected 5 accessible names, found ${labels.length}`);
  });
});
