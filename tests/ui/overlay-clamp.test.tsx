/**
 * The overlays cover the app's column on a desktop, not the browser window.
 *
 * ★ THE FRAME CLAMPED THE ROUTES AND NOTHING CLAMPED THE OVERLAYS.
 *
 * `AppFrame` centres every screen in a phone-width column at or above the tablet
 * breakpoint. Every sheet and menu is a `Modal`, and a modal mounts into
 * react-native-web's portal wrapper — a sibling of the app, not a descendant — so
 * its absolutely-inset root resolved against the whole window and each overlay
 * opened desktop-wide over a phone-sized app. The report is exactly that: "the
 * page is clamped but the overlays are still full desktop width".
 *
 * ★ AND THE PAGE ITSELF WAS WIDE FOR ONE FRAME.
 *
 * `AppFrame` is React, and React does not mount until the fonts resolve, so
 * between first paint and the first frame the document held the prerendered
 * markup — which has no frame. The clamp is therefore also declared in CSS on
 * `#root`, from the same two constants, so it cannot drift.
 */

import './support/register';

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  FRAME_MAX_WIDTH,
  TABLET_BREAKPOINT,
  overlaySurface,
  toSurfacePoint,
} from '@/src/components/ui/overlay-surface';
import { placeMenu, type MenuAnchor } from '@/src/features/events/services/menu-placement';

let renderComponent: typeof import('./support/render').renderComponent;

