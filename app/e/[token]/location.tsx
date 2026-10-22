/**
 * S5 — the five-option location picker (Plan 05 Task 10, PRD-11 S5).
 *
 * Reached after the join, never before: the participant is already in, so a
 * denial or a skip costs them nothing they have not already got. That ordering
 * is why FR-1.22 holds without special-casing — the whole feature sits behind a
 * participation that has already happened.
 *
 * ★ THE RATIONALE PRECEDES THE PROMPT, AND THE PROMPT NEVER FIRES UNPROMPTED.
 *
 * `useStartPoint.requestCurrentLocation` is the only caller of
 * `requestForegroundPermissionsAsync`, and every other option works without it.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { LocationPicker } from '@/src/features/participants/components/LocationPicker';
import { useStartPoint } from '@/src/features/participants/hooks/useStartPoint';
import { formatDate } from '@/src/lib/format';
import { getStoredUserId } from '@/src/lib/session';
import { border, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

export default function StartPointScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; event_id?: string }>();

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';
  const eventId = typeof params.event_id === 'string' ? params.event_id : '';

  const [userId, setUserId] = useState<string | null>(null);
  const startPoint = useStartPoint(eventId, userId);

  useEffect(() => {
    void getStoredUserId().then(setUserId);
  }, []);

  const leave = useCallback(() => {
    router.replace(`/event/${eventId}`);
  }, [eventId, router]);

  const isBusy = startPoint.status === 'requesting' || startPoint.status === 'saving';
  const hasPlace = startPoint.saved !== null;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
      ]}
      keyboardShouldPersistTaps="handled"
      testID="start-point-screen"
    >
      {hasPlace && startPoint.saved ? (
        <View style={styles.savedBlock}>
          <Text variant="h1" align="start">
            {t('location.saved')}
          </Text>

          <Card variant="raised" style={styles.areaCard}>
            {/* An approximate AREA, labelled as one — never a pin (FR-8.16). */}
            <Text variant="h3" align="start">
              {t('location.approxArea')}
            </Text>
            <Text variant="body" color={theme.textMuted} align="start">
              {startPoint.saved.label ?? t('location.approxArea')}
            </Text>
            <Text variant="caption" color={theme.textFaint} align="start" numeric>
              {startPoint.saved.lat} , {startPoint.saved.lng}
            </Text>
          </Card>

          {/* Audience, expiry, revoke — the three facts FR-8.9 requires at the
              moment of adding, not buried in Settings. */}
          {startPoint.audience && (
            <View style={[styles.consentBlock, { borderColor: theme.line }]}>
              <Text variant="caption" color={theme.textMuted} align="start" numeric>
                {t('location.audience', { count: startPoint.audience.participant_count })}
              </Text>
              <Text variant="caption" color={theme.textFaint} align="start" numeric>
                {t('location.expiresAt', {
                  date: formatDate(startPoint.audience.expires_at, locale).primary,
                })}
              </Text>
            </View>
          )}

          <Button
            label={t('location.done')}
            onPress={leave}
            variant="primary"
            testID="location-continue"
            style={styles.action}
          />
          <Button
            label={t('location.revoke')}
            onPress={() => void startPoint.remove()}
            variant="danger"
            size="medium"
            testID="location-revoke"
            style={styles.secondary}
          />
        </View>
      ) : (
        <LocationPicker
          onUseCurrent={() => void startPoint.requestCurrentLocation()}
          onSaveManual={(lat, lng, label) => void startPoint.saveManual(lat, lng, label)}
          onSkip={() => {
            startPoint.skip();
            leave();
          }}
          isBusy={isBusy}
          errorKey={startPoint.errorKey}
          testID="location-picker"
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[5],
  },
  savedBlock: {
    gap: space[3],
  },
  areaCard: {
    gap: space[1],
    borderRadius: radius.lg,
  },
  consentBlock: {
    borderTopWidth: border.hairline,
    paddingTop: space[3],
    gap: space[1],
  },
  action: {
    marginTop: space[4],
  },
  secondary: {
    marginTop: space[2],
  },
});
