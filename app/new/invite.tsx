/**
 * S3 — the invite share screen (Plan 05 Task 8, PRD-11 S3).
 *
 * Reached immediately after creation, because creating and sharing are one
 * continuous intent: an organizer who has to navigate to find the link is an
 * organizer who shares it late.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { InviteShareCard } from '@/src/features/events/components/InviteShareCard';
import { rotateInvite } from '@/src/features/events/services/invite';
import { extractInviteToken } from '@/src/features/events/utils/invite-token';
import { isApiFailure } from '@/src/lib/api';
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
  const [actionError, setActionError] = useState<string | null>(null);

  const inviteCode =
    typeof params.code === 'string' && params.code
      ? params.code
      : url
        ? extractInviteToken(url)
        : null;

  const expiresLabel = expiresAt
    ? t('invite.expiresAt', { date: formatDate(expiresAt, locale).primary })
    : '';

  /**
   * Rotate the link.
   *
   * ★ NO CONFIRMATION DIALOG.
   *
   * The old `Alert.alert` asked "are you sure?" in a second window, over a
   * screen that already has one destructive control beside one safe one. The
   * button's own copy is the warning — it is labelled with what it does — and
   * the rotation is recoverable: the previous link stops working, and the new
   * one replaces it on screen immediately. A dialog here cost more than the
   * mistake it prevented.
   */
  const rotate = useCallback(() => {
    void (async () => {
      setIsBusy(true);
      setActionError(null);
      try {
        const userId = await getStoredUserId();
        const result = await rotateInvite(eventId, userId);
        setUrl(result.invite.url);
        setExpiresAt(result.invite.expires_at);
      } catch (error) {
        setActionError(isApiFailure(error) ? error.messageKey : 'errors.unknown');
      } finally {
        setIsBusy(false);
      }
    })();
  }, [eventId]);

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

      {/* The failure replaces the dialog that used to report it. */}
      {actionError !== null && (
        <Text
          variant="caption"
          color={theme.danger}
          accessibilityLiveRegion="polite"
          style={styles.action}
        >
          {t(actionError)}
        </Text>
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
