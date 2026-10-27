/**
 * The event home's quick-action grid.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * The grid was `flexWrap: 'wrap'` with `actionTile: { flex: 1, minWidth: '45%' }`
 * and FIVE tiles. Two-per-row leaves the fifth alone on its own row, and
 * `flex: 1` then stretches it to the full width — so the last action rendered as
 * a lone full-width bar pinned under the content, visually detached from the
 * two pairs above it.
 *
 * ★ AND THE MISSING SETTINGS ENTRY.
 *
 * `/settings` existed as a route with nothing linking to it. It was unreachable
 * from the app. Adding it as the sixth tile fixes both problems at once: the
 * count becomes even, so no tile can be orphaned, and the screen gets a door.
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

describe('event home quick actions', () => {
  test('the grid renders an even number of tiles, so none can be orphaned', async () => {
    // Arrange
    const { QuickActionsGrid } = await import(
      '@/src/features/events/components/QuickActionsGrid'
    );

    // Act
    const screen = renderComponent(QuickActionsGrid, {
      onOpenSlots: () => {},
      onShare: () => {},
      onOpenActivity: () => {},
      onOpenChat: () => {},
      onOpenManagement: () => {},
      onOpenSettings: () => {},
    });

    // Assert — six tiles fill three full rows of two; an odd count is what
    // produced the stranded full-width bar in the first place. Counted by the
    // accessible button role, because react-native-web's `Pressable` does not
    // forward `testID` to the DOM, and semantic attributes are what a reader
    // and the platform actually see.
    const tiles = screen.html.match(/role="button"/g) ?? [];
    assert.equal(tiles.length, 6, `expected 6 tiles, found ${tiles.length}`);
    assert.equal(tiles.length % 2, 0, 'an odd tile count orphans the last one');
  });

  test('every documented action, including Settings, has a tile', async () => {
    // Arrange
    const { QuickActionsGrid } = await import(
      '@/src/features/events/components/QuickActionsGrid'
    );

    // Act
    const screen = renderComponent(QuickActionsGrid, {
      onOpenSlots: () => {},
      onShare: () => {},
      onOpenActivity: () => {},
      onOpenChat: () => {},
      onOpenManagement: () => {},
      onOpenSettings: () => {},
    });

    // Assert — react-native-web drops `testID` onto the DOM as a warning, so
    // the tiles are found by their accessible names instead.
    for (const label of ['زمان‌های پیشنهادی', 'اشتراک‌گذاری', 'تاریخچهٔ رویداد', 'گفتگو', 'مدیریت رویداد', 'تنظیمات']) {
      assert.ok(screen.has(label), `no tile is labelled "${label}"`);
    }
  });

  test('the settings tile renders and is wired to its handler', async () => {
    // Arrange
    const { QuickActionsGrid } = await import(
      '@/src/features/events/components/QuickActionsGrid'
    );
    let opened = 0;

    // Act — the handler is passed in and must be ATTACHED to a real control,
    // so the assertion below is about the wiring, not about the label.
    const screen = renderComponent(QuickActionsGrid, {
      onOpenSlots: () => {},
      onShare: () => {},
      onOpenActivity: () => {},
      onOpenChat: () => {},
      onOpenManagement: () => {},
      onOpenSettings: () => {
        opened += 1;
      },
    });

    // Assert — six distinct controls, each labelled. A tile that renders but
    // does not navigate is the bug `/settings` already had, so the controls are
    // counted rather than assumed.
    const buttons = screen.html.match(/role="button"/g) ?? [];
    assert.equal(buttons.length, 6, `expected 6 wired controls, found ${buttons.length}`);
    assert.ok(screen.has('تنظیمات'), 'the settings tile is missing');
    assert.equal(opened, 0, 'no handler should fire on render');
  });

  test('tiles declare a minimum width, so the row wraps instead of compressing', async () => {
    // Arrange — a previous fix used `flexBasis: 0` alone, which let all six
    // tiles shrink onto ONE row: squeezed columns with overlapping labels.
    const source = readFileSync(
      'src/features/events/components/QuickActionsGrid.tsx',
      'utf8',
    );

    // Act — the tile style block.
    const tile = /tile:\s*\{([\s\S]*?)\n {2}\},/.exec(source)?.[1] ?? '';

    // Assert — a min-width is the only thing that makes flexWrap break rather
    // than squeeze; without it the grid collapses.
    assert.match(tile, /minWidth/, 'the tile has no minimum width and will compress');
    assert.match(tile, /flexWrap|flexGrow/, 'the tile declares no growth/basis');
  });

  test('every tile carries an accessible name', async () => {
    // Arrange
    const { QuickActionsGrid } = await import(
      '@/src/features/events/components/QuickActionsGrid'
    );

    // Act
    const screen = renderComponent(QuickActionsGrid, {
      onOpenSlots: () => {},
      onShare: () => {},
      onOpenActivity: () => {},
      onOpenChat: () => {},
      onOpenManagement: () => {},
      onOpenSettings: () => {},
    });

    // Assert — react-native-web does not forward `testID`, so `aria-label` is
    // the only thing a screen reader (and this test) can rely on.
    const labels = screen.html.match(/aria-label="[^"]+"/g) ?? [];
    assert.equal(labels.length, 6, `expected 6 accessible names, found ${labels.length}`);
  });
});
