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
          <NoticeBlockView key={index} block={block} lineColor={theme.line} />
        ))}
      </ScrollView>
    </View>
  );
}

function NoticeBlockView({ block, lineColor }: { block: NoticeBlock; lineColor: string }) {
  switch (block.kind) {
    case 'heading':
      return (
        <Text variant={block.level === 1 ? 'h2' : 'h3'} style={styles.heading}>
          {block.text}
        </Text>
      );

    case 'paragraph':
      return (
        <Text variant="body" style={styles.paragraph}>
          {block.text}
        </Text>
      );

    case 'bullet':
      return (
        <View style={styles.bullets}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.bulletRow}>
              <Text variant="body" color="textFaint">
                {'•'}
              </Text>
              <Text variant="body" style={styles.bulletText}>
                {item}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'table':
      return (
        <Card variant="raised" style={styles.tableCard}>
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
        </Card>
      );

    case 'rule':
      return <View style={[styles.rule, { backgroundColor: lineColor }]} />;
  }
}

/** Renders a cell or a run of text with its `**bold**` spans weighted. */
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
      <Text variant={variant} weight={spans[0]!.bold ? 700 : 500} style={style}>
        {spans[0]!.text}
      </Text>
    );
  }

  return (
    <Text variant={variant} style={style}>
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
    gap: space[3],
  },
  heading: { marginTop: space[4] },
  paragraph: { marginTop: space[1] },
  bullets: { gap: space[2] },
  bulletRow: { flexDirection: 'row', gap: space[2] },
  bulletText: { flex: 1 },
  tableCard: { padding: space[3] },
  table: { gap: 0 },
  tableRow: {
    flexDirection: 'row',
    gap: space[2],
    paddingVertical: space[2],
    borderBottomWidth: border.hairline,
  },
  tableHeaderRow: { borderBottomWidth: border.strong },
  tableCell: { flex: 1 },
  rule: { height: border.hairline, marginVertical: space[4], borderRadius: radius.xs },
});
