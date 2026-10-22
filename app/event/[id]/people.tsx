/**
 * S13 — the people in this event (Plan 09 Task 13, PRD-11 S13).
 *
 * Two jobs, both privacy-facing:
 *
 *  1. **Show the audience.** Who can see your area is the fact that makes the
 *     disclosure informed (FR-8.8). It is stated here, not buried in settings.
 *  2. **Show what each person shares — honestly.** A `private` member reads as
 *     «موقعیت شما ثبت نشده است.», never as a blank cell that implies a bug. The
 *     coordinate itself is not in this payload at all, for anyone.
 *
 * ★ A MEMBER WITHOUT A LOCATION IS STILL A MEMBER (AC-8.8.1).
 *
 * They appear in the list with no area. Deleting a location removes the
 * coordinate, not the person, and the screen must not imply otherwise — the
 * alternative is a list that quietly loses people who used the privacy control.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { StartPointCard } from '@/src/features/participants/components/StartPointCard';
import { VisibilityToggle } from '@/src/features/participants/components/VisibilityToggle';
import { useStartPoint } from '@/src/features/participants/hooks/useStartPoint';
import { useParticipants } from '@/src/features/participants/hooks/useParticipants';
import { patchProfile } from '@/src/features/participants/services/start-point';
import { getStoredUserId } from '@/src/lib/session';
import type { Language } from '@/src/i18n/types';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function PeopleScreen() {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ id: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';

  const language: Language = i18n.language === 'en' ? 'en' : 'fa';

  const [userId, setUserId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'private' | 'event'>('event');

  useEffect(() => {
    let alive = true;
    void getStoredUserId().then((stored) => {
      if (alive) setUserId(stored);
    });
    return () => {
      alive = false;
    };
  }, []);

  const { participants, isLoading, errorKey, reload } = useParticipants(eventId, userId);

  const startPoint = useStartPoint(eventId, userId);

  const self = participants.find((entry) => entry.is_self);

  // The server is the source of truth for the current value; the local state is
  // only for optimistic feedback between the tap and the reload.
  useEffect(() => {
    if (self) setVisibility(self.start_point_state === 'not_shared' ? 'private' : 'event');
  }, [self]);

  const changeVisibility = useCallback(
    (next: 'private' | 'event') => {
      setVisibility(next);
      void patchProfile(eventId, { visibility: next }, userId)
        .then(() => reload())
        .catch(() => setVisibility((current) => (current === next ? 'event' : current)));
    },
    [eventId, userId, reload],
  );

  const deleteLocation = useCallback(async () => {
    await startPoint.remove();
    await reload();
  }, [startPoint, reload]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[12] },
      ]}
      testID="people"
    >
      <Text variant="h1">{t('privacy.heading')}</Text>

      {/* Your own area: audience, expiry, revoke, and the visibility control. */}
      <View style={styles.section}>
        <StartPointCard
          audience={startPoint.audience}
          visibility={visibility}
          language={language}
          hasStartPoint={startPoint.saved !== null || self?.start_point_state === 'shared'}
          onDelete={deleteLocation}
          deleting={startPoint.status === 'saving'}
          testID="people-start-point"
        />

        <VisibilityToggle
          value={visibility}
          onChange={changeVisibility}
          testID="people-visibility"
        />
      </View>

      {/* The audience itself. */}
      <View style={styles.section}>
        <Text variant="h3">{t('privacy.audienceLabel')}</Text>

        {isLoading && (
          <View style={styles.loading} accessibilityRole="progressbar">
            <ActivityIndicator color={theme.textMuted} />
          </View>
        )}

        {!isLoading && errorKey && (
          <Text variant="body" color="textMuted">
            {t(errorKey)}
          </Text>
        )}

        {!isLoading && !errorKey && participants.length === 0 && (
          <EmptyState title={t('privacy.noStartPoint')} body={t('privacy.shareFootnote')} />
        )}

        {participants.map((entry) => (
          <Card key={entry.id} variant="surface" testID={`people-row-${entry.id}`}>
            <View style={styles.row}>
              <Text variant="body" weight={600} style={styles.name}>
                {entry.display_name}
              </Text>

              <Text variant="caption" color="textMuted">
                {entry.start_point_state === 'not_shared'
                  ? t('privacy.notShared')
                  : entry.start_point_state === 'none'
                    ? t('privacy.noStartPoint')
                    : t('privacy.approxAreaLabel')}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[6] },
  section: { gap: space[3] },
  loading: { marginVertical: space[6], alignItems: 'center' },
  row: { gap: space[1] },
  name: { flexShrink: 1 },
});
