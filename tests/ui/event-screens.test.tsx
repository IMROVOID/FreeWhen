/**
 * The event screens carry the controls the review asked for, in the right place.
 *
 * ★ FIVE SEPARATE REPORTS, ONE SCREEN, AND EACH ONE IS A VISIBLE REGRESSION.
 *
 *  1. The event home's six-tile grid held BOTH an app-wide Settings door and a
 *     per-event Management door. Settings is not about this event, so it read
 *     as a seventh event action; it belongs on the app's own home screen.
 *  2. The privacy notice opened INLINE inside Settings, pushing the account
 *     section down the page. It is a document, and every other document in the
 *     product opens in a sheet.
 *  3. The decision band drew a hairline border around a progress pill, which is
 *     the one place the design uses a border where a surface was intended.
 *  4. `DeleteAccountAction` and `DeleteLocationAction` used `variant="ghost"`,
 *     which paints no fill at all — so «حذف حساب من» was bare text where every
 *     other control on the screen is a pill.
 *  5. A sheet mounted with `visible={false}` still rendered its handle, so the
 *     event screen had an expandable, empty overlay at the bottom that the user
 *     could drag up onto an empty panel.
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

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ── 1. Where Settings lives ───────────────────────────────────────────────

describe('Settings is an app door, not an event action', () => {
  test('★ the event grid no longer offers Settings', async () => {
    // Arrange
    const { QuickActionsGrid } = await import(
      '@/src/features/events/components/QuickActionsGrid'
    );

    // Act
    const screen = renderComponent(QuickActionsGrid, {
      onOpenSlots: () => undefined,
      onShare: () => undefined,
      onOpenActivity: () => undefined,
      onOpenChat: () => undefined,
      onOpenManagement: () => undefined,
    });

    // Assert
    assert.equal(
      screen.has('تنظیمات'),
      false,
      'the event grid still has a Settings tile, which is not about this event',
    );
  });

  test('the last tile spans the row it is left on, so no row is half empty', async () => {
    // Arrange
    const { QuickActionsGrid } = await import(
      '@/src/features/events/components/QuickActionsGrid'
    );

    // Act
    const screen = renderComponent(QuickActionsGrid, {
      onOpenSlots: () => undefined,
      onShare: () => undefined,
      onOpenActivity: () => undefined,
      onOpenChat: () => undefined,
      onOpenManagement: () => undefined,
    });

    // Assert — parity of the COUNT is not the invariant; a full row is. With
    // five tiles the fifth must occupy both columns, which react-native-web
    // emits as `flex-basis:100%` (or `width:100%`) on exactly one tile. The
    // old code kept the count even by adding a Settings tile; this keeps the
    // layout right at any count.
    const fullWidthTiles = screen.html.match(/flex-basis:\s*100%/g) ?? [];
    assert.equal(
      fullWidthTiles.length,
      1,
      `expected exactly one full-width tile, found ${fullWidthTiles.length}`,
    );
  });

  test('the event Configuration tile spans the row it is left on', () => {
    // Arrange
    const grid = code('src/features/events/components/QuickActionsGrid.tsx');

    // Act / Assert — with an odd count the LAST tile has to fill the row.
    assert.match(
      grid,
      /wide|fullWidth|flexBasis:\s*'100%'/,
      'the Configuration tile does not widen to fill the row',
    );
  });

  test('★ Settings is reachable from the home screen', () => {
    // Arrange
    const home = code('app/index.tsx');

    // Act / Assert — the tile was the app's only door to `/settings`; removing
    // it without adding another would make the route unreachable again.
    assert.match(home, /\/settings|openSettings|settings/, 'the home screen has no way into Settings');
  });
});

// ── 2. The privacy notice opens in a sheet ────────────────────────────────

describe('the privacy notice opens in an overlay', () => {
  test('★ Settings opens the notice in a sheet, not in the page flow', () => {
    // Arrange
    const settings = code('app/settings/index.tsx');

    // Act / Assert — a `BottomSheet` around the viewer is what the review asked
    // for; rendering `NoticeViewer` inline is what pushed the page down.
    assert.match(settings, /BottomSheet|Sheet/, 'the notice is still rendered inline');
    assert.ok(
      !/<NoticeViewer\b[^>]*\/>/.test(settings) || /BottomSheet/.test(settings),
      'the notice renders straight into the Settings page',
    );
  });

  test('the notice sheet has a way out that is not the drag handle', () => {
    // Arrange
    const settings = code('app/settings/index.tsx');

    // Act / Assert — a mouse user on the web build has no swipe affordance.
    assert.match(settings, /common\.close/, 'the notice sheet has no visible close control');
  });
});

// ── 3. The tally pill has no border ───────────────────────────────────────

describe('the decision band is a surface, not an outlined pill', () => {
  test('★ the band paints no border', () => {
    // Arrange
    const band = code('src/features/voting/components/DecisionStatusBand.tsx');

    // Act
    const block = /band:\s*\{([\s\S]*?)\n {2}\},/.exec(band)?.[1] ?? '';

    // Assert
    assert.ok(!/borderWidth/.test(block), 'the band still draws a border');
    assert.ok(!/borderColor/.test(block), 'the band still declares a border colour');
  });
});

// ── 4. Destructive actions are pills with a surface ───────────────────────

describe('every visible action paints a surface', () => {
  test('★ «حذف حساب من» is not a ghost button', () => {
    // Arrange
    const action = code('src/features/privacy/components/DeleteAccountAction.tsx');

    // Act / Assert — `ghost` paints `transparent`, which is bare text.
    assert.ok(
      !/variant="ghost"/.test(action),
      'the delete-account control is still a ghost button with no background',
    );
  });

  test('the location-deletion control is not a ghost button either', () => {
    // Arrange
    const action = code('src/features/privacy/components/DeleteLocationAction.tsx');

    // Act / Assert
    assert.ok(
      !/variant="ghost"/.test(action),
      'the delete-location control is still a ghost button with no background',
    );
  });

  test('the notice-reading control paints a surface too', async () => {
    // Arrange — «خواندن متن حریم خصوصی» was reported alongside the deletion
    // controls as having no background.
    const settings = code('app/settings/index.tsx');

    // Act — the button that opens the notice.
    const noticeButton = /label=\{[^}]*privacy\.noticeAction[^}]*\}[\s\S]{0,200}?\/>/.exec(
      settings,
    )?.[0] ?? '';

    // Assert
    assert.ok(noticeButton !== '', 'the notice control was not found');
    assert.ok(
      !/variant="ghost"/.test(noticeButton),
      'the notice control is a ghost button with no background',
    );
  });
});

// ── 5. A closed sheet renders nothing ─────────────────────────────────────

describe('a sheet that was never opened draws nothing', () => {
  test('★ the grid sheet only paints while it is visible', () => {
    // Arrange
    const sheet = code('src/components/ui/BottomSheet.tsx');

    // Act / Assert — `@gorhom/bottom-sheet` keeps its handle mounted and its pan
    // gesture live even at `index={-1}`, which left a drag handle on the bottom
    // edge of a page with no sheet open. The component must therefore decide to
    // render NOTHING, and the gate is `mounted` — not merely `visible`, because
    // the close animation still needs the tree.
    assert.match(
      sheet,
      /if\s*\(!visible\s*&&\s*!mounted\)\s*return\s*null/,
      'the sheet renders its handle while closed',
    );
  });

  test('the sheet tracks a mounted flag cleared by its own close callback', () => {
    // Arrange
    const sheet = code('src/components/ui/BottomSheet.tsx');

    // Act / Assert — unmounting on the `visible` prop alone would cut the close
    // animation, so the teardown is driven by `onClose`.
    assert.match(sheet, /onClose=\{handleClose\}/, 'the sheet does not tear down on close');
    assert.match(sheet, /setMounted\(false\)/, 'the sheet never clears its mounted flag');
  });

  test('the sheet still drives itself from the visible prop when it is shown', () => {
    // Arrange
    const sheet = code('src/components/ui/BottomSheet.tsx');

    // Act / Assert — the open must come from `index`, not `snapToIndex`.
    // `handleSnapToIndex` returns silently while the sheet's layout is still
    // being measured, which is exactly the commit its open was requested in, so
    // an imperative call is a no-op with no error and no retry. `index` is
    // applied by the library's own effect once the layout is ready.
    assert.match(sheet, /index=\{openIndex\}/, 'the sheet is not driven by its index');
    assert.match(sheet, /openIndex\s*=/, 'the open index is not derived');
    assert.ok(
      !/\.snapToIndex\(/.test(sheet),
      'the sheet opens imperatively again, which silently does nothing before layout',
    );
  });
});

// ── 6. A back control that is not at the bottom is moved there ────────────

describe('a short page still ends with its way back', () => {
  test('★ the event-home reload failure puts Back at the foot of the page', () => {
    // Arrange
    const home = code('app/event/[id]/index.tsx');

    // Act — the failure branch's Back button.
    const block = /loadErrorKey !== null[\s\S]*?common\.back[\s\S]{0,400}?\/>/.exec(home)?.[0] ?? '';

    // Assert — a back control centred in the viewport floats in the middle of a
    // page with no content; it belongs in the same footer slot as every other
    // primary action, which is what `marginTop: 'auto'` inside a `flex: 1`
    // container achieves.
    assert.ok(block !== '', 'the failure branch lost its Back control');
    assert.match(
      block,
      /marginTop|footer|bottom/i,
      'the Back control floats instead of sitting at the foot of the page',
    );
  });
});
