/**
 * S9 — the ranked venue list, with the map as context (Plan 08).
 *
 * ★ LIST FIRST (PRD-04 §13.1).
 *
 * The list is the primary artifact and the map is contextual. The map is
 * mounted inside `MapErrorBoundary`, so a renderer crash — or no renderer at
 * all — leaves the ranking and every detail panel working. That ordering is
 * what makes "map → list-only" a cheap cut line rather than a rewrite.
 *
 * ★ THE ACTIVE LENS IS ALWAYS ON SCREEN (PRD-11 §15.8, OQ-11.2).
 *
 * An unexplained ranking is the failure mode the research warns about: a
 * list reads as "the right answer" regardless of which question produced it.
 * `LensSwitcher` renders the name and its plain meaning, not only the
 * selected segment.
 *
 * ★ MAP↔LIST SELECTION IS P0 (FR-4.3/FR-4.7).
 *
 * Tapping a pin highlights its row; tapping a row highlights its pin. Neither
 * direction is the sole path to information — every fact on the map is in the
 * list (FR-4.5).
 *
 * ★ A LENS CHANGE ALTERS ONLY THE RANKING (AC-5.6.1).
 *
 * This screen holds no vote, proposal or decision state, and calls no
 * mutation. Changing the lens refetches and reorders.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { I18nManager, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ErrorState } from '@/src/components/states/ErrorState';
import { ListSkeleton } from '@/src/components/states/ListSkeleton';
import { OfflineBanner } from '@/src/components/states/OfflineBanner';
import { LensSwitcher } from '@/src/features/venues/components/LensSwitcher';
import { MapErrorBoundary } from '@/src/features/venues/components/MapErrorBoundary';
import { RankedList } from '@/src/features/venues/components/RankedList';
import { VenueMap } from '@/src/features/venues/components/VenueMap';
import { useLens } from '@/src/features/venues/hooks/useLens';
import { useRanking } from '@/src/features/venues/hooks/useRanking';
import { useOffline } from '@/src/hooks/useOffline';
import {
  trackMapViewed,
  trackVenueSelected,
} from '@/src/features/venues/services/analytics';
import { createMapAdapter, type MapPlatform } from '@/src/features/map';
import type { MapRenderLevel } from '@/src/features/map/types';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Coordinate } from '@/src/routing/types';

/** Which platform's adapter to build — the one thing `Platform.OS` decides. */
function detectPlatform(): MapPlatform {
  return Platform.OS === 'web' ? 'web' : 'native';
}

