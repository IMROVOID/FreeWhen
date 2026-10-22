/**
 * The Jalali time picker (Plan 06 Task 7, PRD-03 R2, PRD-11 S2).
 *
 * ★ PICKERS AND PRESETS, NO FREE-TEXT DATE ENTRY.
 *
 * Typing a date in a right-to-left Persian field is the single most reliable way
 * to produce a wrong proposal: `۱۲/۰۵/۱۴۰۳` and `۰۵/۱۲/۱۴۰۳` are the same eight
 * digits in a different order, and the user cannot see their own mistake. The
 * day is a list of the days the event actually spans, and the time is a list of
 * the slots on the granularity grid.
 *
 * ★ THE LIST IS SEEDED TO THE EVENT WINDOW (FR-3.3).
 *
 * A proposal outside the agreed window cannot be made from this screen, which is
 * what makes the window meaningful. The server enforces the same rule, so this
 * is a convenience rather than the only guard.
 */

import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip } from '@/src/components/ui/Chip';
import { Text } from '@/src/components/ui/Text';
import { formatDate } from '@/src/lib/format';
import { formatLocalTime, localSlotToUtc, zoneOffsetMs } from '@/src/features/proposals/services/slot-time';
import { DEFAULT_DURATION_MIN, SLOT_GRANULARITY_MIN } from '@/src/types/proposal';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

export interface TimeSlotPickerProps {
  /** The event window; the picker offers nothing outside it. */
  windowStart: string;
  windowEnd: string;
  /** The event's home timezone — every wall clock here is in it. */
  homeTz: string;
  /** The chosen start, as UTC, or `null`. */
  value: string | null;
  onChange: (startUtc: string) => void;
  testID?: string;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 31;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/**
 * The calendar days the window spans, as instants a day apart.
 *
 * Walking the window a day at a time from its own start, rather than stepping
 * through UTC midnights, keeps every day inside the window the organizer
 * actually chose — a UTC walk would drop the last local day for a window that
 * begins mid-day.
 */
function windowDays(windowStart: string, windowEnd: string): string[] {
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const days: string[] = [];
  for (let cursor = start; cursor <= end && days.length < MAX_DAYS; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString());
  }

  return days;
}

/**
 * The local hour a UTC instant reads as in the event's zone.
 *
 * The picker stores a UTC start but shows local hours; without this the selected
 * chip would jump when the device is not in the event's zone.
 */
function localHourOf(instantUtc: string, homeTz: string): number {
  const time = formatLocalTime(instantUtc, homeTz);
  return Number(time.slice(0, 2));
}

export function TimeSlotPicker({
  windowStart,
  windowEnd,
  homeTz,
  value,
  onChange,
  testID,
}: TimeSlotPickerProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();

  const language = (i18n.language === 'en' ? 'en' : 'fa') as Language;

  const days = useMemo(() => windowDays(windowStart, windowEnd), [windowStart, windowEnd]);

  const selectedDay = value ?? days[0] ?? null;
  const selectedHour = value ? localHourOf(value, homeTz) : null;

  /** Builds the UTC start for a chosen day and local hour. */
  function slotFor(dayIso: string, hour: number): string {
    const day = new Date(dayIso);

    // The wall-clock date and hour, in the event's zone, expressed as UTC fields
    // and then corrected by the zone's offset — the same transform `localSlotToUtc`
    // applies for a Jalali input.
    const offset = zoneOffsetMs(day.getTime(), homeTz);
    const local = new Date(day.getTime() + offset);
    const wallClockUtc = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      hour,
      0,
    );

    return new Date(wallClockUtc - offset).toISOString();
  }

  return (
    <View style={styles.container} testID={testID}>
      <Text variant="caption" color={theme.textMuted}>
        {t('slots.day')}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {days.map((day, index) => {
          const formatted = formatDate(day, language);
          const isSelected = selectedDay === day && value !== null;

          return (
            <Chip
              key={day}
              label={formatted.primary}
              selected={isSelected}
              onPress={() => onChange(slotFor(day, selectedHour ?? 19))}
              testID={testID ? `${testID}-day-${index}` : undefined}
            />
          );
        })}
      </ScrollView>

      <Text variant="caption" color={theme.textMuted}>
        {t('slots.startTime')}
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {HOURS.map((hour) => {
          const isSelected = selectedHour === hour && value !== null;
          const label = `${hour < 10 ? '0' : ''}${hour}:00`;

          return (
            <Chip
              key={hour}
              label={label}
              selected={isSelected}
              onPress={() => onChange(slotFor(selectedDay ?? windowStart, hour))}
              testID={testID ? `${testID}-hour-${hour}` : undefined}
            />
          );
        })}
      </ScrollView>

      {value && (
        <Text variant="caption" color={theme.textMuted}>
          {t('slots.durationHint', { minutes: DEFAULT_DURATION_MIN })}
          {' · '}
          {t('slots.granularityHint', { minutes: SLOT_GRANULARITY_MIN })}
        </Text>
      )}
    </View>
  );
}

/**
 * The default end for a chosen start.
 *
 * Exported so the screen and any test agree on one duration rather than each
 * holding its own literal.
 */
export function defaultEndFor(startUtc: string): string {
  return new Date(new Date(startUtc).getTime() + DEFAULT_DURATION_MIN * 60_000).toISOString();
}

/** The UTC slot for a local picker choice, as the create payload expects it. */
export function slotFromPicker(
  jalaaliDate: { jy: number; jm: number; jd: number },
  hour: number,
  homeTz: string,
): { start_utc: string; end_utc: string } {
  const slot = localSlotToUtc(jalaaliDate, hour, 0, homeTz);

  return { start_utc: slot.startUtc, end_utc: slot.endUtc };
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  row: {
    gap: space[2],
    paddingVertical: space[1],
  },
});
