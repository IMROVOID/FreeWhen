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
import { Alert, I18nManager, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight, SignOut, Trash } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { OfflineBanner } from '@/src/components/states/OfflineBanner';
import { StartPointCard } from '@/src/features/participants/components/StartPointCard';
import { VisibilityToggle } from '@/src/features/participants/components/VisibilityToggle';
import { leaveEvent, removeParticipant } from '@/src/features/events/services/event-management';
import { useStartPoint } from '@/src/features/participants/hooks/useStartPoint';
import { useParticipants } from '@/src/features/participants/hooks/useParticipants';
import { patchProfile } from '@/src/features/participants/services/start-point';
import { useOffline } from '@/src/hooks/useOffline';
import { getStoredUserId } from '@/src/lib/session';
import type { Language } from '@/src/i18n/types';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function PeopleScreen() {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{ id: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';

  const language: Language = i18n.language === 'en' ? 'en' : 'fa';

  const BackIcon = I18nManager.isRTL ? CaretRight : CaretLeft;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: '/event/[id]', params: { id: eventId } });
    }
  };

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
  const { isOffline, pendingCount } = useOffline();

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

  const isOwner = self?.role === 'organizer';

  const handleRemoveParticipant = useCallback(
    (targetParticipantId: string, displayName: string) => {
      Alert.alert(
        t('events.management.removeUserTitle'),
        t('events.management.removeUserBody', { name: displayName }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('events.management.removeUser'),
            style: 'destructive',
            onPress: async () => {
              await removeParticipant(eventId, targetParticipantId, userId);
              await reload();
            },
          },
        ],
      );
    },
    [eventId, reload, t, userId],
  );

  const handleLeaveEvent = useCallback(() => {
    Alert.alert(
      t('events.management.leaveTitle'),
      t('events.management.leaveBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('events.management.leave'),
          style: 'destructive',
          onPress: async () => {
            await leaveEvent(eventId, userId);
            router.replace('/');
          },
        },
      ],
    );
  }, [eventId, router, t, userId]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[12] },
      ]}
      testID="people"
    >
      {isOffline && <OfflineBanner pendingCount={pendingCount} testID="people-offline" />}

      <View style={styles.topHeader}>
        <Pressy
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'بازگشت')}
          style={styles.backButton}
        >
          <View style={[styles.backIconCircle, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            <BackIcon size={20} color={theme.text} weight="bold" />
          </View>
        </Pressy>
        <Text variant="h1">{t('privacy.heading')}</Text>
      </View>

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

        {isLoading && <ListSkeleton rows={2} testID="people-loading" />}

        {!isLoading && errorKey && (
          <ErrorState messageKey={errorKey} onRetry={() => void reload()} testID="people-error" />
        )}

        {!isLoading && !errorKey && participants.length === 0 && (
          <EmptyState
            title={t('states.peopleEmpty')}
            body={t('privacy.shareFootnote')}
            testID="people-empty"
          />
        )}

        {participants.map((entry) => (
          <Card key={entry.id} variant="surface" testID={`people-row-${entry.id}`}>
            <View style={styles.participantRow}>
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

              {isOwner && !entry.is_self && (
                <Button
                  label={t('events.management.removeUser')}
                  onPress={() => handleRemoveParticipant(entry.id, entry.display_name)}
                  variant="ghost"
                  size="small"
                  icon={<Trash size={16} color={theme.danger} />}
                  testID={`remove-participant-${entry.id}`}
                />
              )}
            </View>
          </Card>
        ))}

        {!isOwner && participants.length > 0 && (
          <Button
            label={t('events.management.leave')}
            onPress={handleLeaveEvent}
            variant="danger"
            size="medium"
            icon={<SignOut size={18} color={theme.onDanger} />}
            testID="people-leave-event"
            style={styles.leaveButton}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[6] },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  backButton: {
    padding: space[1],
  },
  backIconCircle: {
    width: size.stepperButton,
    height: size.stepperButton,
    borderRadius: radius.pill,
    borderWidth: border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: space[3] },
  loading: { marginVertical: space[6], alignItems: 'center' },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: { gap: space[1], flex: 1 },
  name: { flexShrink: 1 },
  leaveButton: {
    marginTop: space[4],
  },
});
