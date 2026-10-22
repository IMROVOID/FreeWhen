/**
 * The ranked list — the primary artifact (Plan 08 Task 3, PRD-04 §13.1).
 *
 * ★ THE LIST IS WHAT SURVIVES EVERY FAILURE MODE.
 *
 * It is rendered from data it was handed, with no map, no network and no
 * renderer. A working list with a broken map is shippable; the reverse is
 * not. Every fact on the map is reachable here (FR-4.5) — the map is never
 * the only path to information.
 *
 * ★ THE EMPTY AND NO-VIABLE STATES ARE INVITATIONS, NOT ERRORS.
 *
 * `NoVenueMeetsThreshold` is a first-class 200 result, not a fault. It gets a
 * prompt to relax a limit or propose another place, because returning nothing
 * would leave the user with no way forward (PRD-05 §5.3).
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/src/components/ui/EmptyState';
import { Text } from '@/src/components/ui/Text';
import { CoverageNotice } from '@/src/features/venues/components/CoverageNotice';
import { ExcludedSection } from '@/src/features/venues/components/ExcludedSection';
import { VenueRow } from '@/src/features/venues/components/VenueRow';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Coverage, Exclusion, RankedVenue } from '@/src/engine/types';

export interface RankedListProps {
  venues: RankedVenue[];
  excluded: Exclusion[];
  coverage: Coverage;
  selectedVenueId?: string | null;
  onSelect?: (venueId: string) => void;
  onOpenDetails?: (venueId: string) => void;
  onPropose?: () => void;
  testID?: string;
}

export function RankedList({
  venues,
  excluded,
  coverage,
  selectedVenueId = null,
  onSelect,
  onOpenDetails,
  onPropose,
  testID,
}: RankedListProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  // Venue names for the excluded rows: an exclusion carries only an id, and
  // a muted row that says `v_2f9a` tells the user nothing.
  const venueNames: Record<string, string> = {};
  for (const venue of venues) venueNames[venue.venueId] = venue.name;

  const isEmpty = venues.length === 0;

  return (
    <View testID={testID} style={styles.container}>
      <CoverageNotice coverage={coverage} testID={testID ? `${testID}-coverage` : undefined} />

      {isEmpty ? (
        <EmptyState
          title={t('ranking.empty')}
          body={t('ranking.emptyBody')}
          actionLabel={onPropose ? t('ranking.emptyAction') : undefined}
          onAction={onPropose}
          testID={testID ? `${testID}-empty` : undefined}
        />
      ) : (
        <View style={styles.rows}>
          {venues.map((venue) => (
            <VenueRow
              key={venue.venueId}
              venue={venue}
              worstMinutes={worstOffMinutes(venue)}
              selected={venue.venueId === selectedVenueId}
              onPress={onSelect ? () => onSelect(venue.venueId) : undefined}
              onOpenDetails={onOpenDetails ? () => onOpenDetails(venue.venueId) : undefined}
              testID={testID ? `${testID}-${venue.venueId}` : undefined}
            />
          ))}
        </View>
      )}

      <ExcludedSection
        excluded={excluded}
        venueNames={{ ...venueNames, ...namesFromExclusions(excluded) }}
        testID={testID ? `${testID}-excluded` : undefined}
      />

      {/* The confidence legend, so the chips are never unexplained. */}
      {!isEmpty && (
        <Text variant="caption" color={theme.textFaint}>
          {t('confidence.legend')}
        </Text>
      )}
    </View>
  );
}

/**
 * The worst-off participant's travel time for a venue.
 *
 * This is the `floor`-side number PRD-05 §11.3 asks for, and it is the point
 * of the whole product: the headline figure is the person who is worse off,
 * not the average.
 */
function worstOffMinutes(venue: RankedVenue): number {
  if (venue.participants.length === 0) {
    // No per-person data: fall back to the aggregate the engine already
    // computed rather than reporting a zero nobody measured.
    return Array.isArray(venue.minutes) ? venue.minutes[1] : venue.minutes;
  }

  return Math.max(...venue.participants.map((result) => result.minutes));
}

/**
 * An excluded venue is not in `venues`, so its name must come from elsewhere.
 *
 * The engine ships only ids in an exclusion, so an excluded row falls back to
 * the id. The screen passes a lookup when it has the full venue set; this
 * keeps the id as the honest last resort rather than inventing a name.
 */
function namesFromExclusions(excluded: Exclusion[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const exclusion of excluded) {
    names[exclusion.venueId] = names[exclusion.venueId] ?? exclusion.venueId;
  }
  return names;
}

const styles = StyleSheet.create({
  container: {
    gap: space[4],
  },
  rows: {
    gap: space[3],
  },
});
