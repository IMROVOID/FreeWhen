/**
 * The web page has a title.
 *
 * ★ THE BUG THIS LOCKS OUT.
 *
 * The static export produced every route with an EMPTY document `<title>`.
 * Three things follow, and all three were visible:
 *
 *  - the browser tab read the URL or nothing at all;
 *  - a bookmarked or shared link showed a raw address;
 *  - a browser history entry had no name, so the back button listed paths.
 *
 * `expo-router`'s static export writes no `<title>` unless the document asks
 * for one, and `app/+html.tsx` asked for a favicon, a manifest and a theme
 * colour but never a title.
 *
 * ★ THE TITLE HAS TO BE PER-DOCUMENT AND STILL PER-LANGUAGE.
 *
 * A single hardcoded string would be wrong for the other shipping language, so
 * the title is resolved from the same catalogue the rest of the page uses.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the served document is titled', () => {
  test('★ the root document renders a <title>', () => {
    // Arrange
    const html = code('app/+html.tsx');

    // Act / Assert
    assert.match(html, /<title>/, 'the document has no title element');
  });

  test('the title comes from the catalogue, not a literal', () => {
    // Arrange
    const html = code('app/+html.tsx');

    // Act / Assert — an English-only literal in a Persian-first product.
    assert.match(
      html,
      /title/i,
      'the title is not resolved',
    );
    assert.ok(
      !/<title>\s*[A-Za-z][^<{]*<\/title>/.test(html),
      'the title is a hardcoded string rather than a resolved one',
    );
  });

  test('both catalogues carry the document title', async () => {
    // Arrange
    const fa = (await import('@/src/i18n/fa.json')).default as Record<string, unknown>;
    const en = (await import('@/src/i18n/en.json')).default as Record<string, unknown>;

    // Act — the same key must exist in both, or one language renders the key.
    const faTitle = readPath(fa, 'web.documentTitle');
    const enTitle = readPath(en, 'web.documentTitle');

    // Assert
    assert.equal(typeof faTitle, 'string', 'the Persian catalogue has no document title');
    assert.equal(typeof enTitle, 'string', 'the English catalogue has no document title');
    assert.notEqual(faTitle, enTitle, 'both languages render the same title');
  });
});

/** Reads `a.b.c` out of a catalogue object. */
function readPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
