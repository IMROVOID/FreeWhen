/**
 * The venue detail panel — the honesty screen (Plan 08 Task 6, PRD-11 S10).
 *
 * ★ UNKNOWN IS NEVER BLANK (PRD-11 §15.7, AC-11.6.1).
 *
 * A blank reads as "no constraint", which is exactly how a wheelchair user
 * ends up at an inaccessible venue. Every optional attribute renders
 * `نامشخص` instead. Hours are never "open": absent hours are unknown hours.
 *
 * ★ ACCESSIBILITY IS TRI-STATE, AND UNKNOWN NEVER IMPLIES ACCESSIBLE.
 *
 * `confirmed_yes` / `confirmed_no` / `unknown`. The `unknown` case carries an
 * explicit warning line — `«دسترسی ویلچر تایید نشده است»` — because "we did
 * not check" and "yes" look identical if you only render the positive.
 *
 * ★ THE PANEL IS REACHABLE WITHOUT A WORKING MAP (FR-4.21, AC-4.2.1).
 *
 * It carries the decision-critical information, so it takes plain data as
 * props and imports nothing from the map.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { PerPersonRow } from '@/src/features/venues/components/PerPersonRow';
import { ConfidenceChip } from '@/src/features/venues/components/ConfidenceChip';
import { ACCESSIBILITY_KEY, LENS_KEY } from '@/src/features/venues/services/labels';
import { renderReasonOrEmpty } from '@/src/features/venues/services/reason-render';
import { participantColors, radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import { digits } from '@/src/lib/format';
import type { Language } from '@/src/i18n/types';
import type {
  Lens,
  OpeningHours,
  RankedVenue,
  VenueContext,
} from '@/src/engine/types';

export interface VenueDetailPanelProps {
  venue: RankedVenue;
  /** The rest of the venue record, when the caller has it. */
  context?: VenueContext | null;
  lens: Lens;
  onOpenInMaps?: () => void;
  testID?: string;
}

export function VenueDetailPanel({
  venue,
  context = null,
  lens,
  onOpenInMaps,
  testID,
}: VenueDetailPanelProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const locale = (i18n.language === 'en' ? 'en' : 'fa') as Language;

  const reason = renderReasonOrEmpty(venue.reason, locale);
  const usesTransit = venue.participants.some((result) => result.mode === 'transit');
  const anyEstimated = venue.confidence !== 'high';

  return (
    <View testID={testID} style={styles.container}>
      {/* ── Identity ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        {/* A venue name is data — never translated. */}
        <Text variant="h2" color={theme.text}>
          {venue.name}
        </Text>

        <View style={styles.inlineRow}>
          <Text variant="caption" color={theme.textFaint}>
            {t('ranking.rank')}
          </Text>
          <Text variant="caption" color={theme.text} numeric>
            {venue.rank}
          </Text>
          <ConfidenceChip
            confidence={venue.confidence}
            testID={testID ? `${testID}-confidence` : undefined}
          />
        </View>

        {reason.length > 0 && (
          <Text variant="body" color={theme.textMuted}>
            {reason}
          </Text>
        )}

        {/* ★ The active lens name travels with the reason — an unexplained
            reason is the failure mode OQ-11.2 warns about. */}
        <Text variant="caption" color={theme.textFaint}>
          {t('lens.activeLabel')}: {t(LENS_KEY[lens])}
        </Text>

        {onOpenInMaps && (
          <Button
            label={t('venue.openInMaps')}
            onPress={onOpenInMaps}
            variant="secondary"
            size="medium"
            testID={testID ? `${testID}-open-in-maps` : undefined}
            style={styles.action}
          />
        )}
      </View>

      {/* ── Per-person breakdown ─────────────────────────────────── */}
      <View style={styles.section}>
        <Text variant="h3" color={theme.text}>
          {t('venue.modeLabel')}
        </Text>

        {venue.participants.map((result, index) => (
          <PerPersonRow
            key={result.id}
            result={result}
            color={participantColors[index % participantColors.length]}
            testID={testID ? `${testID}-person-${result.id}` : undefined}
          />
        ))}
      </View>

      {/* ★ The transit explanation, whenever transit was used. */}
      {usesTransit && (
        <Text variant="caption" color={theme.textMuted} testID={testID ? `${testID}-transit` : undefined}>
          {t('venue.transitExplanation')}
        </Text>
      )}

      {/* The provider-independent version of the same statement. */}
      {anyEstimated && !usesTransit && (
        <Text variant="caption" color={theme.textMuted}>
          {t('venue.estimatesExplanation')}
        </Text>
      )}

      {/* ── Attributes: never blank, never "open" ─────────────────── */}
      <View style={styles.section}>
        <Attribute
          label={t('venue.openingHours')}
          value={formatOpeningHours(context?.openingHours ?? null, locale, t)}
        />

        <Attribute
          label={t('venue.price')}
          value={
            context?.priceLevel
              ? t('venue.priceLevel', { level: digits(context.priceLevel, locale) })
              : t('venue.priceUnknown')
          }
        />

        <Attribute
          label={t('venue.accessibilityLabel')}
          value={t(ACCESSIBILITY_KEY[context?.accessibility.stepFreeEntrance ?? 'unknown'])}
        />

        {/* ★ Unknown accessibility carries its own warning line. */}
        {(context?.accessibility.stepFreeEntrance ?? 'unknown') === 'unknown' && (
          <View
            style={[styles.warning, { backgroundColor: theme.surface2, borderColor: theme.warning }]}
            testID={testID ? `${testID}-accessibility-warning` : undefined}
          >
            <Text variant="caption" color={theme.warning}>
              {t('venue.accessibilityUnknownWarning')}
            </Text>
          </View>
        )}

        <Attribute label={t('venue.parking')} value={formatParking(context ?? null, t)} />
      </View>
    </View>
  );
}

