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
} from '@/src/components/ui/overlay-surface';

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
