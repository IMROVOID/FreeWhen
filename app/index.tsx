/**
 * S1 — the event list (Plan 05 Task 6, PRD-11 S1).
 *
 * What the user sees on launch: the events they created or joined, most
 * recently active first, each with a status chip and — if they still owe a
 * vote — an attention badge.
 *
 * ★ THE EMPTY STATE IS P0, NOT A NICETY.
 *
 * A brand-new user's first screen is empty by definition, so the empty state IS
 * their first impression. It invites the one action that matters rather than
 * showing nothing.
 *
 * ★ ALL FOUR APPLICABLE STATES RUN THROUGH `ScreenStateGate` (Plan 11 Task 3).
 *
 * Loading is skeleton rows, not a full-screen spinner (§6), and an error offers
 * a retry rather than a sentence on its own. Permission-denied is genuinely N/A
 * here — the list needs no permission — so the gate is used with four states and
 * not a placeholder fifth.
 */

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gear, MagnifyingGlass } from 'phosphor-react-native';

import { Button, type ButtonVariant } from '@/src/components/ui/Button';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ScreenStateGate, type ScreenState } from '@/src/components/states/ScreenStateGate';
import { EventRow } from '@/src/features/events/components/EventRow';
import { EventContextMenu } from '@/src/features/events/components/EventContextMenu';
import { deleteEvent, leaveEvent } from '@/src/features/events/services/event-management';
import { ConfirmSheet } from '@/src/components/ui/ConfirmSheet';
import { getStoredUserId } from '@/src/lib/session';
import type { EventSummary } from '@/src/types/event';
import { EventSearchSheet } from '@/src/features/events/components/EventSearchSheet';
import { JoinEventCard } from '@/src/features/events/components/JoinEventCard';
import { useMyEvents } from '@/src/features/events/hooks/useMyEvents';
import { useOffline } from '@/src/hooks/useOffline';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export default function EventListScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // The menu has to know what it must fit inside — see menu-placement.ts.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const { events, isLoading, errorKey, errorTitleKey, reload } = useMyEvents();
  const { isOffline } = useOffline();

  const [searchOpen, setSearchOpen] = useState(false);

  /**
   * The event whose context menu is open, and the row's rect on screen.
   *
   * ★ THE MENU IS A HOLD, BECAUSE THE ROW HAD NO ROOM FOR A THIRD CONTROL.
   *
   * The row already carries a status chip and an attention badge. Leaving an event,
   * changing where you travel from, and — for the owner — renaming or deleting it were
   * all reachable only from INSIDE the event, so the row you are looking at was the one
   * place you could not act on it.
   */
  const [menuFor, setMenuFor] = useState<{
    event: EventSummary;
    bounds: { x: number; y: number; width: number; height: number };
  } | null>(null);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const openEvent = useCallback(
    (eventId: string) => {
      router.push(`/event/${eventId}`);
    },
    [router],
  );

  const closeMenu = useCallback(() => setMenuFor(null), []);

  /**
   * Runs an event action, then refreshes the list.
   *
   * ★ THE LIST IS THE SOURCE OF TRUTH AFTER ANY WRITE.
   *
   * Leaving or deleting removes the row, and the API answers 200 either way — so
   * relying on an optimistic removal would leave the row on screen if the request was
   * rejected. Refetching shows what the server actually holds.
   */
  const runEventAction = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } finally {
        await reload();
      }
    },
    [reload],
  );

  /**
   * ★ CREATE AND SEARCH SHARE ONE ROW.
   *
   * The create action used to be full-width, so there was nowhere to put the
   * search control without either pushing it onto its own line or letting the
   * two compete for the same edge. `fullWidth={false}` on the button lets the
   * row divide the width: create takes what is left, search is a fixed 44pt
   * square beside it.
   */
  const actions = (variant: ButtonVariant, testID: string) => (
    <View style={styles.actionRow}>
      <Button
        label={t('events.list.create')}
        onPress={() => router.push('/new')}
        variant={variant}
        size="medium"
        fullWidth={false}
        testID={testID}
        style={styles.createButton}
      />

      <Pressy
        onPress={() => setSearchOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('events.search.open')}
        testID="event-search-open"
        style={styles.searchControl}
      >
        <View style={[styles.searchInner, { backgroundColor: theme.surface2 }]}>
          <MagnifyingGlass size={20} color={theme.text} weight="bold" />
        </View>
      </Pressy>
    </View>
  );

  const createAction = actions('primary', 'event-list-create');

  // ★ THE STATE IS DERIVED IN ONE PLACE, SO NO BRANCH CAN FALL THROUGH.
  const state: ScreenState = isLoading
    ? { kind: 'loading', rows: 3 }
    : errorKey
      ? {
          kind: 'error',
          messageKey: errorKey,
          titleKey: errorTitleKey ?? undefined,
          onRetry: () => void reload(),
        }
      : events.length === 0
        ? {
            kind: 'empty',
            prompt: t('states.eventsEmpty'),
            body: t('states.eventsEmptyBody'),
            action: createAction,
          }
        : {
            kind: 'ready',
            children: (
              <>
                {events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    onPress={() => openEvent(event.id)}
                    onLongPress={(bounds) => setMenuFor({ event, bounds })}
                  />
                ))}
              </>
            ),
          };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="event-list"
    >
      {/* ★ SETTINGS LIVES HERE, NOT ON THE EVENT SCREEN.
          It was a tile in the event home's action grid, which made an app-wide
          door read as one more thing you can do to this event. The app's own
          home is where "the app" lives, so the door is a header control beside
          the heading — present before any event exists, and reachable from the
          list rather than from inside a plan. */}
      <View style={styles.headerRow}>
        <View style={styles.headingBlock}>
          {/* ★ THE APP'S NAME, NOT "MY EVENTS".
              The screen is the app's home, and calling it "My events" made the
              product indistinguishable from the list inside it. The joined list
              below carries that heading now, which is what it actually is. */}
          <Text variant="h1" align="start">
            {t('common.appName')}
          </Text>
        </View>

        <Pressy
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel={t('settings.heading')}
          testID="home-settings"
          style={styles.settingsControl}
        >
          <View style={[styles.settingsInner, { backgroundColor: theme.surface2 }]}>
            <Gear size={22} color={theme.text} weight="bold" />
          </View>
        </Pressy>
      </View>

      <JoinEventCard onJoin={(token) => router.push(`/e/${token}`)} />

      {/* ★ THE ACTIONS COME BEFORE THE LIST, NOT AFTER IT.
          Create and Search are the two things a person opens this screen to do,
          and at the bottom of a growing list they were reachable only by
          scrolling past every event — furthest away exactly when the list is
          longest. Above the heading they are in the same place on every launch.
          The empty state still carries its own create action, so a first-time
          user is not shown an empty list with the button somewhere else. */}
      {state.kind === 'ready' ? actions('secondary', 'event-list-create-secondary') : null}

      {/* ★ The list gets its own heading, because the page title is the app now.
          The top padding is the separation the heading needs from the actions
          above it — without it the two read as one block. */}
      <View style={styles.listHeading}>
        <Text variant="h3" align="start">
          {t('events.list.heading')}
        </Text>
      </View>

      <ScreenStateGate state={state} offline={isOffline} testID="event-list-states" />

      {/* Results live in the sheet, not on this page — see EventSearchSheet. */}
      <EventSearchSheet
        visible={searchOpen}
        onDismiss={() => setSearchOpen(false)}
        events={events}
        onOpenEvent={openEvent}
      />

      {/* ★ A HOLD ON AN EVENT ROW OPENS ITS ACTIONS HERE.
          Rendered at the screen's root, not inside the `ScrollView`: a menu laid out
          against scroll content is positioned against a box taller than the viewport,
          which is the trap `BottomSheet.tsx` documents. */}
      <EventContextMenu
        anchor={menuFor?.bounds ?? null}
        viewport={{ width: windowWidth, height: windowHeight }}
        eventTitle={menuFor?.event.title ?? ''}
        isOwner={Boolean(menuFor?.event.is_organizer)}
        onChangeLocation={() => {
          if (menuFor) {
            router.push({ pathname: '/event/[id]/map', params: { id: menuFor.event.id } });
          }
        }}
        onLeave={() => {
          const target = menuFor;
          if (!target) return;
          void runEventAction(async () => {
            await leaveEvent(target.event.id, await getStoredUserId());
          });
        }}
        onOpenConfiguration={
          menuFor
            ? () => {
                const target = menuFor;
                router.push({ pathname: '/event/[id]/config', params: { id: target.event.id } });
              }
            : undefined
        }
        onDelete={() => {
          if (menuFor) setPendingDeleteId(menuFor.event.id);
        }}
        onDismiss={closeMenu}
      />

      {/* ★ DELETION IS CONFIRMED, AND THE CONFIRMATION NAMES THE EVENT.
          It is the one action on this screen that cannot be undone, so it does not
          happen on the menu tap — the sheet is the second, deliberate act. */}
      <ConfirmSheet
        visible={pendingDeleteId !== null}
        title={t('events.management.deleteTitle')}
        body={t('events.management.deleteBody')}
        confirmLabel={t('events.management.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          const id = pendingDeleteId;
          setPendingDeleteId(null);
          if (!id) return;
          void runEventAction(async () => {
            await deleteEvent(id, await getStoredUserId());
          });
        }}
        onDismiss={() => setPendingDeleteId(null)}
        testID="event-list-delete-confirm"
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
    gap: space[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  headingBlock: {
    flex: 1,
  },
  listHeading: {
    // The separation the list heading needs from the join card above it.
    paddingTop: space[2],
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  createButton: {
    // Takes the width the search control does not, so the pair stays on one line
    // at every text scale instead of wrapping the icon onto its own row.
    flex: 1,
  },
  searchControl: {
    // ★ THE SAME HEIGHT AS THE CREATE BUTTON BESIDE IT, AND A CIRCLE.
    //
    // It was `size.stepperButton` (44) against a 48pt `medium` button, so the
    // two controls in one row had different heights and the search icon sat 4pt
    // short of the thing it is paired with. A pill radius on a square would read
    // as a rounded square, which is not what a search affordance looks like.
    width: size.buttonMedium,
    height: size.buttonMedium,
    flexShrink: 0,
  },
  searchInner: {
    flex: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsControl: {
    // A 44pt control with `Pressy`'s slop clears the 48pt target.
    width: size.stepperButton,
    height: size.stepperButton,
  },
  settingsInner: {
    flex: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

