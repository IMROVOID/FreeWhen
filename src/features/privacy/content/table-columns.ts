/**
 * The privacy notice's table, as shares of one column track.
 *
 * ★ A ROW OF `flex: 1` CELLS IS NOT A TABLE.
 *
 * Each of the notice's rows was its own `flexDirection: 'row'` of cells with
 * `minWidth` + `flexGrow: 1`, which is a wrapped row, not a grid: the leftover
 * width is divided per ROW, so a row whose cells are short and a row whose cells
 * are long resolve to different cell widths — and a header does not share an edge
 * with the cells underneath it. The only thing separating two columns was a fixed
 * `gap`: spacing chosen by hand, not by the content. The report is exact:
 * "align the table content with their headers, not manual spacing between
 * elements of each row, and the spacing between each column should be determined
 * by the widest cell".
 *
 * ★ SO THE COLUMN WIDTHS ARE COMPUTED ONCE, FOR THE WHOLE TABLE.
 *
 * `columnWeights` walks every cell of the table — header included — and gives each
 * column the length of its LONGEST cell. Every cell then declares the same
 * `flexGrow` for its column, so one track is laid out for the header row and all
 * body rows alike. A column is as wide as its widest cell because that is the
 * definition of the weight, not because a number was tuned to look right.
 *
 * Weighting by character count rather than by measured pixels is deliberate: it
 * needs no layout pass, it is identical on both platforms, and it is what makes
 * the rule testable. A Persian notice's longest cell is text, and a text column's
 * natural width really is proportional to its length.
 */

import type { NoticeBlock } from './parse-notice';

/** A column's weight band, so a one-character column cannot be squeezed to nothing. */
export const MIN_COLUMN_WEIGHT = 4;

/**
 * `**bold**` markers are not rendered, so they must not widen a column.
 *
 * Without this a column whose every cell is emphasised would claim two extra
 * characters per cell for glyphs that never reach the screen, and the widest cell
 * would be the visually narrowest one.
 */
function visibleLength(text: string): number {
  return text.replace(/\*\*|__/g, '').trim().length;
}

/**
 * The weight of every column in a table.
 *
 * Returns one entry per column, in reading order. A ragged table (a row with more
 * cells than the header) grows to the widest row; a short row simply names fewer
 * weights and its missing cells render as the empty string, so a malformed row
 * degrades instead of collapsing the grid.
 */
export function columnWeights(block: Extract<NoticeBlock, { kind: 'table' }>): number[] {
  const width = Math.max(block.header.length, ...block.rows.map((row) => row.length), 0);

  const weights = Array.from({ length: width }, () => MIN_COLUMN_WEIGHT);

  const consider = (cell: string, index: number): void => {
    const length = visibleLength(cell);
    if (length > weights[index]!) weights[index] = length;
  };

  block.header.forEach(consider);
  for (const row of block.rows) row.forEach(consider);

  return weights;
}

/** The per-cell `flexGrow` list for one row: its weight, or the floor. */
export function rowWeights(weights: readonly number[], length: number): number[] {
  return Array.from({ length }, (_, index) => weights[index] ?? MIN_COLUMN_WEIGHT);
}

/**
 * The point width of one column.
 *
 * ★ A WEIGHT IS NOT A WIDTH, AND MULTIPLYING ONE BY THE OTHER EXPLODED THE TABLE.
 *
 * The first attempt fed the weights straight into `flexGrow` on a container with
 * `minWidth: '100%'`. That gave the flex container 520pt of free space, the grow
 * factors multiplied each column's INTRINSIC width by that space, and a
 * four-column provider table rendered 1688pt wide inside a 520pt panel — one
 * column taking 992pt of it. The weights were right; the container was wrong.
 *
 * ★ AND A COLUMN'S WIDEST CELL MAY BE A WHOLE PARAGRAPH.
 *
 * The second attempt took the weight literally — a character count times a
 * character width — and the "Why" column, whose longest cell is a sixty-word
 * sentence, claimed 1263pt of a 2203pt table. A width that follows the longest
 * cell with no ceiling stops being a column and becomes a page.
 *
 * So the weight is clamped to its own LONGEST WORD before it becomes a width: a
 * column has to fit its widest word, and its longest SENTENCE is what wraps. That
 * is the rule a text table actually follows, and it keeps every column
 * proportional to its content while keeping the total inside the panel's reach.
 */
export function columnWidthFor(weight: number, longestWord = weight): number {
  const fitted = Math.max(Math.min(weight, longestWord), MIN_WORD_WEIGHT);

  return Math.max(MIN_COLUMN_WIDTH, fitted * CHARACTER_WIDTH + COLUMN_GUTTER);
}

/**
 * The longest single word in a column.
 *
 * This is the column's FLOOR, not its width: a cell wraps at its spaces, so a
 * column never needs to be wider than its widest unbreakable run. See
 * `columnWidthFor`.
 */
export function longestWordIn(block: Extract<NoticeBlock, { kind: 'table' }>, index: number): number {
  const cells = [block.header[index] ?? '', ...block.rows.map((row) => row[index] ?? '')];

  const words = cells.flatMap((cell) =>
    cell
      .replace(/\*\*|__/g, '')
      .split(/[\s\u200c]+/)
      .filter(Boolean),
  );

  return words.reduce((longest, word) => Math.max(longest, word.length), MIN_WORD_WEIGHT);
}

/** The fewest characters a column's track may be derived from. */
const MIN_WORD_WEIGHT = 8;

/** Roughly one character of the notice's caption face, in points. */
const CHARACTER_WIDTH = 7;

/** The air between two columns, in points. */
const COLUMN_GUTTER = 24;

/** The narrowest a column gets, in points. */
export const MIN_COLUMN_WIDTH = 96;
