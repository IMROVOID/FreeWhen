/**
 * The long-press menu on an event row: placement, and who sees what.
 *
 * ★ TWO THINGS THAT GO WRONG WITHOUT A TEST AND A SCREENSHOT CANNOT CATCH.
 *
 * 1. PLACEMENT. A menu anchored under a row is right until the row is near the foot of
 *    the screen — then it is clipped, and the LAST event in a long list becomes the one
 *    you cannot act on. The requirement is explicit: open under the row, above it when
 *    there is not enough room under.
 *
 * 2. OWNERSHIP. "Delete event" shown to a member is a dead end at best and a
 *    permission probe at worst. The two menus are built separately so the member's menu
 *    is exactly the two things they can do.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  MENU_ANCHOR_GAP,
  MENU_EDGE_MARGIN,
  placeMenu,
} from '@/src/features/events/services/menu-placement';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const WINDOW = { windowWidth: 390, windowHeight: 800 };
const MENU = { menuWidth: 220, menuHeight: 200 };

test('a row with room under it opens the menu below', () => {
  // Arrange
  const anchor = { x: 16, y: 200, width: 358, height: 96 };

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert
  assert.equal(placement.above, false, 'the menu opened above a row with room below');
  assert.equal(placement.top, anchor.y + anchor.height + MENU_ANCHOR_GAP);
});

test('a row near the foot of the screen opens the menu ABOVE', () => {
  // Arrange — the last event in a list. Below would overflow the viewport.
  const anchor = { x: 16, y: 700, width: 358, height: 96 };

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert
  assert.equal(placement.above, true, 'the menu stayed below and would be clipped');
  assert.equal(placement.top, anchor.y - MENU_ANCHOR_GAP - MENU.menuHeight);
  assert.ok(placement.top >= 0, `the menu was placed above the viewport top: ${placement.top}`);
});

test('the menu is always fully inside the viewport, vertically', () => {
  // Arrange — sweep the row from the top edge to the bottom one.
  for (let y = -40; y <= WINDOW.windowHeight + 40; y += 8) {
    const anchor = { x: 16, y, width: 358, height: 72 };

    // Act
    const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

    // Assert
    assert.ok(
      placement.top >= MENU_EDGE_MARGIN - 0.001,
      `at y=${y} the menu starts at ${placement.top}, above the margin`,
    );
    assert.ok(
      placement.top + MENU.menuHeight <= WINDOW.windowHeight - MENU_EDGE_MARGIN + 0.001,
      `at y=${y} the menu ends at ${placement.top + MENU.menuHeight}, past the bottom margin`,
    );
  }
});

test('below is preferred, not the roomier side', () => {
  // Arrange — a menu that fits below but has MORE room above. It must still open
  // below: a menu that flips sides for a few pixels of advantage is unpredictable.
  const anchor = { x: 16, y: 300, width: 358, height: 72 };

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert
  assert.equal(placement.above, false, 'the menu flipped above despite fitting below');
});

test('the menu is pulled back inside the viewport, horizontally', () => {
  // Arrange — a row at the trailing edge of a narrow window.
  const anchor = { x: 340, y: 200, width: 40, height: 96 };

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert
  assert.ok(
    placement.left + MENU.menuWidth <= WINDOW.windowWidth - MENU_EDGE_MARGIN + 0.001,
    `the menu runs off the trailing edge: left=${placement.left}`,
  );
  assert.ok(placement.left >= MENU_EDGE_MARGIN - 0.001, `the menu starts at ${placement.left}`);
});

test('a menu taller than the window is still reachable', () => {
  // Arrange — a long action list at a large text scale fits in neither direction.
  const anchor = { x: 16, y: 400, width: 358, height: 72 };
  const tall = { menuWidth: 220, menuHeight: 900 };

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...tall });

  // Assert — clamped to the top margin rather than placed off-screen.
  assert.equal(placement.top, MENU_EDGE_MARGIN, 'an over-tall menu was not clamped');
});

test('a member sees only the two actions they can take', async () => {
  // Arrange
  const { contextMenuActions } = await import('@/src/features/events/services/context-menu-actions');

  // Act
  const keys = contextMenuActions(false).map((action) => action.key);

  // Assert
  assert.deepEqual(keys, ['leave', 'location']);
  assert.ok(!keys.includes('delete'), 'a non-owner is offered delete');
  assert.ok(!keys.includes('configure'), 'a non-owner is offered configuration');
});

test('the owner sees configuration and delete as well', async () => {
  // Arrange
  const { contextMenuActions } = await import('@/src/features/events/services/context-menu-actions');

  // Act
  const keys = contextMenuActions(true).map((action) => action.key);

  // Assert
  assert.deepEqual(keys, ['leave', 'location', 'configure', 'delete']);
});

test('the two irreversible actions are painted as destructive', async () => {
  // Arrange
  const { contextMenuActions } = await import('@/src/features/events/services/context-menu-actions');

  // Act
  const destructive = contextMenuActions(true)
    .filter((action) => action.destructive)
    .map((action) => action.key);

  // Assert
  assert.deepEqual(destructive.sort(), ['delete', 'leave']);
});

test('every action has a catalogued label', async () => {
  // Arrange — a dotted key rendered verbatim means the translation is missing.
  const { contextMenuActions } = await import('@/src/features/events/services/context-menu-actions');
  const { resources } = await import('@/src/i18n');

  for (const language of ['en', 'fa'] as const) {
    const catalogue = resources[language].translation as unknown as {
      events?: { contextMenu?: Record<string, string> };
    };

    // Act
    const table = catalogue.events?.contextMenu ?? {};

    // Assert
    for (const action of contextMenuActions(true)) {
      const leaf = action.labelKey.split('.').pop() ?? '';
      assert.equal(typeof table[leaf], 'string', `${language}: missing ${action.labelKey}`);
    }
  }
});

test('delete is confirmed before it happens', () => {
  // Arrange — the one action on the list screen that cannot be undone.
  const home = code('app/index.tsx');

  // Assert
  assert.ok(/ConfirmSheet/.test(home), 'deletion is not confirmed');
  assert.ok(
    /setPendingDeleteId/.test(home),
    'the delete runs on the menu tap rather than through a confirmation',
  );
});

test('the menu is rendered outside the scrolling list', () => {
  // Arrange — a menu laid out against scroll content is positioned against a box taller
  // than the viewport, which is the trap `BottomSheet.tsx` documents.
  const home = code('app/index.tsx');

  // Act
  const menuAt = home.indexOf('<EventContextMenu');
  const scrollCloseAt = home.lastIndexOf('</ScrollView>');

  // Assert
  assert.ok(menuAt > 0, 'the home screen does not render the menu');
  assert.ok(menuAt < scrollCloseAt, 'the menu is rendered after the scroll view closes');
});

test('the row exposes the menu to a screen reader as an action', () => {
  // Arrange — a hold is not a gesture a screen-reader user performs.
  const row = code('src/features/events/components/EventRow.tsx');

  // Assert
  assert.ok(/accessibilityActions/.test(row), 'the row has no accessibility action');
  assert.ok(/onAccessibilityAction/.test(row), 'the action is never handled');
  assert.ok(/measureInWindow/.test(row), 'the row does not measure itself for placement');
});
