/**
 * The place search sheet (Plan 06 Task 8, S8, FR-4.24).
 *
 * ★ THE CUSTOM PIN IS A FIRST-CLASS PATH.
 *
 * In Tehran the common case is an informal meeting spot. When search is degraded
 * — unconfigured key, spent quota, provider down — this sheet keeps the same map
 * entry it always offers, with no apology and no error state. The failure that
 * would block the flow is the one this component is shaped to avoid.
 *
 * ★ THE SHEET NEVER CALLS NESHAN.
 *
 * It calls `/api/place-search`. The key lives on the server, so there is no
 * client path to it at all (PRD-10 D9).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import {
  MIN_SEARCH_LENGTH,
  searchPlaces,
  type PlaceResult,
} from '@/src/features/venues/services/place-search';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { VenueRef } from '@/src/types/proposal';

export interface PlaceSearchSheetProps {
  onSelect: (venue: VenueRef) => void;
  /** The custom-pin entry. Always present, never conditional on failure. */
  onPickOnMap: () => void;
  /** An optional search bias — the event's neighbourhood, when known. */
  bias?: { lat: number; lng: number } | null;
  testID?: string;
}

/** How long to wait after the last keystroke before spending a provider call. */
const DEBOUNCE_MS = 350;

export function PlaceSearchSheet({
  onSelect,
  onPickOnMap,
  bias = null,
  testID,
}: PlaceSearchSheetProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDegraded, setIsDegraded] = useState(false);

  // A search that resolves after a newer one has started must not overwrite it.
  const requestId = useRef(0);

  const runSearch = useCallback(
    async (query: string) => {
      if (query.trim().length < MIN_SEARCH_LENGTH) {
        setResults([]);
        setIsDegraded(false);
        return;
      }

      const mine = ++requestId.current;
      setIsSearching(true);

      try {
        const outcome = await searchPlaces(query, bias);
        if (mine !== requestId.current) return;

        setResults(outcome.results);
        setIsDegraded(outcome.degraded);
      } catch {
        if (mine !== requestId.current) return;

        // A transport failure is the same user-facing situation as a spent
        // quota: search is unavailable, the map is not.
        setResults([]);
        setIsDegraded(true);
      } finally {
        if (mine === requestId.current) setIsSearching(false);
      }
    },
    [bias],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void runSearch(term);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, runSearch]);

  return (
    <Card variant="surface" testID={testID} style={styles.sheet}>
      <Input
        value={term}
        onChangeText={setTerm}
        label={t('proposals.place.searchLabel')}
        testID={testID ? `${testID}-input` : undefined}
      />

      {isSearching && <ActivityIndicator color={theme.textMuted} />}

      {!isSearching && isDegraded && (
        <Text variant="caption" color={theme.textMuted}>
          {t('proposals.place.degraded')}
        </Text>
      )}

      {!isSearching && !isDegraded && term.trim().length >= MIN_SEARCH_LENGTH && results.length === 0 && (
        <Text variant="caption" color={theme.textMuted}>
          {t('proposals.place.noResults')}
        </Text>
      )}

      {results.length > 0 && (
        <ScrollView style={styles.results} contentContainerStyle={styles.resultsContent}>
          {results.map((result) => (
            <Card
              key={result.provider_place_id}
              variant="raised"
              onPress={() =>
                onSelect({
                  name: result.name,
                  lat: result.lat,
                  lng: result.lng,
                  address: result.address,
                  provider_place_id: result.provider_place_id,
                })
              }
              testID={testID ? `${testID}-result-${result.provider_place_id}` : undefined}
              style={styles.result}
            >
              <Text variant="body" numberOfLines={1}>
                {result.name}
              </Text>
              {result.category && (
                <Text variant="caption" color={theme.textFaint}>
                  {result.category}
                </Text>
              )}
              {result.address && (
                <Text variant="caption" color={theme.textMuted} numberOfLines={2}>
                  {result.address}
                </Text>
              )}
            </Card>
          ))}
        </ScrollView>
      )}

      {/* ★ ALWAYS PRESENT — NOT A FALLBACK (FR-4.24). */}
      <Button
        label={t('proposals.place.pickOnMap')}
        onPress={onPickOnMap}
        variant="ghost"
        size="medium"
        testID={testID ? `${testID}-pick-on-map` : undefined}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  sheet: {
    gap: space[3],
  },
  results: {
    maxHeight: space[16] * 4,
  },
  resultsContent: {
    gap: space[2],
  },
  result: {
    gap: space[1],
  },
});
