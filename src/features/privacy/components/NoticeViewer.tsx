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
 * ★ AND THE TABLE SCROLLS SIDEWAYS INSTEAD OF CRUSHING ITS COLUMNS.
 *
 * It was a `flexDirection: 'row'` of `flex: 1` cells. A table wider than the
 * panel therefore did not overflow — it SHRANK every column to fit, so a
 * third-party provider table with four columns at a 360pt width wrapped each
 * cell to one word per line and was effectively illegible. The columns now have
 * a minimum width and the table scrolls horizontally, which is what a table does
 * everywhere else.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

import { NOTICE_EN } from '../content/notice-en';
import { NOTICE_FA } from '../content/notice-fa';
import { inlineSpans, parseNotice, type NoticeBlock } from '../content/parse-notice';

const NOTICE_BY_LANGUAGE: Record<Language, string> = {
  fa: NOTICE_FA,
  en: NOTICE_EN,
};

/**
 * The narrowest a table column may be before the table scrolls instead.
 *
 * A four-column provider table at 360pt has ~76pt per column, which wraps a
 * provider name onto three lines. 132pt fits the longest cell in the shipped
 * notices on one or two lines.
 */
const TABLE_MIN_COLUMN = 132;

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

      <ScrollView contentContainerStyle={styles.body} testID="notice-body">
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
      return (
        <Card variant="raised" style={[styles.tableCard, first && styles.first]}>
          {/* ★ THE TABLE SCROLLS; IT DOES NOT SQUEEZE.
              `flex: 1` on every cell meant the table shrank to fit the panel, so
              the busiest content on the page became a column of single words. The
              columns name a minimum width and the scroll view carries the
              overflow. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            testID="notice-table-scroll"
            contentContainerStyle={styles.tableScrollBody}
          >
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeaderRow, { borderColor: lineColor }]}>
                {block.header.map((cell, index) => (
                  <Bold text={cell} key={index} variant="caption" style={styles.tableCell} />
                ))}
              </View>
              {block.rows.map((row, rowIndex) => (
                <View key={rowIndex} style={[styles.tableRow, { borderColor: lineColor }]}>
                  {row.map((cell, cellIndex) => (
                    <Bold text={cell} key={cellIndex} variant="caption" style={styles.tableCell} />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      );

    case 'rule':
      return <View style={[styles.rule, { backgroundColor: lineColor }]} />;
  }
}

/** Renders a run of text with its `**bold**` spans weighted. */
function Bold({
  text,
  variant,
  style,
}: {
  text: string;
  variant: 'caption' | 'body';
  style?: object;
}) {
  const spans = inlineSpans(text);

  if (spans.length === 1) {
    return (
      <Text variant={variant} weight={spans[0]!.bold ? 700 : 500} align="start" style={style}>
        {spans[0]!.text}
      </Text>
    );
  }

  return (
    <Text variant={variant} align="start" style={style}>
      {spans.map((span, index) => (
        <Text key={index} variant={variant} weight={span.bold ? 700 : 500}>
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

  tableCard: { padding: space[3], marginTop: space[3] },
  tableScrollBody: { minWidth: '100%' },
  table: { minWidth: '100%' },
  tableRow: {
    flexDirection: 'row',
    gap: space[2],
    paddingVertical: space[2],
    borderBottomWidth: border.hairline,
  },
  tableHeaderRow: { borderBottomWidth: border.strong },
  tableCell: {
    // ★ A MINIMUM, NOT A SHARE.
    //
    // `flex: 1` alone divided whatever width was available, which is how four
    // columns ended up 76pt wide. `minWidth` is what makes the scroll view the
    // thing that resolves the overflow.
    minWidth: TABLE_MIN_COLUMN,
    flexGrow: 1,
    flexShrink: 0,
  },
  rule: { height: border.hairline, marginVertical: space[4], borderRadius: radius.xs },
});