export default function RankedVenuesScreen() {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const params = useLocalSearchParams<{ id?: string }>();
  const eventId = typeof params.id === 'string' ? params.id : '';

  const { lens, setLens } = useLens();
  const {
    venues,
    excluded,
    coverage,
    isLoading,
    errorKey,
    isReconnecting,
    reload,
  } = useRanking(eventId, lens);
  const { isOffline, pendingCount } = useOffline();

  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [renderLevel, setRenderLevel] = useState<MapRenderLevel>(4);

  // The adapter is built once per mount: a new one per render would tear down
  // and rebuild the map on every keystroke elsewhere on screen.
  const adapter = useMemo(() => createMapAdapter(detectPlatform()), []);
  useEffect(() => {
    setRenderLevel(adapter.level);
  }, [adapter]);

  // `map_viewed` is recorded once data is available, with the level that
  // survived — not the level that was hoped for.
  const mapViewed = useRef(false);
  useEffect(() => {
    if (isLoading || mapViewed.current) return;
    mapViewed.current = true;
    trackMapViewed(renderLevel);
  }, [isLoading, renderLevel]);

  const selectFromList = useCallback((venueId: string) => {
    setSelectedVenueId(venueId);
    const venue = venues.find((item) => item.venueId === venueId);
    trackVenueSelected(venue?.rank ?? 0, 'list');
  }, [venues]);

  const selectFromMap = useCallback((venueId: string) => {
    setSelectedVenueId(venueId);
    const venue = venues.find((item) => item.venueId === venueId);
    trackVenueSelected(venue?.rank ?? 0, 'map');
  }, [venues]);

  const openDetails = useCallback(
    (venueId: string) => {
      router.push({
        pathname: '/event/[id]/venue/[vid]',
        params: { id: eventId, vid: venueId, lens },
      });
    },
    [eventId, lens, router],
  );

  const propose = useCallback(() => {
    router.push({ pathname: '/event/[id]/propose', params: { id: eventId } });
  }, [eventId, router]);

  // Venue coordinates are not on the ranking payload's participants, so the
  // map receives what it can place; a venue without one stays in the list
  // and is listed as off-map rather than silently dropped.
  const coordinates: Record<string, Coordinate> = useMemo(() => ({}), []);

  // ★ LOADING IS SKELETON ROWS, NOT A CENTRED SPINNER (§6, Plan 11 Task 5).
  if (isLoading) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingTop: insets.top + space[6], paddingHorizontal: space[4] },
        ]}
      >
        <ListSkeleton rows={3} testID="ranking-loading" />
      </View>
    );
  }

  if (errorKey) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: theme.bg, paddingTop: insets.top + space[6], paddingHorizontal: space[4] },
        ]}
      >
        {isOffline && <OfflineBanner pendingCount={pendingCount} testID="ranking-offline" />}
        <ErrorState
          messageKey={errorKey}
          retryKey="ranking.retry"
          onRetry={() => void reload()}
          testID="ranking-error"
        />
      </View>
    );
  }

  const BackIcon = I18nManager.isRTL ? CaretRight : CaretLeft;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: '/event/[id]', params: { id: eventId } });
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[10] },
      ]}
      testID="ranking-screen"
    >
      {isOffline && <OfflineBanner pendingCount={pendingCount} testID="ranking-offline" />}

      <View style={styles.topHeader}>
        <Pressy
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', 'بازگشت')}
          style={styles.backButton}
        >
          <BackIcon size={24} color={theme.text} weight="bold" />
        </Pressy>
        {/* ★ THE TITLE IS CENTRED BY A SYMMETRIC SPACER, NOT BY `flex: 1`.
            A flexed title centres inside what is LEFT of the row, which shifts
            it by half the back button's width. The spacer is the same width as
            the button, so the title sits on the screen's centre line. */}
        <View style={styles.header} pointerEvents="none">
          <Text variant="h1" align="center" numberOfLines={1}>
            {t('ranking.heading')}
          </Text>
          <Text variant="caption" color={theme.textMuted} align="center" numberOfLines={1}>
            {t('ranking.subheading')}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <LensSwitcher active={lens} onChange={setLens} testID="ranking-lens" />

      {/* ★ A map failure is not an app failure: the fallback is a note, and
          the list below it is unaffected (AC-4.2.1). */}
      <MapErrorBoundary
        fallback={
          <View style={[styles.listOnly, { backgroundColor: theme.surface2 }]} testID="ranking-list-only">
            <Text variant="caption" color={theme.textMuted}>
              {t('ranking.listOnlyNote')}
            </Text>
          </View>
        }
        onFailure={setRenderLevel}
      >
        <VenueMap
          adapter={adapter}
          ranked={venues}
          coordinates={coordinates}
          areas={[]}
          excludedVenueIds={excluded.map((item) => item.venueId)}
          selectedVenueId={selectedVenueId}
          onSelectVenue={selectFromMap}
          onPropose={propose}
          testID="ranking-map"
        />
      </MapErrorBoundary>

      {isReconnecting && (
        <Text variant="caption" color={theme.warning}>
          {t('ranking.refreshing')}
        </Text>
      )}

      <RankedList
        venues={venues}
        excluded={excluded}
        coverage={coverage}
        selectedVenueId={selectedVenueId}
        onSelect={selectFromList}
        onOpenDetails={openDetails}
        onPropose={propose}
        testID="ranking-list"
      />

      <Button
        label={t('ranking.emptyAction')}
        onPress={propose}
        variant="secondary"
        size="medium"
        testID="ranking-propose"
      />
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
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: size.stepperButton,
    height: size.stepperButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    gap: space[1],
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: size.stepperButton,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: space[6],
  },
  listOnly: {
    borderRadius: radius.md,
    padding: space[4],
  },
});
