/**
 * The long-press menu on an event row: placement, and who sees what.
 *
 * ★ TWO THINGS THAT GO WRONG WITHOUT A TEST AND A SCREENSHOT CANNOT CATCH.
 *
 * 1. PLACEMENT. The menu opens AT THE PRESSED POINT. It used to be positioned
 *    from the row's rect — its `left` was the row's leading edge and its `top`
 *    was under the row — so with a row spanning the whole list the menu was
 *    pinned to the list's edge, which the report describes as "always at the
 *    bottom right (or left), not where I held my finger". A press carries a
 *    point, and the anchor is now that point.
 *
 *    It must also stay reachable: a press near the foot of the screen would put
 *    the menu off the bottom, so it lifts; a press past the trailing edge would
 *    push it off the side, so it pulls back. Each branch is swept, not sampled.
 *
 * 2. OWNERSHIP. "Delete event" shown to a member is a dead end at best and a
 *    permission probe at worst. The two menus are built separately so the member's
 *    menu is exactly the two things they can do.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  MENU_ANCHOR_GAP,
  MENU_EDGE_MARGIN,
  anchorFromPress,
  anchorFromRow,
  placeMenu,
} from '@/src/features/events/services/menu-placement';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const WINDOW = { windowWidth: 390, windowHeight: 800 };
const MENU = { menuWidth: 220, menuHeight: 200 };

/** A press at the middle of a row that starts at `rowTop`. */
function pressInRow(rowTop: number, x = 100, rowHeight = 96) {
  return anchorFromPress({ x: 16, y: rowTop, width: 358, height: rowHeight }, { x, y: rowHeight / 2 });
}

test('the menu opens at the pressed point, not at a corner of the row', () => {
  // Arrange — the finger is a third of the way across the row.
  const anchor = anchorFromPress({ x: 16, y: 200, width: 358, height: 96 }, { x: 120, y: 48 });

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert — the menu's leading edge follows the finger, and its top is at the
  // press rather than under the whole row.
  assert.equal(placement.left, 16 + 120 + MENU_ANCHOR_GAP);
  assert.equal(placement.top, 200 + 48 - MENU_ANCHOR_GAP);
  assert.equal(placement.above, false);
});

test('the horizontal side follows the reading direction', () => {
  // Arrange — a 220px menu in a 390px window cannot fit on both sides of the SAME
  // press, so each direction is given a press where its own reading side has room.
  // That is the honest statement of the rule: the menu opens on the reading side
  // when there is room, and flips when there is not.
  const nearLeading = anchorFromPress({ x: 0, y: 200, width: 358, height: 96 }, { x: 60, y: 48 });
  const nearTrailing = anchorFromPress({ x: 0, y: 200, width: 358, height: 96 }, { x: 300, y: 48 });

  // Act
  const ltr = placeMenu({ anchor: nearLeading, ...WINDOW, ...MENU, rtl: false });
  const rtl = placeMenu({ anchor: nearTrailing, ...WINDOW, ...MENU, rtl: true });

  // Assert — in RTL the menu hangs to the LEFT of the finger, so its item labels
  // read from the same edge the finger is on.
  assert.equal(ltr.left, nearLeading.x + MENU_ANCHOR_GAP);
  assert.equal(rtl.left, nearTrailing.x - MENU.menuWidth - MENU_ANCHOR_GAP);
});

test('a press with no room on its reading side flips, rather than jumping to the margin', () => {
  // Arrange — an RTL press 30px from the leading edge cannot put a 220px menu to
  // its left. Clamping to MENU_EDGE_MARGIN parked it at the far left, which read
  // as the menu jumping across the screen instead of opening at the finger.
  const anchor = anchorFromPress({ x: 0, y: 200, width: 358, height: 96 }, { x: 30, y: 48 });

  // Act
  const rtl = placeMenu({ anchor, ...WINDOW, ...MENU, rtl: true });

  // Assert — it opens on the OTHER side of the press, which still fits.
  assert.equal(rtl.left, anchor.x + MENU_ANCHOR_GAP);
});

