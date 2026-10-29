/**
 * The web shell: the scrollbar, the focus ring, and a document that hydrates.
 *
 * ★ THE TWO STYLESHEETS WERE ADJACENT TEXT CHILDREN, WHICH THROWS HYDRATION AWAY.
 *
 * `freewhen-canvas` rendered its rules through `dangerouslySetInnerHTML` as a
 * `.join('')` string, and `ScrollViewStyleReset` rendered a `<style>` immediately
 * after it. React's hydration inserts `<!-- -->` separators between adjacent text
 * children, so the client's tree did not match the server's markup and React threw
 * the prerendered document away and client-rendered the app from nothing — which
 * is one full-width, unstyled frame before the desktop clamp appears. One string
 * per `<style>` is the shape that hydrates cleanly, which is also what makes the
 * scrollbar rules below survive.
 *
 * ★ THE SCROLLBAR IS THE LAST UNTHEMED SURFACE ON THE PAGE.
 *
 * A 15px OS trough with step arrows, in the OS's own grey, next to a page made
 * entirely of warm theme tokens. It is drawn thin, from `surface3`/`line`, in both
 * of the two mechanisms that exist — the standard properties and the WebKit
 * pseudo-elements — because no single one covers every browser.
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

const HTML = code('app/+html.tsx');

/* ── The scrollbar ────────────────────────────────────────────────────────── */

test('the scrollbar is thin, in both mechanisms', () => {
  // Act
  const standard = /scrollbar-width:thin/.test(HTML);
  const webkit = /::-webkit-scrollbar\{width:\$\{scrollbarWidth\}px;height:\$\{scrollbarWidth\}px\}/.test(
    HTML,
  );

  // Assert — the standard properties cover Firefox and Chromium 121+, the
  // pseudo-elements cover Safari and older Chromium.
  assert.ok(standard, 'the standard scrollbar properties are not declared');
  assert.ok(webkit, 'the WebKit scrollbar is not declared');
});

test('the scrollbar is drawn from the theme, in both themes', () => {
  // Act
  const thumb = /::-webkit-scrollbar-thumb\{background-color:\$\{dark\.surface3\}/.test(HTML);
  const hover = /::-webkit-scrollbar-thumb:hover\{background-color:\$\{dark\.line\}/.test(HTML);
  const lightThumb = /prefers-color-scheme: light\)\{[\s\S]{0,120}?surface3|light\.surface3/.test(HTML);

  // Assert — a hardcoded grey would be wrong in one of the two themes, which is
  // the defect the default scrollbar has in reverse.
  assert.ok(thumb, 'the thumb is not the theme’s neutral');
  assert.ok(hover, 'the hover state is not the theme’s line colour');
  assert.ok(lightThumb, 'the scrollbar does not follow the light theme');
});

test('the legacy pseudo-elements are guarded so they cannot double up', () => {
  // Act
  const guarded = /@supports not \(scrollbar-width: thin\)\{/.test(HTML);

  // Assert — a browser that supports `scrollbar-width` ignores the pseudo-elements
  // by spec, so this makes the exclusivity explicit instead of relying on it.
  assert.ok(guarded, 'both scrollbar mechanisms can apply at once');
});

test('the scrollbar has no hardcoded pixel size in the document', () => {
  // Act
  const literals = [...HTML.matchAll(/::-webkit-scrollbar[^{]*\{[^}]*?(?<![\w$])\d+px/g)];

  // Assert — the width and the radius live in `palette`, which is the same place
  // every other fixed element size lives.
  assert.deepEqual(literals, [], `the document hardcodes ${literals.length} scrollbar value(s)`);
});

/* ── A document that hydrates ─────────────────────────────────────────────── */

test('each style block is ONE string, so the document can hydrate', () => {
  // Act — the two self-closing `<style … />` elements; an array child would be a
  // set of adjacent text nodes, which is what breaks hydration.
  const styles = [...HTML.matchAll(/<style[^>]*\/>/g)].map((match) => match[0]);
  const arrayed = styles.filter((block) => /__html:\s*\[/.test(block));

  // Assert
  assert.ok(styles.length >= 2, `only ${styles.length} stylesheet(s) found`);
  assert.deepEqual(arrayed, [], 'a stylesheet is emitted from an array, which breaks hydration');
});

test('the canvas and the scrollbar share one declaration', () => {
  // Arrange — the scrollbar lives in the same `<style>` as the canvas, because a
  // second adjacent `<style>` is the hydration defect above.
  const canvas = /<style\s+id="freewhen-canvas"[\s\S]*?\/>/.exec(HTML)?.[0] ?? '';

  // Act / Assert
  assert.ok(/canvasCss/.test(canvas), 'the canvas style block does not render the computed sheet');
  assert.ok(/scrollbar-width/.test(HTML), 'the scrollbar rule is gone');
});

test('the focus ring is still declared, and buttons keep their own', () => {
  // Act / Assert — a WCAG 2.4.7 requirement, and it must not be lost in the
  // refactor that moved these rules into a computed string.
  assert.ok(/:focus-visible\{outline:/.test(HTML), 'the keyboard focus ring is gone');
  assert.ok(
    /button:focus-visible,input:focus-visible,textarea:focus-visible\{outline:none\}/.test(HTML),
    'buttons no longer keep their own focus treatment',
  );
});
