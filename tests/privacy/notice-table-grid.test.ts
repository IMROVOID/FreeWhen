/**
 * The notice's table is a grid, and the whole document follows one direction.
 *
 * ★ THE TABLE'S COLUMNS WERE SPACED BY HAND AND ITS CELLS NEVER LINED UP.
 *
 * Every row was its own `flexDirection: 'row'` of `minWidth` + `flexGrow: 1` cells.
 * That is a wrapped row, not a grid: the leftover width is divided PER ROW, so a
 * row whose cells are short and a row whose cells are long resolve to different
 * cell widths, and a header does not share an edge with the cells underneath it.
 * The only thing separating two columns was a fixed `gap`. The request is exact:
 * align the cells with their headers, do not hand-space a row, and let the spacing
 * between columns be the widest cell's width.
 *
 * ★ AND HALF THE PERSIAN NOTICE RAN LEFT-TO-RIGHT.
 *
 * `Text` derives `dir` from the content's own script, which is right for a label
 * and wrong for a document: a heading or paragraph with no Persian character in it
 * — a numbered section, a Latin provider name — resolved to `ltr`, so its
 * `align: 'start'` meant LEFT. The blocks that happened to contain Persian ran
 * correctly, which is exactly the "titles and some texts are RTL (correct) but some
 * are LTR" report.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { NOTICE_EN } from '@/src/features/privacy/content/notice-en';
import { NOTICE_FA } from '@/src/features/privacy/content/notice-fa';
import { parseNotice, type NoticeBlock } from '@/src/features/privacy/content/parse-notice';
import {
  MIN_COLUMN_WEIGHT,
  columnWeights,
  columnWidthFor,
  longestWordIn,
  rowWeights,
} from '@/src/features/privacy/content/table-columns';

let renderComponent: typeof import('../ui/support/render').renderComponent;

function firstTable(markdown: string): Extract<NoticeBlock, { kind: 'table' }> {
  const table = parseNotice(markdown).find((block) => block.kind === 'table');
  assert.ok(table, 'the notice has no table');
  return table as Extract<NoticeBlock, { kind: 'table' }>;
}

/* ── The weights ──────────────────────────────────────────────────────────── */

test('a column is as wide as its widest cell, header included', () => {
  // Arrange
  const table: Extract<NoticeBlock, { kind: 'table' }> = {
    kind: 'table',
    header: ['Name', 'Rate limiting policy'],
    rows: [
      ['Acme', 'None'],
      ['A much longer provider', '15 minutes'],
    ],
  };

  // Act
  const weights = columnWeights(table);

  // Assert
  assert.equal(weights.length, 2);
  assert.equal(weights[0], 'A much longer provider'.length);
  assert.equal(weights[1], 'Rate limiting policy'.length);
});

test('a short column is floored, so it cannot be squeezed to nothing', () => {
  // Arrange
  const table: Extract<NoticeBlock, { kind: 'table' }> = {
    kind: 'table',
    header: ['#', 'Provider'],
    rows: [['1', 'CARTO']],
  };

  // Act
  const weights = columnWeights(table);

  // Assert
  assert.equal(weights[0], MIN_COLUMN_WEIGHT);
});

test('bold markers do not widen a column', () => {
  // Arrange — `**…**` never reaches the screen, so it must not claim width.
  const plain: Extract<NoticeBlock, { kind: 'table' }> = {
    kind: 'table',
    header: ['Provider'],
    rows: [['CARTO']],
  };
  const bolded: Extract<NoticeBlock, { kind: 'table' }> = {
    kind: 'table',
    header: ['**Provider**'],
    rows: [['**CARTO**']],
  };

  // Act / Assert
  assert.deepEqual(columnWeights(bolded), columnWeights(plain));
});

test('every row of a table resolves to the same weight vector', () => {
  // Arrange — this is the alignment contract: one track for the header and every
  // body row, whatever each row's own content is.
  for (const markdown of [NOTICE_EN, NOTICE_FA]) {
    const table = firstTable(markdown);
    const weights = columnWeights(table);
    const columns = Math.max(weights.length, table.header.length);

    // Act
    const header = rowWeights(weights, columns);
    const bodies = table.rows.map(() => rowWeights(weights, columns));

    // Assert
    assert.deepEqual(header, bodies[0]);
    for (const body of bodies) assert.deepEqual(body, header);
    assert.equal(header.length, columns);
  }
});

test('a ragged row names a weight for every column', () => {
  // Arrange — a malformed row must degrade, not collapse the grid.
  const table: Extract<NoticeBlock, { kind: 'table' }> = {
    kind: 'table',
    header: ['A', 'B', 'C'],
    rows: [['only one']],
  };

  // Act
  const weights = columnWeights(table);
  const row = rowWeights(weights, 3);

  // Assert
  assert.equal(row.length, 3);
  assert.ok(row.every((weight) => Number.isFinite(weight) && weight > 0));
});

