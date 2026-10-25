/**
 * S3 — the invite share screen (Plan 05 Task 8, PRD-11 S3).
 *
 * Reached immediately after creation, because creating and sharing are one
 * continuous intent: an organizer who has to navigate to find the link is an
 * organizer who shares it late.
 */

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { InviteShareCard } from '@/src/features/events/components/InviteShareCard';
import { rotateInvite } from '@/src/features/events/services/invite';
import { extractInviteToken } from '@/src/features/events/utils/invite-token';
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
  const params = useLocalSearchParams<{
    event_id?: string;
    url?: string;
    expires_at?: string;
    code?: string;
  }>();

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const eventId = typeof params.event_id === 'string' ? params.event_id : '';
  const [url, setUrl] = useState(typeof params.url === 'string' ? params.url : '');
  const [expiresAt, setExpiresAt] = useState(
    typeof params.expires_at === 'string' ? params.expires_at : '',
  );
  const [isBusy, setIsBusy] = useState(false);

  const inviteCode =
    typeof params.code === 'string' && params.code
      ? params.code
      : url
        ? extractInviteToken(url)
        : null;

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
      <InviteShareCard
        url={url}
        code={inviteCode}
        expiresLabel={expiresLabel}
        canRotate={!isBusy}
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
