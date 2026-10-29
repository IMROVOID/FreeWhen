/**
 * A hold on a message opens a MENU, the same one the event rows use.
 *
 * ★ IT USED TO OPEN A SHEET.
 *
 * `BottomSheet` slides a panel up from the foot of the screen, a full scroll away
 * from the message it acts on, so it re-quoted the message at the top to
 * re-establish which one it was. The home screen already answers this question
 * properly — a small menu at the point that was held — and the request is for the
 * same thing here: "instead of an overlay, display a menu similar to the event
 * control menus on the home page".
 *
 * ★ AND THE MESSAGE'S OWN ACTIONS ARE STILL THE ROW'S DECISION.
 *
 * Editing and deleting belong to your own message; reporting belongs to somebody
 * else's. That is the same rule the event menu follows — an action the caller is
 * not allowed to take is ABSENT, not disabled — and it lives in one list rather
 * than in three branches inside the JSX.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const CHAT = code('app/event/[id]/chat.tsx');
const MENU = code('src/components/ui/ContextMenu.tsx');
const EVENT_MENU = code('src/features/events/components/EventContextMenu.tsx');

test('the messages screen renders the shared menu, not a sheet', () => {
  // Act
  const menu = /<ContextMenu\b/.test(CHAT);
  const sheet = /<BottomSheet\b/.test(CHAT);

  // Assert
  assert.ok(menu, 'the messages screen does not render the context menu');
  assert.ok(!sheet, 'the messages screen still opens a bottom sheet');
});

test('the menu sits at the point that was held', () => {
  // Act
  const anchored = /anchor=\{menuAnchor\}/.test(CHAT);
  const pressPoint = /pressPointOf\(/.test(CHAT);
  const measured = /measureInWindow/.test(CHAT);

  // Assert — the same conversion the event row uses, so a web hold (which carries
  // no `locationX`) does not place the menu with `NaN`.
  assert.ok(anchored, 'the menu is not anchored');
  assert.ok(pressPoint, 'the hold’s point is not read');
  assert.ok(measured, 'the bubble is never measured, so the point has no origin');
});

test('the menu is rendered outside the scrolling list', () => {
  // Arrange — a menu laid out against scroll content is positioned against a box
  // taller than the viewport.
  const menuAt = CHAT.indexOf('<ContextMenu');
  const scrollClose = CHAT.lastIndexOf('</ScrollView>');

  // Act / Assert
  assert.ok(menuAt > 0, 'the screen does not render the menu');
  assert.ok(menuAt > scrollClose, 'the menu is rendered inside the scroll view');
});

test('the menu’s two surfaces are one component', () => {
  // Arrange — this is what stops the two screens drifting apart again.
  assert.ok(/export function ContextMenu/.test(MENU), 'there is no shared menu');
  assert.ok(/from '@\/src\/components\/ui\/ContextMenu'/.test(EVENT_MENU), 'the event menu is not the shared one');
  assert.ok(/from '@\/src\/components\/ui\/ContextMenu'/.test(CHAT), 'the message menu is not the shared one');
});

test('a hold on your own message offers edit and delete', () => {
  // Act
  const branch = /if \(mine\)[\s\S]{0,700}?key: 'edit'[\s\S]{0,700}?key: 'delete'/.test(CHAT);

  // Assert
  assert.ok(branch, 'your own message offers no edit or delete');
  assert.ok(/destructive: true/.test(CHAT), 'delete is not painted as destructive');
});

test('a hold on somebody else’s message offers only report', () => {
  // Act
  const branch = /return \[\s*\{\s*key: 'report'/.test(CHAT);
  const reportOpens = /setReporting\(selectedMessage\)/.test(CHAT);

  // Assert
  assert.ok(branch, 'the other-message branch does not offer report alone');
  assert.ok(reportOpens, 'report does not open its sheet');
});

test('the menu surface is the popover, which has no border and pops from its corner', () => {
  // Arrange — the event menu's own contract; the messages screen inherits it by
  // sharing the component rather than copying the markup.
  const usesPopover = /<Popover\b/.test(MENU);
  const popover = code('src/components/ui/Popover.tsx');

  // Act / Assert
  assert.ok(usesPopover, 'the menu does not use the popover surface');
  assert.ok(!/panel:\s*\{[^}]*borderWidth/.test(popover), 'the menu panel paints a border');
  assert.ok(/transformOrigin/.test(popover), 'the menu scales about an unpinned origin');
});

test('closing the menu clears both the message and its anchor', () => {
  // Act
  const closes = /const closeMessageMenu = useCallback\(\(\) => \{[\s\S]{0,160}?setMenuAnchor\(null\)/.test(
    CHAT,
  );

  // Assert
  assert.ok(closes, 'closing the menu leaves the anchor behind, so it re-opens where it was');
});
