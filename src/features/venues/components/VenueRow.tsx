/**
 * One ranked venue (Plan 08 Task 3, PRD-05 §11.3, PRD-04 FR-4.13).
 *
 * ★ EXACTLY THREE NUMBERS, THEN A SENTENCE.
 *
 * Worst-off travel time, total time, cost per person — then the one-line
 * reason. Never the raw score vector (floor/mean/gap/utility): a number the
 * user cannot check reads as an authority claim, which is precisely what this
 * product exists to avoid.
 *
 * ★ RANK IS NUMBER + SIZE + COLOUR (PRD-04 FR-4.13, AC-4.6.1).
 *
 * The numeral does the work and survives greyscale; size and colour are
 * redundant emphasis. Rank 1 uses Volt, which means "decided/leading" and is
 * not decoration (Style Guide §2.1) — ranks 2–3 sit on `surface2`.
 *
 * ★ EVERY FIGURE CARRIES ITS CONFIDENCE, AND ESTIMATES ARE RANGES.
 *
 * `displayMinutes` returns a range for anything not high-confidence, so a
 * false integer cannot reach the screen from here even if the payload has one.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@/src/components/ui/Card';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ConfidenceChip } from '@/src/features/venues/components/ConfidenceChip';
import {
  displayMinutes,
  type DisplayMinutes,
} from '@/src/features/venues/services/display-minutes';
import {
  formatCost,
  formatMinutesWithUnit,
  formatRangeWithUnit,
  renderReasonOrEmpty,
} from '@/src/features/venues/services/reason-render';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Theme } from '@/src/theme/tokens';
import { translatorFor } from '@/src/i18n';
import type { Language } from '@/src/i18n/types';
import type { Confidence } from '@/src/routing/types';
import type { RankedVenue } from '@/src/engine/types';

export interface VenueRowProps {
  venue: RankedVenue;
  /** The worst-off participant's travel time, already measured. */
  worstMinutes: number;
  selected?: boolean;
  onPress?: () => void;
  onOpenDetails?: () => void;
  testID?: string;
}

/** The rank badge's diameter per rank tier. Named, never a literal (§15). */
const RANK_SIZE = {
  first: size.tabItem,
  second: size.buttonSmall,
  rest: size.stepperButton,
} as const;

export function VenueRow({
  venue,
  worstMinutes,
  selected = false,
  onPress,
  onOpenDetails,
  testID,
}: VenueRowProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const locale = (i18n.language === 'en' ? 'en' : 'fa') as Language;

  const total: DisplayMinutes = toDisplayMinutes(venue.minutes, venue.confidence);
  const reason = renderReasonOrEmpty(venue.reason, locale);
  const rankTone = rankAppearance(venue.rank, theme);

  return (
    <Card
      variant="surface"
      onPress={onPress}
      testID={testID}
      style={selected ? { borderColor: theme.primary, borderWidth: 2 } : undefined}
    >
      <View style={styles.row}>
        {/* ★ NUMBER + SIZE + COLOUR — never colour alone. */}
        <View
          style={[
            styles.rank,
            {
              width: rankTone.diameter,
              height: rankTone.diameter,
              backgroundColor: rankTone.background,
            },
          ]}
          accessible
          accessibilityLabel={t('ranking.rank') + ' ' + venue.rank}
        >
          <Text variant="h3" color={rankTone.text} numeric align="center">
            {venue.rank}
          </Text>
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            {/* A venue name is DATA — never translated. */}
            <Text variant="h3" style={styles.name} numberOfLines={2}>
              {venue.name}
            </Text>
            <ConfidenceChip
              confidence={venue.confidence}
              testID={testID ? `${testID}-confidence` : undefined}
            />
          </View>

          {/* The three numbers. */}
          <View style={styles.figures}>
            <Figure
              label={t('ranking.worstOff')}
              value={renderFigures(worstMinutes, venue.confidence, locale)}
            />
            <Figure label={t('ranking.total')} value={renderDisplay(total, locale)} />
            <Figure label={t('ranking.costPerPerson')} value={formatCost(venue.totalCost, locale)} />
          </View>

          {/* Then the sentence. */}
          {reason.length > 0 && (
            <Text variant="body" color={theme.textMuted} testID={testID ? `${testID}-reason` : undefined}>
              {reason}
            </Text>
          )}

          {/* ★ The detail panel must be reachable without a working map
              (FR-4.21, AC-4.2.1) — so the row itself carries the action. */}
          {onOpenDetails && (
            <Pressy
              onPress={onOpenDetails}
              testID={testID ? `${testID}-details` : undefined}
              accessibilityRole="button"
              accessibilityLabel={t('ranking.openDetails')}
              style={styles.detailsPress}
            >
              <Text variant="caption" color={theme.primary}>
                {t('ranking.detailsAction')}
              </Text>
            </Pressy>
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * Converts the aggregate's `minutes` union plus its confidence into the
 * presentation union.
 *
 * `RankedVenue.minutes` is already `number | [number, number]`, so a tuple
 * becomes a range directly and a bare number is only allowed through when
 * the confidence is high.
 */
function toDisplayMinutes(
  minutes: number | [number, number],
  confidence: Confidence,
): DisplayMinutes {
  if (Array.isArray(minutes)) {
    return { kind: 'range', low: minutes[0], high: minutes[1] };
  }
  return displayMinutes({ confidence, minutes, minutesRange: null });
}

/** A single worst-off figure, rendered through the same honesty rule. */
function renderFigures(minutes: number, confidence: Confidence, locale: Language): string {
  return renderDisplay(displayMinutes({ confidence, minutes, minutesRange: null }), locale);
}

/**
 * The one place a `DisplayMinutes` becomes text.
 *
 * `unknown` renders `نامشخص` — never `۰`, which would read as "next door".
 */
function renderDisplay(value: DisplayMinutes, locale: Language): string {
  switch (value.kind) {
    case 'exact':
      return formatMinutesWithUnit(value.minutes, locale);
    case 'range':
      return formatRangeWithUnit(value.low, value.high, locale);
    case 'unknown':
      return translatorFor(locale)('common.unknown');
  }
}

interface RankAppearance {
  diameter: number;
  background: string;
  text: string;
}

function rankAppearance(rank: number, theme: Theme): RankAppearance {
  if (rank === 1) {
    return { diameter: RANK_SIZE.first, background: theme.primary, text: theme.onPrimary };
  }
  if (rank === 2 || rank === 3) {
    return { diameter: RANK_SIZE.second, background: theme.surface2, text: theme.text };
  }
  return { diameter: RANK_SIZE.rest, background: theme.surface3, text: theme.textMuted };
}

function Figure({ label, value }: { label: string; value: string }) {
  const { t: theme } = useTheme();

  return (
    <View style={styles.figure}>
      <Text variant="caption" color={theme.textFaint} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="body" color={theme.text} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[3],
  },
  rank: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: space[2],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[2],
  },
  name: {
    flex: 1,
  },
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[4],
  },
  figure: {
    gap: space[1],
  },
  detailsPress: {
    alignSelf: 'flex-start',
    paddingVertical: space[1],
  },
});
