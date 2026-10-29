/**
 * The privacy notice, readable offline in both languages (Plan 09 Task 9).
 *
 * ★ A PRIVACY POLICY THAT CANNOT BE READ WITHOUT A NETWORK IS A PLATFORM
 * VIOLATION (E10).
 *
 * The text is bundled at build time — `content/notice-{fa,en}.ts`, generated
 * from `assets/privacy/*.md`. Nothing here fetches. In airplane mode this screen
 * renders exactly as it does online.
 *
 * ★ BOTH LANGUAGES SHIP, AND THE OTHER ONE IS ONE TAP AWAY (PRD-08 §12).
 *
 * A consent a person cannot read in their own language is not informed consent.
 * The language follows the app, but the toggle is present regardless — a
 * Persian speaker reading an English UI must still be able to read this in
 * Persian.
 *
 * ★ THE MARKDOWN IS ACTUALLY RENDERED NOW, AND IT WAS NOT.
 *
 * The parser was fine; the RENDERER dropped half of what it produced:
 *
 *  - `Bold` existed but was applied only to TABLE cells, so `**…**` in a
 *    paragraph or a bullet came out with its literal asterisks. On a document
 *    whose bold text is the operative sentence, that is the worst place to lose
 *    it.
 *  - Headings all shared one `marginTop`, so an `h2` section and an `h3`
 *    subsection sat at the same distance from the text above and the document
 *    read as one flat column of paragraphs.
 *  - Bullets had no hanging indent: a wrapped line started under the bullet
 *    glyph rather than under the text, which in a long Persian sentence makes
 *    the list unreadable.
 *  - There was no vertical rhythm between blocks at all — the container's `gap`
 *    was the only separator, so a paragraph and the heading after it were
 *    equally spaced.
 *
 * ★ THE DIRECTION IS THE DOCUMENT'S, NOT EACH STRING'S.
 *
 * `Text` derives its direction from the content's script, which is right for a
 * label and wrong for a document: a Persian section heading that carries no
 * Persian character — a number, a Latin provider's name — rendered `ltr`, so its
 * `align: 'start'` meant LEFT. On a right-to-left page that is a block of text
 * running the wrong way, and it is what the report describes as "titles and some
 * texts are RTL (correct) but some are LTR" — the ones that happened to contain
 * Persian were right. Every block here sets `inheritDirection`, so the whole
 * document follows the language it is being shown in.
 *
 * ★ AND THE TABLE IS A GRID, NOT A ROW OF SHARES.
 *
 * See `content/table-columns.ts`: the column widths are computed once from the
 * widest cell in each column, so a header and the cells beneath it share one
 * track and the column spacing is the content's, not a hand-picked `gap`.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

import { NOTICE_EN } from '../content/notice-en';
import { NOTICE_FA } from '../content/notice-fa';
import { inlineSpans, parseNotice, type NoticeBlock } from '../content/parse-notice';
import { columnWeights, columnWidthFor, longestWordIn } from '../content/table-columns';

const NOTICE_BY_LANGUAGE: Record<Language, string> = {
  fa: NOTICE_FA,
  en: NOTICE_EN,
};

/** Inside the table's card. Replaces the `TABLE_MIN_COLUMN` floor of the old row. */
const TABLE_CELL_PADDING = space[2];

export interface NoticeViewerProps {
  /** The language the app is currently in. */
  language: Language;
  testID?: string;
}

