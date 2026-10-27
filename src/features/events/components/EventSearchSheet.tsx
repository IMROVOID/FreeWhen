/**
 * The joined/owned events search (Plan 49 T11).
 *
 * ★ RESULTS RENDER INSIDE THE SHEET, NOT ON THE HOME PAGE.
 *
 * Filtering the home list in place would make the page's own state ambiguous —
 * is this list "my events" or "my search results"? — and a cleared query would
 * leave the reader unsure what they are looking at. The sheet owns its query and
 * its results together, and dismissing it restores the untouched home page.
 *
 * ★ IT FILTERS WHAT IS ALREADY LOADED.
 *
 * `useMyEvents` has the list; a search endpoint would be a second source of truth
 * for the same rows and would disagree with the page behind the sheet. The list is
 * capped at ten events per participant by design (`PARTICIPANT_CAP`), so a local
 * filter is also the correct scale.
 */

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { EventRow } from '@/src/features/events/components/EventRow';
import { matchesQuery } from '@/src/features/events/services/event-search';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { EventSummary } from '@/src/types/event';

export interface EventSearchSheetProps {
  visible: boolean;
  onDismiss: () => void;
  events: EventSummary[];
  onOpenEvent: (eventId: string) => void;
  testID?: string;
}

export function EventSearchSheet({
  visible,
  onDismiss,
  events,
  onOpenEvent,
  testID = 'event-search-sheet',
}: EventSearchSheetProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [query, setQuery] = useState('');

  const results = useMemo(
    () => events.filter((event) => matchesQuery(event.title, query)),
    [events, query],
  );

  const open = useCallback(
    (eventId: string) => {
      // Dismiss first, so the sheet is gone before the route changes underneath
      // it — otherwise the sheet animates out over the next screen.
      onDismiss();
      onOpenEvent(eventId);
    },
    [onDismiss, onOpenEvent],
  );

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      snapPoints={['85%']}
      testID={testID}
    >
      <View style={styles.content}>
        <Text variant="h2">{t('events.search.title')}</Text>

        <Input
          value={query}
          onChangeText={setQuery}
          label={t('events.search.placeholder')}
          testID="event-search-input"
        />

        {results.length === 0 ? (
          // ★ THE EMPTY ANSWER NAMES THE QUERY.
          //
          // "No results" with no context reads as a broken search; naming what
          // was searched for makes it obvious the filter worked.
          <Text variant="body" color={theme.textMuted} testID="event-search-empty">
            {t('events.search.noResults', { query: query.trim() })}
          </Text>
        ) : (
          <ScrollView
            style={styles.results}
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="handled"
            testID="event-search-results"
          >
            {results.map((event) => (
              <EventRow key={event.id} event={event} onPress={() => open(event.id)} />
            ))}
          </ScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[4],
  },
  results: {
    // A ceiling, so the sheet does not grow past its own snap point when there
    // are many matches; the list scrolls inside it.
    maxHeight: 420,
  },
  resultsContent: {
    gap: space[2],
  },
});
