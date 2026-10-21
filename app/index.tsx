import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/src/components/ui/Text';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Stepper } from '@/src/components/ui/Stepper';
import { formatDate } from '@/src/lib/format';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

/**
 * The Phase 1 landing screen.
 *
 * Its only job is to prove the locale pipeline end to end: a Persian
 * heading from the catalogue, a Jalali date with Persian digits, and a
 * Persian-digit counter — all start-aligned for RTL.
 */
export default function IndexScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(3);

  const locale = i18n.language === 'en' ? 'en' : 'fa';
  const date = formatDate('2026-08-02T12:00:00Z', locale);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[8] },
      ]}
    >
      <Text variant="display" align="start">
        {t('app.jumbo')}
      </Text>
      <Text variant="bodyL" color={theme.textMuted} align="start">
        {t('app.tagline')}
      </Text>

      <Card variant="surface" style={styles.card}>
        <Text variant="h3" align="start">
          {t('app.emptyTitle')}
        </Text>
        <Text variant="body" color={theme.textMuted} align="start">
          {t('app.emptyBody')}
        </Text>

        <Button label={t('app.createEvent')} onPress={() => undefined} variant="primary" />

        <View style={styles.meta}>
          <View style={styles.metaBlock}>
            <Text variant="caption" color={theme.textMuted} align="start">
              {t('app.sampleDate')}
            </Text>
            <Text variant="h3" align="start" numeric>
              {date.primary}
            </Text>
            <Text variant="caption" color={theme.textFaint} align="start" numeric>
              {date.secondary}
            </Text>
          </View>

          <View style={styles.metaBlock}>
            <Text variant="caption" color={theme.textMuted} align="start">
              {t('app.sampleCount')}
            </Text>
            <Stepper
              value={count}
              onChange={setCount}
              min={0}
              max={20}
              label={t('app.sampleParticipants')}
              testID="sample-count"
            />
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
    gap: space[3],
  },
  card: {
    marginTop: space[4],
    gap: space[3],
    borderRadius: radius.lg,
  },
  meta: {
    gap: space[4],
    marginTop: space[2],
  },
  metaBlock: {
    gap: space[1],
    alignItems: 'flex-start',
  },
});
