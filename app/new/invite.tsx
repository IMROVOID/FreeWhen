/**
 * S3 — the invite share screen (Plan 05 Task 8, PRD-11 S3).
 *
 * Reached immediately after creation, because creating and sharing are one
 * continuous intent: an organizer who has to navigate to find the link is an
 * organizer who shares it late.
 *
 * ★ THE LINK ARRIVES THROUGH NAVIGATION PARAMS, NOT A REFETCH.
 *
 * The server returns the plaintext URL exactly once and cannot hand it back.
 * Passing it here is the only way to show it, and it is why a lost response
 * means a rotation rather than a retrieval.
 */

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { InviteShareCard } from '@/src/features/events/components/InviteShareCard';
import { revokeInvite, rotateInvite } from '@/src/features/events/services/invite';
import { formatDate } from '@/src/lib/format';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

export default function InviteShareScreen() {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ event_id?: string; url?: string; expires_at?: string }>();

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const eventId = typeof params.event_id === 'string' ? params.event_id : '';
  const [url, setUrl] = useState(typeof params.url === 'string' ? params.url : '');
  const [expiresAt, setExpiresAt] = useState(
    typeof params.expires_at === 'string' ? params.expires_at : '',
  );
  const [isBusy, setIsBusy] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const expiresLabel = expiresAt
    ? t('invite.expiresAt', { date: formatDate(expiresAt, locale).primary })
    : '';

  const rotate = useCallback(() => {
    // Rotation is destructive to a URL already in circulation, so it confirms
    // first (FR-1.11).
    Alert.alert(t('invite.rotateTitle'), t('invite.rotateBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('invite.rotate'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setIsBusy(true);
            try {
              const userId = await getStoredUserId();
              const result = await rotateInvite(eventId, userId);
              setUrl(result.invite.url);
              setExpiresAt(result.invite.expires_at);
              setRevoked(false);
            } finally {
              setIsBusy(false);
            }
          })();
        },
      },
    ]);
  }, [eventId, t]);

  const revoke = useCallback(() => {
    Alert.alert(t('invite.revokeTitle'), t('invite.revokeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('invite.revoke'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setIsBusy(true);
            try {
              const userId = await getStoredUserId();
              await revokeInvite(eventId, userId);
              setRevoked(true);
            } finally {
              setIsBusy(false);
            }
          })();
        },
      },
    ]);
  }, [eventId, t]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="invite-share"
    >
      {revoked ? (
        <>
          <InviteShareCard
            url={''}
            expiresLabel={t('invite.revoked')}
            canRevoke={false}
            canRotate={!isBusy}
            onRevoke={revoke}
            onRotate={rotate}
            testID="invite-share-card"
          />
          <Button
            label={t('invite.goToEvent')}
            onPress={() => router.replace(`/event/${eventId}`)}
            variant="primary"
            testID="invite-go-to-event"
            style={styles.action}
          />
        </>
      ) : (
        <>
          <InviteShareCard
            url={url}
            expiresLabel={expiresLabel}
            canRevoke={!isBusy}
            canRotate={!isBusy}
            onRevoke={revoke}
            onRotate={rotate}
            testID="invite-share-card"
          />
          <Button
            label={t('invite.goToEvent')}
            onPress={() => router.replace(`/event/${eventId}`)}
            variant="secondary"
            size="medium"
            testID="invite-go-to-event"
            style={styles.action}
          />
        </>
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
  action: {
    marginTop: space[5],
  },
});
