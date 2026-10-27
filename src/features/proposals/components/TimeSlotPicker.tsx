/**
 * The Jalali time picker (Plan 06 Task 7, PRD-03 R2, PRD-11 S2).
 *
 * Upgraded with:
 * - An interactive Jalali Date Selection Component with weekday navigation.
 * - A drum-roll Time Scroll Wheel Picker (Hours, Minutes, AM/PM).
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { DateSelectionComponent } from '@/src/components/ui/DateSelectionComponent';
import { TimeWheelPicker } from '@/src/components/ui/TimeWheelPicker';
import { Text } from '@/src/components/ui/Text';
import {
  formatLocalTime,
  localSlotToUtc,
  zoneOffsetMs,
} from '@/src/features/proposals/services/slot-time';
import { DEFAULT_DURATION_MIN, SLOT_GRANULARITY_MIN } from '@/src/types/proposal';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

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

function localHourOf(instantUtc: string, homeTz: string): number {
  const time = formatLocalTime(instantUtc, homeTz);
  return Number(time.slice(0, 2));
}

function localMinuteOf(instantUtc: string, homeTz: string): number {
  const time = formatLocalTime(instantUtc, homeTz);
  return Number(time.slice(3, 5)) || 0;
}

export function TimeSlotPicker({
  windowStart,
  windowEnd,
  homeTz,
  value,
  onChange,
  testID,
}: TimeSlotPickerProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const selectedDay = value ?? new Date().toISOString();
  const selectedHour = value ? localHourOf(value, homeTz) : 19;
  const selectedMinute = value ? localMinuteOf(value, homeTz) : 0;

  /** Builds the UTC start for a chosen day and local hour/minute. */
  function slotFor(dayIso: string, hour: number, minute: number): string {
    const day = new Date(dayIso);
    const offset = zoneOffsetMs(day.getTime(), homeTz);
    const local = new Date(day.getTime() + offset);
    const wallClockUtc = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      hour,
      minute,
    );

    return new Date(wallClockUtc - offset).toISOString();
  }

  return (
    <View style={styles.container} testID={testID}>
      {/* 1. Date Selection Component */}
      <Text variant="caption" color={theme.textMuted}>
        {t('slots.day')}
      </Text>
      <DateSelectionComponent
        windowStart={windowStart}
        windowEnd={windowEnd}
        value={selectedDay}
        onChange={(newDay) => onChange(slotFor(newDay, selectedHour, selectedMinute))}
        testID={testID ? `${testID}-date` : undefined}
      />

      {/* 2. Drum-Roll Scroll Wheel Time Picker */}
      <Text variant="caption" color={theme.textMuted} style={styles.timeLabel}>
        {t('slots.startTime')}
      </Text>
      <TimeWheelPicker
        hour24={selectedHour}
        minute={selectedMinute}
        onChange={({ hour24, minute }) => onChange(slotFor(selectedDay, hour24, minute))}
        testID={testID ? `${testID}-wheel` : undefined}
      />

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

/** The default end for a chosen start. */
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
    gap: space[3],
  },
  timeLabel: {
    marginTop: space[2],
  },
});