/**
 * The `نامشخص` rule.
 *
 * A null, undefined or empty value renders the unknown word. It is never an
 * empty field and never omitted — an absent row would read as "not
 * applicable" rather than "not known" (PRD-11 §15.7).
 */
function Attribute({ label, value }: { label: string; value: string }) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  // Defensive only: every caller already substitutes the unknown word. Kept
  // so a future call site cannot render a blank by accident.
  const text = value.trim().length > 0 ? value : t('venue.unknownField');

  return (
    <View style={styles.attribute}>
      <Text variant="caption" color={theme.textFaint}>
        {label}
      </Text>
      <Text variant="body" color={theme.text}>
        {text}
      </Text>
    </View>
  );
}

/**
 * Opening hours, or the unknown word.
 *
 * ★ ABSENT HOURS ARE NOT "OPEN". A venue with no hours data is a venue whose
 * hours nobody knows.
 */
function formatOpeningHours(
  hours: OpeningHours | null,
  locale: Language,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!hours) return t('venue.openingHoursUnknown');

  return t('venue.openingHoursRange', {
    open: digits(hours.open, locale),
    close: digits(hours.close, locale),
  });
}

/**
 * Parking: the type when known, and the price marked unknown.
 *
 * The venue context carries no parking fields, so the type is unknown here.
 * The line still renders — with both halves stated — rather than disappearing,
 * so that "we do not know the parking" is visible instead of implied.
 */
function formatParking(
  context: VenueContext | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const parking = (context as (VenueContext & { parking?: { type?: string | null } }) | null)
    ?.parking;

  if (!parking?.type) return t('venue.parkingTypeUnknown');

  return t('venue.parkingTypeAndPrice', { type: parking.type });
}

const styles = StyleSheet.create({
  container: {
    gap: space[6],
  },
  section: {
    gap: space[3],
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  attribute: {
    gap: space[1],
  },
  warning: {
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: space[3],
  },
  action: {
    marginTop: space[2],
  },
});