before(async () => {
  const { initI18n } = await import('@/src/i18n');
  initI18n('fa');
  ({ renderComponent } = await import('./support/render'));
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/* ── The geometry ─────────────────────────────────────────────────────────── */

test('a phone covers its whole window', () => {
  // Arrange — below the breakpoint the window IS the app, so there is nothing to
  // clamp and the overlay's own absolute root must not be disturbed.
  for (const width of [320, 375, 390, 430, 767]) {
    // Act
    const surface = overlaySurface({ width });

    // Assert
    assert.equal(surface.clamped, false, `a ${width}px viewport was clamped`);
    assert.equal(surface.columnWidth, width);
    assert.equal(surface.columnInset, 0);
  }
});

test('a desktop overlay is the frame column, centred', () => {
  // Arrange — the widths a browser is actually used at.
  for (const width of [768, 1024, 1280, 1440, 2560]) {
    // Act
    const surface = overlaySurface({ width });

    // Assert
    assert.equal(surface.clamped, true, `a ${width}px viewport was not clamped`);
    assert.equal(surface.columnWidth, FRAME_MAX_WIDTH, `the overlay is ${surface.columnWidth}px wide`);
    assert.equal(
      surface.columnWidth + surface.columnInset * 2,
      width,
      `the column and its two insets do not add up to ${width}`,
    );
  }
});

test('the inset is symmetric, so the direction cannot mirror it', () => {
  // Arrange — the overlay column is centred, which means one physical number for
  // both edges rather than a leading/trailing pair that a layout flip would swap.
  const surface = overlaySurface({ width: 1280 });

  // Act / Assert
  assert.equal(surface.columnInset, (1280 - FRAME_MAX_WIDTH) / 2);
});

test('the overlay uses the frame’s own constants', () => {
  // Arrange — a second literal here would drift the first time the frame changed.
  const geometry = code('src/components/ui/overlay-surface.ts');

  // Act / Assert
  assert.ok(
    /from '\.\/AppFrame\.web'/.test(geometry),
    'the overlay geometry does not read the frame’s constants',
  );
  assert.equal(FRAME_MAX_WIDTH, 520);
  assert.equal(TABLET_BREAKPOINT, 768);
});

/* ── The surfaces that use it ─────────────────────────────────────────────── */

test('both overlay surfaces render inside the clamp', () => {
  // Arrange — one sheet, one menu. A third overlay that forgot this would be
  // desktop-wide again.
  for (const path of ['src/components/ui/Popover.tsx', 'src/components/ui/BottomSheet.web.tsx']) {
    // Act
    const source = code(path);

    // Assert
    assert.ok(/<OverlaySurface viewportWidth=/.test(source), `${path} does not clamp its overlay`);
  }
});

test('a rendered overlay carries a column of exactly the frame’s width', async () => {
  // Arrange
  const { OverlaySurface } = await import('@/src/components/ui/OverlaySurface');

  // Act — `Modal` renders nothing under `renderToStaticMarkup`, so the surface is
  // rendered directly; that is the node the assertion is about.
  const screen = renderComponent(OverlaySurface, {
    viewportWidth: 1440,
    children: null,
  });

  // Assert — the column is a fixed width with symmetric insets, which is what the
  // frame draws, rather than a cap that content could grow past.
  assert.match(screen.html, /width:\s*520px/, 'the overlay column is not the frame’s width');
  assert.match(
    screen.html,
    /margin-left:\s*460px/,
    'the overlay column is not centred on the window',
  );
  assert.match(screen.html, /overlay-surface-column/, 'the overlay column is not rendered');
});

test('a phone overlay renders no wrapper at all', async () => {
  // Arrange — the window IS the app, so the node tree must be what it was.
  const { OverlaySurface } = await import('@/src/components/ui/OverlaySurface');

  // Act
  const screen = renderComponent(OverlaySurface, { viewportWidth: 390, children: null });

  // Assert
  assert.equal(screen.html, '', 'a phone overlay is wrapped, so its root is not the viewport');
});

/* ── The coordinate space a positioned panel is drawn in ──────────────────── */

/**
 * ★ A MENU ANCHORED AT THE FINGER WAS PAINTED IN THE WRONG SPACE, AND VANISHED.
 *
 * A context menu's position comes from `measureInWindow` (or a DOM pointer's
 * `clientX`), i.e. the VIEWPORT. The panel is an absolutely positioned child of
 * `OverlaySurface`'s column, so its `left` resolves against the COLUMN's edge.
 * Below the tablet breakpoint the two origins coincide, which is why this was
 * invisible on a phone-shaped window — but on a desktop the column is a centred
 * 520px box, and at 1440px wide the old path pushed the panel up to 448px outside
 * it, where the column's `overflow: hidden` clipped it entirely. What was left is
 * a full-bleed scrim over a dimmed page: "the screen turns dark and the focus is
 * taken by the menu but the menu itself doesn't appear".
 */
test('a window point maps into the overlay column', () => {
  // Arrange
  const desktop = overlaySurface({ width: 1440 });

  // Act
  const mapped = toSurfacePoint({ left: 700, top: 120 }, desktop);

  // Assert — the column starts at `columnInset`, so the same physical point is
  // that much further left INSIDE the column.
  assert.equal(mapped.left, 700 - desktop.columnInset);
  assert.equal(mapped.top, 120, 'the vertical axis has no column inset');
});

test('a phone needs no conversion, because the window IS the app', () => {
  // Arrange
  const phone = overlaySurface({ width: 390 });

  // Act
  const mapped = toSurfacePoint({ left: 200, top: 8 }, phone);

  // Assert
  assert.deepEqual(mapped, { left: 200, top: 8 });
});

test('a menu placed against the column stays inside it at every width', () => {
  // Arrange — place the menu against the COLUMN (the fixed path), then confirm
  // the painted panel never crosses the column's edges. The menu is 260 wide,
  // which is what `MENU_ESTIMATED` works out to from the token grid.
  const MENU = { menuWidth: 260, menuHeight: 200 };

  for (const viewportWidth of [390, 768, 900, 1440, 2560]) {
    const surface = overlaySurface({ width: viewportWidth });

    for (const windowX of [0, 20, viewportWidth / 2, viewportWidth - 20, viewportWidth]) {
      // Act
      const anchor: MenuAnchor = {
        x: windowX - surface.columnInset,
        y: 400,
        rowTop: 360,
        rowHeight: 80,
        rowLeft: 0,
        rowWidth: surface.columnWidth,
      };

      const placement = placeMenu({
        ...MENU,
        anchor,
        windowWidth: surface.columnWidth,
        windowHeight: 800,
      });

      // Assert
      assert.ok(
        placement.left >= 0,
        `${viewportWidth}px, press ${windowX}: the menu starts at ${placement.left}`,
      );
      assert.ok(
        placement.left + MENU.menuWidth <= surface.columnWidth,
        `${viewportWidth}px, press ${windowX}: the menu ends at ` +
          `${placement.left + MENU.menuWidth}, past the column (${surface.columnWidth})`,
      );
    }
  }
});

test('the popover positions its panel in the column’s coordinates', () => {
  // Arrange
  const popover = code('src/components/ui/Popover.tsx');

  // Assert — the conversion is applied, and the raw window offset is not.
  assert.match(popover, /toSurfacePoint\(/, 'the panel is placed with unconverted window coordinates');
  assert.match(
    popover,
    /placedPoint/,
    'the converted point is not what reaches the panel style',
  );
});

/**
 * ★ EVERY `View` IS `position: relative; zIndex: 0` IN react-native-web.
 *
 * That is its base style. So a scrim and a panel that are siblings sit at the
 * SAME stacking level and paint in DOM source order — which is not a contract,
 * just a coincidence of the order the JSX happens to be written in. The panel
 * therefore needs a level of its own, or the menu's visibility depends on nothing.
 */
test('the panel is stacked above its own scrim', () => {
  // Arrange
  const popover = code('src/components/ui/Popover.tsx');
  const scrim = /scrim:\s*\{([\s\S]*?)\n {2}\},/.exec(popover)?.[1] ?? '';
  const panel = /panel:\s*\{([\s\S]*?)\n {2}\},/.exec(popover)?.[1] ?? '';

  // Assert
  assert.ok(panel.length > 0, 'the panel style is missing');
  assert.match(panel, /zIndex:\s*1/, 'the panel establishes no stacking level above the scrim');
  assert.match(scrim, /zIndex:\s*0/, 'the scrim has no explicit level');
});

/* ── The document clamp, before React ─────────────────────────────────────── */

test('the document clamps the root before React mounts', () => {
  // Arrange — this is the "full desktop width for a second" report: between first
  // paint and the first React frame, the document held the prerendered markup.
  const html = code('app/+html.tsx');

  // Act
  const media = new RegExp(`min-width:\\$\\{tabletBreakpoint\\}px`).test(html);
  const capped = /#root\{[^}]*max-inline-size:\$\{frameMaxWidth\}px/.test(html);

  // Assert
  assert.ok(media, 'the document clamp is not behind the tablet breakpoint');
  assert.ok(capped, 'the document does not cap #root, so it is wide until React mounts');
});

test('the document clamp and the frame share one number', () => {
  // Arrange — the frame is React; the CSS is not. Two literals would drift.
  const html = code('app/+html.tsx');

  // Act
  const readsFrame = /FRAME_MAX_WIDTH.*TABLET_BREAKPOINT.*from '@\/src\/components\/ui\/AppFrame'/.test(
    html,
  );

  // Assert
  assert.ok(readsFrame, 'the document declares its own copy of the frame’s width');
});
