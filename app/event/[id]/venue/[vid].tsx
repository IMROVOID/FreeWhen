/**
 * S10 — the venue detail, the honesty screen (Plan 08 Task 6, PRD-11 S10).
 *
 * ★ REACHABLE WITHOUT A WORKING MAP (FR-4.21, AC-4.2.1).
 *
 * This route imports nothing from the map. It reads the ranking, finds the
 * venue, and renders the panel — so killing the map leaves it fully
 * functional. That is the property the error-boundary test protects.
 *
 * ★ THE ACTIVE LENS TRAVELS WITH THE REASON.
 *
 * The lens is passed as a route param from the list, so the reason on this
 * screen is explained by the same lens that produced it. A reason without its
 * lens is a sentence with no question attached.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/src/components/ui/Button';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { VenueDetailPanel } from '@/src/features/venues/components/VenueDetailPanel';
import { useLens } from '@/src/features/venues/hooks/useLens';
import { useRanking } from '@/src/features/venues/hooks/useRanking';
import { trackVenueDetailOpened } from '@/src/features/venues/services/analytics';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Lens } from '@/src/engine/types';

/** The closed lens union, defaulting to `balanced` for a hand-typed URL. */
function asLens(value: unknown): Lens {
  return value === 'fastest' || value === 'fairest' || value === 'cheapest' || value === 'balanced'
    ? value
    : 'balanced';
}

export default function VenueDetailScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{ id?: string; vid?: string; lens?: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';
  const venueId = typeof params.vid === 'string' ? params.vid : '';

  const { lens } = useLens(asLens(params.lens));
  const { venues, isLoading, errorKey, reload } = useRanking(eventId, lens);

  const venue = useMemo(
    () => venues.find((item) => item.venueId === venueId) ?? null,
    [venues, venueId],
  );

  const goBack = useCallback(() => {
    router.push({ pathname: '/event/[id]/map', params: { id: eventId } });
  }, [eventId, router]);

  // Recorded once the panel actually has something to show.
  const rank = venue?.rank ?? null;
  useEffect(() => {
    if (rank === null) return;
    trackVenueDetailOpened(rank, 4);
  }, [rank]);

  const body = (() => {
    if (isLoading) {
      return (
        <View style={styles.centred}>
          <ActivityIndicator color={theme.textMuted} testID="venue-loading" />
        </View>
      );
    }

    if (errorKey) {
      return (
        <EmptyState
          title={t('ranking.heading')}
          body={t(errorKey)}
          actionLabel={t('ranking.retry')}
          onAction={() => void reload()}
        />
      );
    }

    if (!venue) {
      return (
        <EmptyState
          title={t('venue.notFound')}
          body={t('ranking.emptyBody')}
          actionLabel={t('venue.backToList')}
          onAction={goBack}
          testID="venue-not-found"
        />
      );
    }

    return <VenueDetailPanel venue={venue} lens={lens} testID="venue-detail" />;
  })();

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="venue-screen"
    >
      <Button
        label={t('venue.backToList')}
        onPress={goBack}
        variant="ghost"
        size="small"
        testID="venue-back"
      />
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space[4],
    gap: space[5],
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[8],
  },
});
