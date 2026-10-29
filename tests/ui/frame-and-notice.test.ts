/**
 * The desktop frame, and the privacy notice's rendered markdown.
 *
 * ★ THE FRAME EXISTS BECAUSE NO SCREEN WAS DESIGNED TO BE 1440px WIDE.
 *
 * Every layout in this product is a phone layout: one column, a header row, a
 * bottom action. Rendered on a desktop the event list becomes a band of text four
 * words wide across the whole window and the sheets stretch until their padding
 * looks like a mistake. The request was to cap the aspect ratio to a phone or
 * tablet at full height, "like Chrome's Responsive view", and to leave phones and
 * tablets alone.
 *
 * ★ THE NOTICE LOST HALF ITS MARKDOWN IN THE RENDERER.
 *
 * The parser was correct. `Bold` existed but was wired only to TABLE cells, so
 * `**…**` in a paragraph came out with its literal asterisks — on the document
 * whose bold text is the operative sentence. Headings shared one margin so the
 * document read as a flat column, bullets had no hanging indent, and the table's
 * every cell was `flex: 1`, so a four-column provider table SHRANK its columns to
 * fit instead of overflowing: one word per line, effectively illegible.
 */

import './support/register';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { FRAME_MAX_WIDTH, TABLET_BREAKPOINT } from '@/src/components/ui/AppFrame';
import { NOTICE_EN } from '@/src/features/privacy/content/notice-en';
import { NOTICE_FA } from '@/src/features/privacy/content/notice-fa';
import { inlineSpans, parseNotice } from '@/src/features/privacy/content/parse-notice';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/* ── The frame ────────────────────────────────────────────────────────────── */

test('the frame caps only at or above the tablet breakpoint', () => {
  // Arrange
  const frame = code('src/components/ui/AppFrame.web.tsx');

  // Act
  const guard = /if \(width < TABLET_BREAKPOINT\) return <>\{children\}<\/>;/.test(frame);

  // Assert — a phone must be a PASS-THROUGH, not a wide wrapper with no styles,
  // so its node tree is byte-identical to before the frame existed.
  assert.ok(guard, 'phones are routed through the frame instead of past it');
  assert.equal(TABLET_BREAKPOINT, 768, 'the tablet breakpoint moved');
});

test('the column is a phone/tablet width at full height', () => {
  // Arrange
  const frame = code('src/components/ui/AppFrame.web.tsx');

  // Act
  const capped = /maxWidth: FRAME_MAX_WIDTH/.test(frame);
  const fullHeight = /height: '100%'/.test(frame);

  // Assert
  assert.ok(capped, 'the column is not capped, so it still stretches to the window');
  assert.ok(fullHeight, 'the column does not fill the height');
  assert.ok(FRAME_MAX_WIDTH > 360 && FRAME_MAX_WIDTH <= 560, `the cap is ${FRAME_MAX_WIDTH}px, not a phone width`);
});

test('the native frame does not exist', () => {
  // Arrange — a phone already fills its own window.
  const frame = code('src/components/ui/AppFrame.tsx');

  // Assert
  assert.ok(/return <>\{children\}<\/>;/.test(frame), 'the native frame wraps the tree');
});

/* ── The notice ───────────────────────────────────────────────────────────── */

test('inline bold is rendered in paragraphs and bullets, not only in table cells', () => {
  // Arrange
  const viewer = code('src/features/privacy/components/NoticeViewer.tsx');

  // Act — `Bold` is the only component that interprets `**…**`, so every block
  // that can contain it has to go through it.
  const paragraphBold = /case 'paragraph':[\s\S]{0,200}?<Bold /.test(viewer);
  const bulletBold = /<Bold text=\{item\}/.test(viewer);
  const cellBold = /<Bold text=\{cell\}/.test(viewer);

  // Assert
  assert.ok(paragraphBold, 'a paragraph renders its asterisks literally');
  assert.ok(bulletBold, 'a bullet renders its asterisks literally');
  assert.ok(cellBold, 'a table cell lost its bold spans');
});

