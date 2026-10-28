/**
 * S19 — Event configuration.
 *
 * ★ A PAGE, BECAUSE THAT IS WHAT THE MENU SAYS IT OPENS.
 *
 * Renaming, rotating the invite code and deleting an event already had a home inside
 * `EventManagementModal`, reachable only from the event home's action grid. The
 * context menu's item is "Event configuration", and a menu item that names a page but
 * opens a sheet is a small lie about where the user is going — and it gives the screen
 * no place to grow the controls an event will keep accumulating.
 *
 * ★ THE SHELL IS LOADED HERE RATHER THAN SHARED.
 *
 * The event's title and `is_organizer` are the two facts the modal needs, and its own
 * route is the one place they are guaranteed to be authoritative — the summary the
 * list held may be minutes old. Fetching them here also means a deep link to this
 * page works, which a route that depended on a previous screen's state would not.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { EventManagementModal } from '@/src/features/events/components/EventManagementModal';
import { deleteEvent, leaveEvent, renameEvent } from '@/src/features/events/services/event-management';
import { rotateInvite } from '@/src/features/events/services/invite';
import { extractInviteToken } from '@/src/features/events/utils/invite-token';
import { apiRequest, isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { EventSummary } from '@/src/types/event';

interface EventShell {
  id: string;
  title: string;
  is_organizer?: boolean;
  invite_code?: string | null;
  invite_url?: string | null;
}

export default function EventConfigScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();

  const eventId = typeof params.id === 'string' ? params.id : '';

  const [event, setEvent] = useState<EventShell | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);

  const loadEvent = useCallback(async () => {
    setIsLoading(true);

    try {
      const stored = await getStoredUserId();
      const { data } = await apiRequest<{ event: EventSummary }>(`/api/events/${eventId}`, {
        userId: stored,
      });

      setEvent(data.event as unknown as EventShell);
      setLoadErrorKey(null);
    } catch (error) {
      setEvent(null);
      setLoadErrorKey(isApiFailure(error) ? error.messageKey : 'errors.networkError');
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  const handleRename = useCallback(
    async (newTitle: string) => {
      const updated = await renameEvent(eventId, newTitle, await getStoredUserId());
      setEvent((prev) => (prev ? { ...prev, title: updated.title } : prev));
    },
    [eventId],
  );

  const handleRegenerateCode = useCallback(async () => {
    const result = await rotateInvite(eventId, await getStoredUserId());
    const inviteCode = extractInviteToken(result.invite.url);

    setEvent((prev) =>
      prev ? { ...prev, invite_url: result.invite.url, invite_code: inviteCode } : prev,
    );
  }, [eventId]);

  // Both destructive outcomes leave this page, so there is nothing to re-render.
  const handleDelete = useCallback(async () => {
    await deleteEvent(eventId, await getStoredUserId());
    router.replace('/');
  }, [eventId, router]);

  const handleLeave = useCallback(async () => {
    await leaveEvent(eventId, await getStoredUserId());
    router.replace('/');
  }, [eventId, router]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[12] }]}
      testID="event-config"
    >
      <ScreenHeader
        title={t('events.contextMenu.configure')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        testID="event-config-header"
      />

      {isLoading ? (
        <ListSkeleton rows={2} testID="event-config-loading" />
      ) : event === null ? (
        <ErrorState
          messageKey={loadErrorKey ?? 'errors.unknown'}
          onRetry={() => void loadEvent()}
          testID="event-config-error"
        />
      ) : (
        <View style={styles.body}>
          {/*
            ★ THE SHEET IS MOUNTED OPEN, NOT TRIGGERED BY A BUTTON.
            Its content IS this page's content; the trigger already happened in the
            context menu. A screen whose only control opens a sheet over itself would
            add a tap for nothing.
          */}
          <EventManagementModal
            visible
            onDismiss={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            isOwner={Boolean(event.is_organizer)}
            eventTitle={event.title}
            onRename={handleRename}
            onRegenerateCode={handleRegenerateCode}
            onDeleteEvent={handleDelete}
            onLeaveEvent={handleLeave}
            testID="event-config-management"
          />

          <Button
            label={t('common.back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            variant="secondary"
            size="medium"
            testID="event-config-back"
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space[5], gap: space[5] },
  body: { gap: space[4] },
});
