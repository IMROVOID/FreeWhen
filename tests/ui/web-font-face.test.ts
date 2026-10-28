/**
 * Every font family the app names must have an `@font-face` in the document HEAD.
 *
 * ★ THE DEFECT THIS PINS.
 *
 * `Input` sets `fontFamily` on a `TextInput`, which is a real `<input>` on web. The
 * family only resolves if an `@font-face` with that exact name exists.
 *
 * `expo-font`'s web loader does emit those rules — but it appends
 * `<style id="expo-generated-fonts">` at the END OF THE DOCUMENT, after `</body>`.
 * The join screen's `کد یا نشانی دعوت` box is prerendered by static export, so its
 * inline `fontFamily: PlusJakartaSans_500Medium` was parsed long before that style
 * block existed, and the field painted in the browser's default face.
 *
 * That is why the missing font showed up on text BOXES specifically and not on
 * labels: `Text` renders through the same family names, but labels in the served
 * markup sit in elements whose text the browser resolves at first layout of the
 * body, while the `<input>` had already committed to a fallback.
 *
 * The fix is to declare the faces in `<head>`, ahead of the app's markup, so the
 * families exist before first paint and for the prerendered document.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('every family the app names has a face declared in the document head', async () => {
  // Arrange — the families are generated from `fonts`, so the assertion runs on the
  // generated block rather than on the document's source text.
  const { fontFaceCss } = await import('@/src/theme/web-font-face');
  const { fonts } = await import('@/src/theme/fonts');

  const vazirmatn = Object.fromEntries(
    Object.values(fonts.persian).map((family) => [family, `/f/${family}.ttf`]),
  );
  const vazirmatnFd = Object.fromEntries(
    ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'].map((w) => [
      `VazirmatnFD-${w}`,
      `/f/VazirmatnFD-${w}.ttf`,
    ]),
  );

  // Act
  const css = fontFaceCss({ vazirmatn, vazirmatnFd });

  // Assert — the two families that actually render text, every weight.
  //
  // `fonts.persianDigits` is deliberately excluded: Persian numerals are produced by
  // `toPersianDigits` in code, not by a family, and nothing renders with it.
  const families = [...Object.values(fonts.latin), ...Object.values(fonts.persian)];

  for (const family of families) {
    assert.ok(css.includes(`font-family:"${family}"`), `"${family}" has no @font-face`);
  }
});

test('the head font block is generated from the font module, not hand-copied', async () => {
  // Arrange — a literal list would drift the moment a weight is added, which is
  // exactly how this class of bug returns.
  const html = code('app/+html.tsx');

  // Assert
  assert.ok(/font-assets|vazirmatnFonts|fonts\b/.test(html), 'the document head does not read the font module');
  assert.ok(/fontFaceCss/.test(html), 'the document head does not build faces from the font module');
});

test('the head font block appears before the app markup', async () => {
  // Arrange — the rules themselves are generated in `web-font-face.ts`, so what the
  // document has to prove is that it INLINES them, and does so inside `<head>`.
  const html = code('app/+html.tsx');

  // Act
  const fontAt = html.indexOf('fontFaceCss');
  const headEnd = html.indexOf('</head>');
  const bodyAt = html.indexOf('<body');

  // Assert — a face declared after the body is the bug being fixed.
  assert.ok(fontAt > 0, 'the document does not inline the generated font faces');
  assert.ok(headEnd > 0, 'no head found');
  assert.ok(bodyAt > 0, 'no body found');
  assert.ok(fontAt < headEnd, 'the font faces are rendered outside <head>');
  assert.ok(fontAt < bodyAt, 'the font faces are declared after the body');
});

test('the generated block declares a url for every family it names', async () => {
  // Arrange — the rules are built at render time from the font modules, so the
  // assertion belongs on the output rather than on the document's source text.
  // `font-assets.ts` cannot load `.ttf` under Node, so the asset map is stubbed
  // with the shape Metro produces.
  const { fontFaceCss } = await import('@/src/theme/web-font-face');
  const { fonts } = await import('@/src/theme/fonts');

  const vazirmatn = Object.fromEntries(
    Object.values(fonts.persian).map((family) => [
      family,
      { uri: `/assets/assets/fonts/${family}.abc123.ttf` },
    ]),
  );

  // Act
  const css = fontFaceCss({ vazirmatn, vazirmatnFd: {} });

  // Assert — one face per Persian weight, and each carries a real file.
  for (const family of Object.values(fonts.persian)) {
    const rule = new RegExp(`@font-face\\{font-family:"${family}";src:url\\("[^"]+"\\)\\}`).test(css);
    assert.ok(rule, `"${family}" has no face with a url`);
  }

  // A face pointing at an empty url is worse than no face: it stops the browser
  // falling back to a family that works.
  assert.ok(!/url\(""\)/.test(css), 'a face was emitted with an empty url');
  assert.ok(/\.ttf/.test(css), 'no font files referenced');
});

test('a missing asset is skipped rather than emitted pointing nowhere', async () => {
  // Arrange
  const { fontFaceCss } = await import('@/src/theme/web-font-face');
  const { fonts } = await import('@/src/theme/fonts');

  // Act — one family resolves, the rest do not.
  const only = fonts.persian[400];
  const css = fontFaceCss({ vazirmatn: { [only]: '/a.ttf' }, vazirmatnFd: {} });

  // Assert
  assert.ok(css.includes(only), 'the resolvable family was dropped');
  assert.ok(!/url\(""\)/.test(css), 'an empty-url face was emitted');
});
