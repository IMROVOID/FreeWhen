/**
 * The event page's header carries a way back into the location overlay.
 *
 * ★ THE REPORT.
 *
 * "Add an icon button in the Event page header (on the opposite side of the Back
 * button) that opens the map overlay again, so the user can change or select their
 * location."
 *
 * The sheet existed — `StartPointSheet` — but it was reachable exactly ONCE. The gate
 * asks on the first visit and a skip is remembered, so a participant who declined, or
 * who has since moved, had no path back to the question on the page they were looking
 * at.
 *
 * ★ THE SLOT WAS A SPACER, WHICH IS WHY NOTHING COULD SIT IN IT.
 *
 * `ScreenHeader` reserves a `stepperButton`-wide box on the trailing edge to keep the
 * title centred. The action REPLACES that box, so the title still centres and the
 * control lands where the eye expects it — in both directions, because the header row
 * follows the document.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const HEADER = code('src/components/ui/ScreenHeader.tsx');
const SCREEN = code('app/event/[id]/index.tsx');

/* ── The header ───────────────────────────────────────────────────────────── */

test('the header accepts a trailing action', () => {
  assert.match(HEADER, /export interface HeaderAction/);
  assert.match(HEADER, /action\?: HeaderAction;/);
  assert.match(HEADER, /onPress: \(\) => void;/);
  assert.match(HEADER, /label: string;/);
});

test('the action sits where the spacer was, never beside it', () => {
  // ★ BOTH would push the title off the screen's axis by half a button.
  const trailing = /action \? \(([\s\S]*?)\) : \(\s*<View style=\{styles\.backSpacer\} \/>\s*\)/.exec(
    HEADER,
  );

  assert.ok(trailing, 'the action and the spacer are not a single either/or slot');
});

test('the action is a real control for assistive technology', () => {
  // Assert — an icon alone is silent, and this one opens a permission-shaped question.
  assert.match(HEADER, /accessibilityRole="button"/);
  assert.match(HEADER, /accessibilityLabel=\{action\.label\}/);
  assert.match(HEADER, /testID=\{action\.testID\}/);
});

test('a header with no action still centres its title', () => {
  assert.match(HEADER, /<View style=\{styles\.backSpacer\} \/>/);
});

/* ── The event page ───────────────────────────────────────────────────────── */

test('the event header passes the location control', () => {
  assert.match(SCREEN, /action=\{\{/);
  assert.match(SCREEN, /label: t\('location\.changeLocation'\)/);
  assert.match(SCREEN, /testID: 'event-home-location'/);
});

test('that control reopens the location sheet', () => {
  // Arrange — a control that opens nothing is decoration.
  assert.match(SCREEN, /onPress: \(\) => setLocationSheetVisible\(true\)/);
  assert.match(SCREEN, /const \[locationSheetVisible, setLocationSheetVisible\] = useState\(false\)/);
});

test('the sheet opens for either the first-entry gate or the header', () => {
  assert.match(SCREEN, /visible=\{askForStartPoint \|\| locationSheetVisible\}/);
});

test('closing the header’s sheet does not answer the gate for the user', () => {
  // ★ THE TWO PATHS HAVE OPPOSITE LIFETIMES.
  //
  // The gate's `asked` flag is what stops a skip being re-asked on every visit, so
  // opening and closing the header's sheet must clear only its own flag.
  const dismiss = /onDismiss=\{\(\) => \{([\s\S]*?)\}\}/.exec(SCREEN)?.[1] ?? '';

  assert.ok(dismiss.length > 0, 'the sheet’s dismiss handler is gone');
  assert.match(dismiss, /setLocationSheetVisible\(false\)/);
  assert.match(dismiss, /setStartPointAnswered\(true\)/);
});

test('the sheet is still askable by the gate alone', () => {
  assert.match(SCREEN, /askForStartPoint = shouldOfferStartPoint/);
});