test('every bold span in the shipped notices is understood by the renderer', () => {
  // Arrange — `parseNotice` deliberately LEAVES the delimiters in the block text;
  // `inlineSpans` is what splits them, and `Bold` is the only component that
  // consumes the result. So the assertion belongs on the splitter, not on the
  // parser: a run the splitter cannot see would reach the screen as asterisks.
  for (const [name, markdown] of [
    ['en', NOTICE_EN],
    ['fa', NOTICE_FA],
  ] as const) {
    // Act
    const blocks = parseNotice(markdown);
    const texts = blocks.flatMap((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
          return [block.text];
        case 'bullet':
          return block.items;
        case 'table':
          return [...block.header, ...block.rows.flat()];
        case 'rule':
          return [];
      }
    });

    // Assert — after splitting, NO span still carries a delimiter. That is
    // exactly what the renderer prints.
    let boldSpans = 0;
    for (const text of texts) {
      for (const span of inlineSpans(text)) {
        if (span.bold) boldSpans += 1;
        assert.ok(
          !/\*\*|__/.test(span.text),
          `${name}: a rendered span still carries a delimiter: ${span.text.slice(0, 60)}`,
        );
      }
    }

    assert.ok(blocks.length > 0, `${name}: the notice parsed into nothing`);
    assert.ok(boldSpans > 0, `${name}: no bold span survives, so the document has lost its emphasis`);
  }
});

test('the notice has a table, so the table rendering is load-bearing', () => {
  // Arrange
  const blocks = parseNotice(NOTICE_EN);

  // Act
  const tables = blocks.filter((block) => block.kind === 'table');

  // Assert
  assert.ok(tables.length > 0, 'the English notice has no table, so the overflow path is untested');
});

test('the table scrolls instead of crushing its columns', () => {
  // Arrange
  const viewer = code('src/features/privacy/components/NoticeViewer.tsx');

  // Act
  const scrolls = /horizontal/.test(viewer) && /notice-table-scroll/.test(viewer);
  const minColumn = /minWidth: TABLE_MIN_COLUMN/.test(viewer);
  const noShare = !/tableCell: \{[^}]*flex: 1,/.test(viewer);

  // Assert — `flex: 1` alone divided whatever width was available, which is how
  // four columns became 76pt wide and wrapped to one word per line.
  assert.ok(scrolls, 'the table has no horizontal scroll');
  assert.ok(minColumn, 'the columns have no minimum width, so they still squeeze');
  assert.ok(noShare, 'the cells still share the width instead of overflowing');
});

test('the headings have a per-level rhythm, and the first block has none', () => {
  // Arrange
  const viewer = code('src/features/privacy/components/NoticeViewer.tsx');

  // Act
  const h2 = /heading1: \{ marginTop: space\[6\]/.test(viewer);
  const h3 = /heading2: \{ marginTop: space\[5\]/.test(viewer);
  const first = /first: \{ marginTop: 0 \}/.test(viewer);

  // Assert
  assert.ok(h2, 'an h2 section is not more separated than a paragraph');
  assert.ok(h3, 'an h3 subsection is not more separated than a paragraph');
  assert.ok(first, 'the document starts with a gap it did not ask for');
});

test('a bullet wraps under its text, not under its glyph', () => {
  // Arrange
  const viewer = code('src/features/privacy/components/NoticeViewer.tsx');

  // Act
  const marker = /bulletMarker: \{ width: space\[4\] \}/.test(viewer);
  const hanging = /bulletText: \{ flex: 1 \}/.test(viewer);

  // Assert
  assert.ok(marker, 'the bullet glyph has no fixed column');
  assert.ok(hanging, 'the bullet text does not take the rest of the row');
});

/* ── Settings chrome ──────────────────────────────────────────────────────── */

test('the notice action has air above it', () => {
  // Arrange — it was the last child of a card whose gap is `space[3]`, directly
  // under two caption lines, so the action read as a third line of the text.
  const settings = code('app/settings/index.tsx');

  // Act
  const margin = /noticeAction: \{[^}]*marginTop: space\[4\]/.test(settings);
  const applied = /testID="settings-notice-open"[\s\S]{0,80}?style=\{styles\.noticeAction\}/.test(settings);

  // Assert
  assert.ok(margin, 'the notice action has no top margin');
  assert.ok(applied, 'the margin is declared and never applied');
});