test('the widest cell of each shipped notice is what sets its column', () => {
  // Arrange — "spacing between each Table column should be determined by widest
  // Cell". Asserted on the real documents, not a fixture.
  for (const markdown of [NOTICE_EN, NOTICE_FA]) {
    const table = firstTable(markdown);
    const weights = columnWeights(table);
    const columns = weights.length;

    // Act — the longest visible cell in each column, computed independently.
    for (let index = 0; index < columns; index += 1) {
      const cells = [table.header[index] ?? '', ...table.rows.map((row) => row[index] ?? '')];
      const longest = Math.max(...cells.map((cell) => cell.replace(/\*\*|__/g, '').trim().length));

      // Assert
      assert.equal(
        weights[index],
        Math.max(MIN_COLUMN_WEIGHT, longest),
        `column ${index} is not its widest cell`,
      );
    }
  }
});

/* ── The rendered table ───────────────────────────────────────────────────── */

test('the rendered header and rows carry the same per-column widths', async () => {
  // Arrange
  const { NoticeViewer } = await import('@/src/features/privacy/components/NoticeViewer');
  const { renderComponent: render } = await import('../ui/support/render');
  renderComponent = render;

  // Act
  const screen = renderComponent(NoticeViewer, { language: 'fa', testID: 'notice' });

  // Assert — every cell states its COLUMN's width, so the header and the body
  // share one track. A cell that sized itself would be a row of shares again,
  // which is the defect the report describes. Only the table's own markup is
  // scanned: other surfaces in the tree legitimately carry a `width`.
  const tableHtml = /data-testid="notice-table"([\s\S]*?)$/.exec(screen.html)?.[1] ?? '';
  const widths = [...tableHtml.matchAll(/width:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  assert.ok(widths.length > 0, 'the cells declare no width, so the columns are not sized');

  const table = firstTable(NOTICE_FA);
  const columns = Math.max(columnWeights(table).length, table.header.length);
  const expected = columnWeights(table).map((weight, index) =>
    columnWidthFor(weight, longestWordIn(table, index)),
  );

  assert.equal(widths.length, columns * (1 + table.rows.length), 'not every cell is sized');
  for (let index = 0; index < widths.length; index += 1) {
    assert.equal(widths[index], expected[index % columns], `cell ${index} left its column track`);
  }
});

/* ── Direction ────────────────────────────────────────────────────────────── */

test('a Latin-only block in the Persian notice renders right-to-left', async () => {
  // Arrange — the reported defect. `inheritDirection` is what makes a document take
  // its direction from the language rather than from each string's script.
  const { Text } = await import('@/src/components/ui/Text');
  const { renderMarkup, createElement } = await import('../ui/support/render');
  const { initI18n } = await import('@/src/i18n');
  initI18n('fa');

  // Act
  const asProse = renderMarkup(createElement(Text, { inheritDirection: true }, 'Provider'));
  const asLabel = renderMarkup(createElement(Text, {}, 'Provider'));

  // Assert — the label keeps the content-script rule; the prose follows the page.
  assert.match(asProse.html, /dir="rtl"/, 'a Latin-only prose block is still LTR in a Persian document');
  assert.match(asLabel.html, /dir="ltr"/, 'the label rule was changed for every Text in the app');
  assert.match(asProse.html, /text-align:\s*right/, 'the prose block is still left-aligned in Persian');
});

test('every notice block opts into the document direction', async () => {
  // Arrange
  const viewer = readFileSync('src/features/privacy/components/NoticeViewer.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Act — every `<Text` in the document's body either carries `inheritDirection` or
  // is the bullet glyph, which is a centred dot.
  const texts = [...viewer.matchAll(/<Text\b[\s\S]{0,160}?>/g)].map((m) => m[0]);
  const missing = texts.filter(
    (element) => !/inheritDirection/.test(element) && !/align="center"/.test(element),
  );

  // Assert
  assert.deepEqual(missing, [], 'a notice block still derives its own direction');
});

test('the document container states the direction as a prop, not a style', async () => {
  // Arrange — react-native-web ignores `writingDirection` in a style and reads `dir`
  // from the prop, which is the same rule the whole app follows.
  const viewer = readFileSync('src/features/privacy/components/NoticeViewer.tsx', 'utf8');

  // Act / Assert
  assert.ok(/\{\s*\.\.\.\(\{\s*dir:/.test(viewer), 'the notice body does not declare a DOM `dir`');
  assert.ok(!/writingDirection:/.test(viewer), 'the notice relies on a style the renderer drops');
});

/* ── The card ─────────────────────────────────────────────────────────────── */

test('the table is not drawn inside a bordered card', () => {
  // Arrange — the bordered box sat inside a document with no other rules, and the
  // card's own edge has been removed everywhere else.
  const viewer = readFileSync('src/features/privacy/components/NoticeViewer.tsx', 'utf8');

  // Act
  const tableCard = /tableCard:\s*\{([^}]*)\}/.exec(viewer)?.[1] ?? '';

  // Assert
  assert.ok(!/borderWidth/.test(tableCard), 'the table still draws a border');
  assert.ok(!/<Card\b/.test(viewer), 'the table is still wrapped in a Card, which brings its own surface');
});
