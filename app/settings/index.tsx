/**
 * S15 — Settings (Plan 09 Task 13).
 *
 * Language, the privacy notice, what is retained and for how long, and the two
 * deletion controls. This is the screen Apple's reviewers look for: in-app
 * account deletion (§5.1.1(v)) and an offline-readable notice must both be
 * reachable from here without a network round trip.
 *
 * ★ THE NOTICE OPENS FROM THE BUNDLE, NOT FROM THE VPS.
 *
 * Phase 12 also serves it over HTTP, but that is for the store listing link.
 * The in-app copy must render in airplane mode (E10), so it never fetches.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'phosphor-react-native';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Pressy } from '@/src/components/ui/Pressy';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { Text } from '@/src/components/ui/Text';
import { ErrorState } from '@/src/components/states/ErrorState';
import { OfflineBanner } from '@/src/components/states/OfflineBanner';
import { deleteAccount } from '@/src/features/privacy/services/account';
import { DeleteAccountAction } from '@/src/features/privacy/components/DeleteAccountAction';
import { NoticeViewer } from '@/src/features/privacy/components/NoticeViewer';
import { LanguageToggle } from '@/src/features/settings/components/LanguageToggle';
import { NicknameRow } from '@/src/features/profile/components/NicknameRow';
import { MuteList } from '@/src/features/follow-through/components/MuteList';
import { GeneralNotificationsToggle } from '@/src/features/notifications/components/GeneralNotificationsToggle';
import { useMyEvents } from '@/src/features/events/hooks/useMyEvents';
import { useOffline } from '@/src/hooks/useOffline';
import { clearStoredUserId, getStoredUserId } from '@/src/lib/session';
import type { Language } from '@/src/i18n/types';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { i18n } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();

  const language: Language = i18n.language === 'en' ? 'en' : 'fa';

  const [showNotice, setShowNotice] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [deleteDone, setDeleteDone] = useState(false);
  const { isOffline, pendingCount } = useOffline();

  // The mute list needs the caller's events; the flag travels on each summary.
  const { events, isLoading: eventsLoading } = useMyEvents();

  /**
   * Whether the per-event rows are interactive.
   *
   * The general switch owns this; the list below only reads it. Kept here rather
   * than inside either component so the two cannot disagree about which is in
   * charge.
   */
  const [generalNotificationsOn, setGeneralNotificationsOn] = useState(true);

  /** The events muted individually right now — the set a restore must replay. */
  const mutedEventIds = events.filter((event) => event.notifications_muted).map((event) => event.id);

  const confirmDeleteAccount = useCallback(async () => {
    setDeletingAccount(true);
    setDeleteFailed(false);

    try {
      const userId = await getStoredUserId();
      await deleteAccount(userId);
      // The identity is gone server-side, so the local copy must go too —
      // keeping it would let the app keep sending a header for a deleted user.
      await clearStoredUserId();
      setDeleteDone(true);
    } catch {
      // ★ A FAILED DELETION IS A DESIGNED ERROR STATE, NOT AN ALERT.
      // This is the one action here whose failure the user must act on.
      setDeleteFailed(true);
    } finally {
      setDeletingAccount(false);
    }
  }, []);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        // No `insets.top`: `ScreenHeader` applies it, and adding it twice would
        // double the notch gap.
        { paddingTop: 0, paddingBottom: insets.bottom + space[12] },
      ]}
      testID="settings"
    >
      {/* ★ THIS SCREEN HAD NO WAY BACK.
          It was reachable only from the event-home tile, and once open the only
          exit was the OS gesture — which a desktop web build does not have, so
          Settings was a dead end there. */}
      <ScreenHeader
        title={t('settings.heading')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        testID="settings-header"
      />

      {/* ★ AC-11.7.1 — offline is non-blocking. Every control below still
          works against what has already loaded. */}
      {isOffline && <OfflineBanner pendingCount={pendingCount} testID="settings-offline" />}

      {/* Language — persist → flush → confirm restart (Plan 11 Task 6a). */}
      <Section title={t('settings.language')}>
        <LanguageToggle current={language} testID="settings-language" />
      </Section>

      {/* ★ Nickname (Plan 49 T8, FR-1.19).
          The same value the first-launch gate collects, editable here. It is a
          separate control from the per-event display name on purpose: that one
          is per event and this one seeds it, so changing this does not silently
          rewrite a name the person chose for one particular event. */}
      <Section title={t('profile.nicknameLabel')}>
        <NicknameRow testID="settings-nickname-row" />
      </Section>

      {/* ★ Notifications (Plan 10 Task 6, FR-6.19; general switch Plan 49 T18).
          The general switch comes first and greys the per-event list below it.
          Turning it back on RESTORES exactly the events that were muted
          individually — it does not force every event's notifications on. */}
      <Section title={t('notifications.muteList.section')}>
        <GeneralNotificationsToggle
          mutedEventIds={mutedEventIds}
          onChange={setGeneralNotificationsOn}
          testID="settings-general-notifications"
        />
        <MuteList
          events={events}
          isLoading={eventsLoading}
          interactive={generalNotificationsOn}
          testID="settings-mute-list"
        />
      </Section>

      {/* Privacy and data */}
      <Section title={t('settings.privacySection')}>
        <Card variant="raised" style={styles.cardBody}>
          <Text variant="body" weight={600}>
            {t('retention.heading')}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('retention.coordinatesAfterEvent')}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('retention.decisionHistoryKept')}
          </Text>

          {/* ★ A SURFACE, NOT BARE TEXT.
              This was `variant="ghost"`, which paints no fill at all, so the
              one control that opens the policy was the only unpainted row on a
              screen made entirely of pills. */}
          <Button
            label={t('privacy.noticeAction')}
            variant="secondary"
            size="medium"
            onPress={() => setShowNotice(true)}
            testID="settings-notice-open"
          />
          <Text variant="caption" color="textFaint">
            {t('privacy.noticeFootnote')}
          </Text>
        </Card>
      </Section>

      {/* Account */}
      <Section title={t('settings.accountSection')}>
        {deleteFailed && (
          <ErrorState
            messageKey="errors.unknown"
            onRetry={() => void confirmDeleteAccount()}
            testID="settings-delete-error"
          />
        )}
        {/* ★ A CONFIRMATION, NOT A SYSTEM DIALOG.
            Deletion success used to be announced in a second OS window with a
            single OK — the user tapped through it without reading it, and on
            Android it outlived the screen it belonged to. The same sentence now
            appears where the action was. */}
        {deleteDone && (
          <Text
            variant="body"
            color={theme.success}
            accessibilityLiveRegion="polite"
            testID="settings-delete-done"
          >
            {t('settings.deleteAccountDone')}
          </Text>
        )}
        <DeleteAccountAction
          onConfirm={confirmDeleteAccount}
          busy={deletingAccount}
          testID="settings-delete-account"
        />
      </Section>

      <Text variant="caption" color="textFaint" align="center">
        {t('privacy.knownGapsBody')}
      </Text>

      {/* ★ THE NOTICE IS A DOCUMENT, SO IT OPENS OVER THE PAGE.
          It used to render inline in the section above, which shoved the
          account section — and the two controls the platform reviews for —
          several screens down the page. Every other document in the product
          opens in a sheet; this one is the same. It still reads from the
          bundled copy, so it works in airplane mode (E10): no navigation, no
          fetch. */}
      <BottomSheet
        visible={showNotice}
        onDismiss={() => setShowNotice(false)}
        // `NoticeViewer` holds a `flex: 1` scroll view, which measures as zero
        // under content sizing, so this sheet must name its height — the one
        // case `BottomSheet` documents itself as needing a snap point.
        snapPoints={['85%']}
        testID="settings-notice"
      >
        <View style={styles.noticeContainer}>
          {/* ★ AN EXPLICIT WAY OUT.
              The sheet can be dragged away, which a mouse user on the web build
              has no cue for, and this is a long document — so the close control
              is labelled and stays at the top where the reader starts. */}
          <View style={styles.noticeHeader}>
            <Text variant="h3" align="start" style={styles.noticeTitle}>
              {t('privacy.noticeAction')}
            </Text>
            <Pressy
              onPress={() => setShowNotice(false)}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              testID="settings-notice-close"
              style={styles.noticeClose}
            >
              <X size={20} color={theme.text} weight="bold" />
            </Pressy>
          </View>

          <NoticeViewer language={language} testID="settings-notice-body" />
        </View>
      </BottomSheet>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="h3">{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[5] },
  section: { gap: space[3] },
  cardBody: { gap: space[3] },
  noticeContainer: {
    flex: 1,
    gap: space[3],
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  noticeTitle: {
    flex: 1,
  },
  noticeClose: {
    padding: space[1],
  },
});
