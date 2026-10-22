/**
 * The availability grid (Plan 14 Task 9, PRD-03 FR-3.7–FR-3.10).
 *
 * ★ THERE IS NO `availability` TABLE, AND THIS COMPONENT DOES NOT WANT ONE.
 *
 * Every cell is rendered from a proposal. Tapping a cell creates one through the
 * ordinary create path; tapping a painted cell withdraws the current
 * participant's proposal for it. Two stores would let the grid and the list
 * answer "when can people meet?" differently, and the user has no way to tell
 * which one is lying (FR-3.10, AC-3.2.1).
 *
 * ★ A CELL WITH NOBODY ON IT IS NOT EMPTY — IT IS UNPAINTED.
 *
 * The grid is a suggestion surface, not a calendar. A blank cell means no one has
 * offered that slot yet, which is different from "everyone is busy"; the copy
 * says so rather than letting the user read absence as a conflict.
 *
 * ★ EVERY CELL ANNOUNCES ITSELF IN WORDS (AC-3.1.2, Style Guide §8).
 *
 * «شنبه ۱۹:۰۰ — ۵ نفر». The fill is a second signal, never the only one.
 */

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { proposalsToGrid } from '@/src/features/proposals/services/grid-adapter';
import { createProposal } from '@/src/features/proposals/services/create-proposal';
import { withdrawProposal } from '@/src/features/proposals/services/create-proposal';
import { isApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import { DEFAULT_DURATION_MIN, type Proposal } from '@/src/types/proposal';
import type { Language } from '@/src/i18n/types';

import {
  cellFor,
  cellInterval,
  cellKey,
  columnLabel,
  gridLayout,
  heatFraction,
  paintCounts,
  type GridCellRef,
} from './grid-geometry';

export interface AvailabilityGridProps {
  eventId: string;
  /** The proposals the grid renders. It owns no state of its own. */
  proposals: readonly Proposal[];
  windowStartDate: string;
  windowEndDate: string;
  homeTz: string;
  locale: Language;
  /** Called after a paint, so the parent can refetch from the one dataset. */
  onChanged: () => void;
  /** The caller's own proposals, so a second tap on their cell withdraws it. */
  myProposalIds: ReadonlySet<string>;
  testID?: string;
}

/** One cell's contents for a day and band. */
function proposalsIn(
  proposals: readonly Proposal[],
  layout: ReturnType<typeof gridLayout>,
  homeTz: string,
  ref: GridCellRef,
): Proposal[] {
  return proposals.filter((proposal) => {
    if (proposal.start_utc === null || proposal.status === 'WITHDRAWN') return false;
    const cell = cellFor(proposal.start_utc, layout, homeTz);
    return cell !== null && cell.day === ref.day && cell.band === ref.band;
  });
}

export function AvailabilityGrid({
  eventId,
  proposals,
  windowStartDate,
  windowEndDate,
  homeTz,
  locale,
  onChanged,
  myProposalIds,
  testID,
}: AvailabilityGridProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const layout = useMemo(
    () => gridLayout(windowStartDate, windowEndDate),
    [windowStartDate, windowEndDate],
  );

  // The cells the aggregate heat is computed from — the same `proposalsToGrid`
  // the list uses, so the grid cannot be reading a second dataset (FR-3.10).
  const counts = useMemo(
    () => paintCounts(proposalsToGrid(proposals), layout, homeTz),
    [proposals, layout, homeTz],
  );

  const max = useMemo(() => Math.max(0, ...counts.values()), [counts]);

  const paint = useCallback(
    async (ref: GridCellRef) => {
      const key = cellKey(ref);
      if (busyKey !== null) return;

      const here = proposalsIn(proposals, layout, homeTz, ref);
      const mine = here.find((proposal) => myProposalIds.has(proposal.id)) ?? null;

      setBusyKey(key);
      setErrorKey(null);

      try {
        const userId = await getStoredUserId();

        // ★ ONE DATASET: A SECOND TAP WITHDRAWS, IT DOES NOT DELETE.
        //
        // Withdrawal is a status change, so the fact that somebody offered this
        // slot and changed their mind survives — which is what the history is
        // for. A delete would erase the suggestion from the record entirely.
        if (mine) {
          await withdrawProposal(mine.id, userId);
        } else {
          const interval = cellInterval(ref, layout, homeTz);
          if (!interval) return;

          await createProposal(
            eventId,
            {
              type: 'TIME',
              title: t('availability.cellTitle', {
                weekday: columnLabel(layout.dates[ref.day] ?? '', locale === 'en' ? 'en' : 'fa'),
                time: layout.bandHours[ref.band] ?? 0,
              }),
              notes: null,
              link: null,
              start_utc: interval.startUtc,
              end_utc: interval.endUtc,
              venue: null,
            },
            userId,
          );
        }

        onChanged();
      } catch (error) {
        // A failed paint is a line under the grid, not a wall over it: nothing
        // was lost, and the cell is still there to try again.
        setErrorKey(isApiFailure(error) ? error.messageKey : 'errors.unknown');
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, eventId, homeTz, layout, locale, myProposalIds, onChanged, proposals, t],
  );

  return (
    <View style={styles.container} testID={testID}>
      <Text variant="h3">{t('availability.heading')}</Text>
      <Text variant="caption" color={theme.textMuted}>
        {t('availability.hint')}
      </Text>

      {errorKey && (
        <Text variant="caption" color={theme.danger} testID={testID ? `${testID}-error` : undefined}>
          {t(errorKey)}
        </Text>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID ? `${testID}-scroll` : undefined}>
        <View style={styles.table}>
          <View style={styles.headerRow}>
            <View style={styles.cornerCell} />
            {layout.dates.map((date) => (
              <View key={date} style={styles.headerCell}>
                <Text variant="caption" color={theme.textMuted} align="center" numberOfLines={1}>
                  {columnLabel(date, locale === 'en' ? 'en' : 'fa')}
                </Text>
              </View>
            ))}
          </View>

          {layout.bandHours.map((hour, band) => (
            <View key={hour} style={styles.row}>
              <View style={styles.rowLabel}>
                <Text variant="caption" color={theme.textMuted}>
                  {`${hour}:00`}
                </Text>
              </View>

              {layout.dates.map((date, day) => {
                const ref = { day, band };
                const key = cellKey(ref);
                const here = proposalsIn(proposals, layout, homeTz, ref);
                const mine = here.some((proposal) => myProposalIds.has(proposal.id));
                const count = counts.get(key) ?? 0;
                const fraction = heatFraction(count, max);

                const weekday = columnLabel(date, locale === 'en' ? 'en' : 'fa');
                const label = t('availability.cellLabel', { weekday, time: `${hour}:00`, count });

                return (
                  <Pressy
                    key={key}
                    onPress={() => void paint(ref)}
                    disabled={busyKey !== null}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: mine, disabled: busyKey !== null, busy: busyKey === key }}
                    testID={testID ? `${testID}-cell-${key}` : undefined}
                    style={styles.cellPress}
                  >
                    <View
                      style={[
                        styles.cell,
                        {
                          backgroundColor: count > 0 ? theme.primary : theme.surface2,
                          opacity: count > 0 ? 0.35 + fraction * 0.65 : 1,
                          borderColor: mine ? theme.brand : theme.line,
                          borderWidth: mine ? border.strong : border.hairline,
                        },
                      ]}
                    >
                      {/* ★ THE COUNT IS TEXT, NOT ONLY A SHADE (§8). */}
                      {count > 0 && (
                        <Text variant="caption" color={theme.onPrimary} align="center">
                          {count}
                        </Text>
                      )}
                    </View>
                  </Pressy>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <Text variant="caption" color={theme.textFaint} testID={testID ? `${testID}-legend` : undefined}>
        {t('availability.legend', { minutes: DEFAULT_DURATION_MIN })}
      </Text>
    </View>
  );
}

const CELL_WIDTH = size.chip;
const CELL_HEIGHT = size.stepperButton;
const ROW_LABEL_WIDTH = 52;

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  table: {
    gap: space[1],
  },
  headerRow: {
    flexDirection: 'row',
    gap: space[1],
  },
  cornerCell: {
    width: ROW_LABEL_WIDTH,
  },
  headerCell: {
    width: CELL_WIDTH,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  rowLabel: {
    width: ROW_LABEL_WIDTH,
  },
  cellPress: {
    width: CELL_WIDTH,
  },
  cell: {
    height: CELL_HEIGHT,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