export function NoticeViewer({ language, testID }: NoticeViewerProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  // The notice opens in the app's language; the toggle allows the other.
  const [shown, setShown] = useState<Language>(language);

  const blocks = useMemo(() => parseNotice(NOTICE_BY_LANGUAGE[shown]), [shown]);

  return (
    <View testID={testID} style={styles.root}>
      <View style={styles.switcher}>
        <Button
          label={t('privacy.noticeLanguageFa')}
          variant={shown === 'fa' ? 'primary' : 'secondary'}
          size="small"
          onPress={() => setShown('fa')}
          testID="notice-lang-fa"
          style={styles.switchButton}
        />
        <Button
          label={t('privacy.noticeLanguageEn')}
          variant={shown === 'en' ? 'primary' : 'secondary'}
          size="small"
          onPress={() => setShown('en')}
          testID="notice-lang-en"
          style={styles.switchButton}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        testID="notice-body"
        // The reading direction of the DOCUMENT. Native honours this on the scroll
        // content; the web build reads `dir` from the prop below.
        {...({ dir: shown === 'fa' ? 'rtl' : 'ltr' } as object)}
      >
        {blocks.map((block, index) => (
          <NoticeBlockView
            key={index}
            block={block}
            lineColor={theme.line}
            first={index === 0}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function NoticeBlockView({
  block,
  lineColor,
  first,
}: {
  block: NoticeBlock;
  lineColor: string;
  first: boolean;
}) {
  switch (block.kind) {
    case 'heading':
      return (
        <Text
          variant={block.level === 1 ? 'h2' : 'h3'}
          align="start"
          inheritDirection
          style={[block.level === 1 ? styles.heading1 : styles.heading2, first && styles.first]}
        >
          {block.text}
        </Text>
      );

    case 'paragraph':
      return (
        <Bold text={block.text} variant="body" style={[styles.paragraph, first && styles.first]} />
      );

    case 'bullet':
      return (
        <View style={[styles.bullets, first && styles.first]}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.bulletRow}>
              {/* ★ A HANGING INDENT, NOT A SECOND COLUMN.
                  The bullet is a fixed-width marker and the text takes the rest
                  with `flex: 1`, so a wrapped line starts under the TEXT rather
                  than under the glyph. */}
              <View style={styles.bulletMarker}>
                <Text variant="body" color="textFaint" align="center">
                  {'•'}
                </Text>
              </View>
              <Bold text={item} variant="body" style={styles.bulletText} />
            </View>
          ))}
        </View>
      );

    case 'table':
      return <NoticeTable block={block} lineColor={lineColor} first={first} />;

    case 'rule':
      return <View style={[styles.rule, { backgroundColor: lineColor }]} />;
  }
}

/**
 * One table, as a grid.
 *
 * ★ EVERY ROW IS LAID OUT ON THE SAME COLUMN TRACK.
 *
 * `columnWeights` gives each column the length of its widest cell, and every cell
 * in that column declares that weight as its `flexGrow` — so a header cell and the
 * body cells under it occupy one track by construction, in both directions and on
 * both platforms. The column's width is therefore a function of its widest cell,
 * which is what was asked for, rather than a spacing step chosen by hand.
 *
 * ★ THE TABLE SIZES TO ITS CONTENT, NOT TO THE PANEL AND NOT TO ITSELF.
 *
 * Two attempts failed here, both worth recording:
 *  - `minWidth: '100%'` on the inner table made the SCROLL CONTENT at least the
 *    scroller's width, which handed the flex container 520pt of free space to
 *    distribute — and distributing it by weight multiplied every column's
 *    intrinsic width by several times over. A four-column provider table came out
 *    1688pt wide inside a 520pt panel, with one column 992pt of it.
 *  - `minWidth: 'auto'` (the default) asks the children for their max-content
 *    widths instead, so a column sized as "16% of the free space" is sized as
 *    "16% of a space that no longer exists".
 *
 * So the table is a content-sized grid: `flexBasis: 0` and `flexGrow: weight` with
 * NO min/fixed basis anywhere, and the horizontal `ScrollView` carries whatever
 * does not fit. The columns are then proportional to their widest cells and the
 * overflow scrolls — which is what a table does everywhere else.
 */
function NoticeTable({
  block,
  lineColor,
  first,
}: {
  block: Extract<NoticeBlock, { kind: 'table' }>;
  lineColor: string;
  first: boolean;
}) {
  const weights = useMemo(() => columnWeights(block), [block]);

  const columns = Math.max(weights.length, block.header.length);

  /**
   * The column widths, in points.
   *
   * Derived from the weights rather than from a percentage, so the sum is a real
   * width the scroller can compare against the panel: a unit is roughly a
   * character, and `MIN_COLUMN_WIDTH` keeps the narrowest column readable.
   */
  const widths = useMemo(
    () =>
      Array.from({ length: columns }, (_, index) =>
        columnWidthFor(weights[index] ?? 1, longestWordIn(block, index)),
      ),
    [weights, columns, block],
  );


  return (
    <View style={[styles.tableCard, first && styles.first]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        testID="notice-table-scroll"
      >
        <View style={styles.table} testID="notice-table">
          <View
            style={[styles.tableRow, styles.tableHeaderRow, { borderColor: lineColor }]}
            testID="notice-table-header"
          >
            {Array.from({ length: columns }, (_, index) => (
              <Bold
                key={index}
                text={block.header[index] ?? ''}
                variant="caption"
                weight={700}
                style={{ width: widths[index] }}
              />
            ))}
          </View>

          {block.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.tableRow, { borderColor: lineColor }]}>
              {Array.from({ length: columns }, (_, cellIndex) => (
                <Bold
                  key={cellIndex}
                  text={row[cellIndex] ?? ''}
                  variant="caption"
                  style={{ width: widths[cellIndex] }}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Renders a run of text with its `**bold**` spans weighted. */
function Bold({
  text,
  variant,
  weight,
  style,
}: {
  text: string;
  variant: 'caption' | 'body';
  weight?: 700;
  style?: object;
}) {
  const spans = inlineSpans(text);

  if (spans.length === 1) {
    return (
      <Text
        variant={variant}
        weight={spans[0]!.bold ? 700 : (weight ?? 500)}
        align="start"
        inheritDirection
        style={style}
      >
        {spans[0]!.text}
      </Text>
    );
  }

  return (
    <Text variant={variant} weight={weight} align="start" inheritDirection style={style}>
      {spans.map((span, index) => (
        <Text key={index} variant={variant} weight={span.bold ? 700 : (weight ?? 500)} inheritDirection>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  switcher: {
    flexDirection: 'row',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  },
  switchButton: { flex: 1 },
  body: {
    paddingHorizontal: space[4],
    paddingBottom: space[12],
  },

  /**
   * ★ THE RHYTHM IS PER-LEVEL, NOT ONE NUMBER.
   *
   * `h2` opens a section, so it takes a lot of air above and a little below; `h3`
   * opens a subsection and takes less. A paragraph takes the small step. The
   * first block's top margin is suppressed so the document does not start with a
   * gap it did not ask for.
   */
  heading1: { marginTop: space[6], marginBottom: space[2] },
  heading2: { marginTop: space[5], marginBottom: space[1] },
  paragraph: { marginTop: space[2] },
  first: { marginTop: 0 },

  bullets: { gap: space[2], marginTop: space[2] },
  bulletRow: { flexDirection: 'row', gap: space[2] },
  bulletMarker: { width: space[4] },
  bulletText: { flex: 1 },

  tableCard: {
    marginTop: space[3],
    borderRadius: radius.md,
    // Full-bleed inside the card's rounding, so a sideways scroll has no square
    // corner poking through.
    overflow: 'hidden',
  },
  /**
   * ★ NO `minWidth: '100%'` ANYWHERE IN THIS TABLE.
   *
   * It was the whole defect. The scroller's content and the table both asked to
   * be at least the panel's width, which handed the flex container 520pt of free
   * space; the per-cell grow factors then multiplied every column's intrinsic
   * width by it and the table rendered 1688pt wide — one column 992pt of that.
   * The rows size to the sum of their real column widths now, and the scroller
   * carries whatever does not fit.
   */
  table: {},
  tableRow: {
    flexDirection: 'row',
    // ★ THE COLUMN SPACING IS THE CELL'S OWN WIDTH, NOT A GAP.
    //
    // A `gap` here is a fixed step between columns, so the space between two of
    // them has nothing to do with how wide their content is. Each cell carries
    // its column's computed width (which includes the gutter), so a header and
    // its body cells line up on one track instead of a header's edge landing a
    // gap short of its column.
    paddingVertical: TABLE_CELL_PADDING,
    borderBottomWidth: border.hairline,
  },
  tableHeaderRow: { borderBottomWidth: border.strong },
  rule: { height: border.hairline, marginVertical: space[4], borderRadius: radius.xs },
});