test('a press near the trailing edge flips the LTR menu the same way', () => {
  // Arrange
  const anchor = anchorFromPress({ x: 0, y: 200, width: 358, height: 96 }, { x: 360, y: 48 });

  // Act
  const ltr = placeMenu({ anchor, ...WINDOW, ...MENU, rtl: false });

  // Assert
  assert.equal(ltr.left, anchor.x - MENU.menuWidth - MENU_ANCHOR_GAP);
});

test('a press near the foot of the screen lifts the menu', () => {
  // Arrange — the last event in a list.
  const anchor = pressInRow(700);

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert
  assert.equal(placement.above, true, 'the menu stayed below and would be clipped');
  assert.ok(
    placement.top + MENU.menuHeight <= WINDOW.windowHeight - MENU_EDGE_MARGIN + 0.001,
    `the menu runs off the bottom: ${placement.top + MENU.menuHeight}`,
  );
});

test('the menu is always fully inside the viewport, vertically', () => {
  // Arrange — sweep the press from above the top edge to below the bottom one.
  for (let y = -40; y <= WINDOW.windowHeight + 40; y += 8) {
    const anchor = pressInRow(y);

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

test('the menu is always fully inside the viewport, horizontally', () => {
  // Arrange — sweep the press across the row, in both directions.
  for (const rtl of [false, true]) {
    for (let x = -40; x <= 380; x += 10) {
      const anchor = pressInRow(300, x);

      // Act
      const placement = placeMenu({ anchor, ...WINDOW, ...MENU, rtl });

      // Assert
      assert.ok(
        placement.left >= MENU_EDGE_MARGIN - 0.001,
        `rtl=${rtl} x=${x}: the menu starts at ${placement.left}`,
      );
      assert.ok(
        placement.left + MENU.menuWidth <= WINDOW.windowWidth - MENU_EDGE_MARGIN + 0.001,
        `rtl=${rtl} x=${x}: the menu runs off the trailing edge at ${placement.left}`,
      );
    }
  }
});

test('a press in the middle of a tall screen does not flip', () => {
  // Arrange — the menu fits both ways, so it must stay at the press.
  const anchor = pressInRow(300);

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert
  assert.equal(placement.above, false, 'the menu flipped despite fitting at the press');
});

test('a menu taller than the window is still reachable', () => {
  // Arrange — a long action list at a large text scale fits in neither direction.
  const anchor = pressInRow(400);
  const tall = { menuWidth: 220, menuHeight: 900 };

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...tall });

  // Assert — clamped to the top margin rather than placed off-screen.
  assert.equal(placement.top, MENU_EDGE_MARGIN, 'an over-tall menu was not clamped');
});

test('a keyboard or screen-reader anchor lands on the row centre', () => {
  // Arrange
  const row = { x: 16, y: 200, width: 358, height: 96 };

  // Act
  const anchor = anchorFromRow(row);

  // Assert
  assert.equal(anchor.x, row.x + row.width / 2);
  assert.equal(anchor.y, row.y + row.height / 2);
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

test('the row reports WHERE it was pressed, not only which row', () => {
  // Arrange — without the point, the menu has no choice but a corner of the row.
  const row = code('src/features/events/components/EventRow.tsx');

  // Assert
  assert.ok(/pressPointOf/.test(row), 'the row does not convert the press to a point');
  assert.ok(/anchorFromPress/.test(row), 'the row does not convert the press to a window point');
});

test('the press point survives a web event, which has no locationX', async () => {
  // Arrange — a DOM pointer event, as react-native-web feeds `onLongPress`.
  const { pressPointOf } = await import('@/src/features/events/services/menu-placement');

  const domEvent = {
    nativeEvent: {
      pageX: 130,
      pageY: 250,
      target: { getBoundingClientRect: () => ({ left: 10, top: 200 }) },
    },
  };

  // Act
  const point = pressPointOf(domEvent);

  // Assert — the menu was placed with `NaN` before this, so it opened in a fixed
  // place rather than at the finger.
  assert.deepEqual(point, { x: 120, y: 50 });
});

test('a native event is read from its location pair', async () => {
  // Arrange
  const { pressPointOf } = await import('@/src/features/events/services/menu-placement');
  const nativeEvent = { nativeEvent: { locationX: 24, locationY: 18, pageX: 999, pageY: 999 } };

  // Act / Assert — the LOCAL pair wins, because it is relative to the row that
  // reported it.
  assert.deepEqual(pressPointOf(nativeEvent), { x: 24, y: 18 });
});

test('an event with no point at all is reported as no point, never as NaN', async () => {
  // Arrange — a keyboard activation and a screen-reader action carry no coordinate.
  const { pressPointOf } = await import('@/src/features/events/services/menu-placement');

  // Act / Assert
  assert.equal(pressPointOf(undefined), null);
  assert.equal(pressPointOf({}), null);
  assert.equal(pressPointOf({ nativeEvent: {} }), null);
});

test('the anchor conversion never produces NaN for a real press', async () => {
  // Arrange — the reported failure: the menu landed in a fixed place.
  const { anchorFromPress, placeMenu } = await import('@/src/features/events/services/menu-placement');

  const anchor = anchorFromPress(
    { x: 16, y: 200, width: 358, height: 96 },
    { x: 120, y: 48 },
  );

  // Act
  const placement = placeMenu({ anchor, ...WINDOW, ...MENU });

  // Assert
  assert.ok(Number.isFinite(placement.top), 'the menu top is not a number');
  assert.ok(Number.isFinite(placement.left), 'the menu left is not a number');
});

test('the row exposes the menu to a screen reader as an action', () => {
  // Arrange — a hold is not a gesture a screen-reader user performs.
  const row = code('src/features/events/components/EventRow.tsx');

  // Assert
  assert.ok(/accessibilityActions/.test(row), 'the row has no accessibility action');
  assert.ok(/onAccessibilityAction/.test(row), 'the action is never handled');
  assert.ok(/measureInWindow/.test(row), 'the row does not measure itself for placement');
});

test('the menu has no border', () => {
  // Arrange — "also remove the Menu border (on Web and App)".
  const popover = code('src/components/ui/Popover.tsx');
  const panel = /panel:\s*\{([^}]*)\}/.exec(popover)?.[1] ?? '';

  // Assert
  assert.ok(!/borderWidth/.test(panel), 'the menu panel still paints a border');
});

test('the menu opens with a pop, not a fade', () => {
  // Arrange — "replace open fade in animation with Popup animation as well".
  const popover = code('src/components/ui/Popover.tsx');

  // Act
  const scales = /transform:\s*\[\{\s*scale:/.test(popover);
  const fromOrigin = /transformOrigin/.test(popover) || /originX/.test(popover);

  // Assert — a scale about the panel's own centre reads as popping out of the
  // page; the origin has to be pinned or the panel appears to fly in from a
  // corner, which is the "moves to the top right before disappearing" report.
  assert.ok(scales, 'the menu does not scale on open');
  assert.ok(fromOrigin, 'the menu scales about an unpinned origin');
});

test('the menu closes where it opened', () => {
  // Arrange — "it should pop out and close in same place as appears".
  const popover = code('src/components/ui/Popover.tsx');

  // Act — the placement is `placedPoint`, which is the caller's position mapped
  // into the overlay column's coordinates. It must be tested for null and NOT
  // reset to the unplaced parking spot while the exit runs.
  const keepsPosition = /placedPoint === null\s*\?\s*styles\.unplaced\s*:\s*\{/.test(popover);
  const consistentScale = /0\.92 \+ progress\.value \* 0\.08/.test(popover);

  // Assert — the position is NOT reset when the exit runs, and the scale is one
  // expression for both directions, so open and close are mirror images.
  assert.ok(keepsPosition, 'the panel drops its position while closing');
  assert.ok(consistentScale, 'the entrance and the exit use different scale curves');
});
