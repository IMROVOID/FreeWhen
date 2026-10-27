/**
 * A complete Jalali and Gregorian Date/Calendar Selection Component.
 *
 * Requirements:
 * - Allows selecting ANY non-past date (not restricted to pre-set windows).
 * - Full interactive Month Calendar grid with month switching and weekday headers.
 * - Horizontal day carousel for quick browsing of upcoming days.
 * - Previous/Next day stepper navigation.
 * - Suggested window indicator badge if within event window bounds.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import {
  gregorianDayToJalali,
  jalaliMonthLength,
  jalaliToGregorianDay,
  monthName,
  PERSIAN_WEEKDAYS,
  toPersianDigits,
  weekdayIndex,
} from '@/src/lib/jalali';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

export interface DateSelectionComponentProps {
  /** Optional event window for indicator hints */
  windowStart?: string;
  windowEnd?: string;
  /** Currently selected ISO date (or YYYY-MM-DD string) */
  value: string;
  onChange: (isoDate: string) => void;
  testID?: string;
}

/** Returns today's date formatted as YYYY-MM-DD in local time */
function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function DateSelectionComponent({
  windowStart,
  windowEnd,
  value,
  onChange,
  testID,
}: DateSelectionComponentProps) {
  const { t, i18n } = useTranslation();
  const { t: theme } = useTheme();
  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';
  const isFa = locale === 'fa';

  const todayIso = useMemo(() => getTodayIsoDate(), []);

  // Normalize selected date to YYYY-MM-DD
  const selectedDateOnly = useMemo(() => {
    if (!value) return todayIso;
    const dateStr = value.slice(0, 10);
    // Disallow past date if selected is before today
    return dateStr < todayIso ? todayIso : dateStr;
  }, [value, todayIso]);

  // Selected date's Jalali representation
  const selectedJalali = useMemo(() => {
    try {
      return gregorianDayToJalali(selectedDateOnly);
    } catch {
      return gregorianDayToJalali(todayIso);
    }
  }, [selectedDateOnly, todayIso]);

  // Calendar month view state (year & month currently viewed)
  const [viewYear, setViewYear] = useState<number>(selectedJalali.jy);
  const [viewMonth, setViewMonth] = useState<number>(selectedJalali.jm);

  // Format header banner label
  const headerDateLabel = useMemo(() => {
    try {
      const j = gregorianDayToJalali(selectedDateOnly);
      const wIdx = weekdayIndex(`${selectedDateOnly}T12:00:00Z`, locale);
      const wName = isFa ? PERSIAN_WEEKDAYS[wIdx] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][wIdx];
      // A month NAME in both locales. The English branch used to build the
      // slash form below, which read as "1405/8/12" — a month number, not a month.
      const mName = monthName(j.jm, isFa ? 'fa' : 'en');
      const dNum = isFa ? toPersianDigits(String(j.jd)) : String(j.jd);
      const yNum = isFa ? toPersianDigits(String(j.jy)) : String(j.jy);

      return isFa ? `${wName}، ${dNum} ${mName} ${yNum}` : `${wName}, ${mName} ${dNum} ${yNum}`;
    } catch {
      return selectedDateOnly;
    }
  }, [selectedDateOnly, locale, isFa]);

  // Month navigation for Calendar grid
  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Compute calendar grid days for current (viewYear, viewMonth)
  const monthGridDays = useMemo(() => {
    const daysCount = jalaliMonthLength(viewYear, viewMonth);
    // Find weekday of first day of the month
    const firstDayGregorian = jalaliToGregorianDay(viewYear, viewMonth, 1);
    const firstWeekday = weekdayIndex(`${firstDayGregorian}T12:00:00Z`, locale);

    // Padding cells before first day
    const blanks = Array.from({ length: firstWeekday }, (_, i) => ({
      key: `blank-${i}`,
      isDay: false,
      dayNumber: 0,
      isoDate: '',
      isPast: true,
      isSelected: false,
      isInWindow: false,
    }));

    const days = Array.from({ length: daysCount }, (_, i) => {
      const dayNum = i + 1;
      const iso = jalaliToGregorianDay(viewYear, viewMonth, dayNum);
      const isPast = iso < todayIso;
      const isSelected = iso === selectedDateOnly;
      const isInWindow = Boolean(
        windowStart &&
          windowEnd &&
          iso >= windowStart.slice(0, 10) &&
          iso <= windowEnd.slice(0, 10),
      );

      return {
        key: `day-${dayNum}`,
        isDay: true,
        dayNumber: dayNum,
        isoDate: iso,
        isPast,
        isSelected,
        isInWindow,
      };
    });

    return [...blanks, ...days];
  }, [viewYear, viewMonth, locale, todayIso, selectedDateOnly, windowStart, windowEnd]);

  const viewMonthName = monthName(viewMonth, isFa ? 'fa' : 'en');
  const viewYearDisplay = isFa ? toPersianDigits(String(viewYear)) : String(viewYear);

  return (
    <View style={styles.container} testID={testID}>
      {/* 1. Header with Selected Date label */}
      <View style={[styles.headerCard, { backgroundColor: theme.surface2 }]}>
        <View style={styles.headerTitle}>
          <Text variant="caption" color={theme.textMuted} align="center">
            {t('slots.chosenDate')}
          </Text>
          <Text variant="bodyL" color={theme.primary} align="center" numeric>
            {headerDateLabel}
          </Text>
        </View>
      </View>

      {/* 2. Interactive Month Calendar Grid (Always visible) */}
      <View style={[styles.calendarGridContainer, { backgroundColor: theme.surface2 }]}>
        {/* Month Header with Steppers */}
        <View style={styles.monthHeader}>
          <Pressy onPress={handlePrevMonth} style={styles.monthNavBtn}>
            <CaretRight size={18} color={theme.text} />
          </Pressy>
          <Text variant="h3" color={theme.text} align="center" numeric>
            {`${viewMonthName} ${viewYearDisplay}`}
          </Text>
          <Pressy onPress={handleNextMonth} style={styles.monthNavBtn}>
            <CaretLeft size={18} color={theme.text} />
          </Pressy>
        </View>

        {/* Weekday Abbreviations */}
        <View style={styles.weekdaysRow}>
          {(isFa ? ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']).map((wd, i) => (
            <Text key={`wd-${i}`} variant="caption" color={theme.textMuted} align="center" style={styles.weekdayCell}>
              {wd}
            </Text>
          ))}
        </View>

        {/* Days Grid */}
        <View style={styles.daysGrid}>
          {monthGridDays.map((cell) => {
            if (!cell.isDay) {
              return <View key={cell.key} style={styles.gridCell} />;
            }

            const numDisplay = isFa ? toPersianDigits(String(cell.dayNumber)) : String(cell.dayNumber);

            return (
              <Pressy
                key={cell.key}
                disabled={cell.isPast}
                onPress={() => {
                  onChange(new Date(`${cell.isoDate}T12:00:00Z`).toISOString());
                }}
                style={styles.gridCell}
              >
                <View
                  style={[
                    styles.cellInner,
                    cell.isSelected && [
                      styles.cellSelected,
                      { backgroundColor: theme.primary },
                    ],
                    cell.isPast && styles.disabled,
                  ]}
                >
                  <Text
                    variant="caption"
                    color={cell.isSelected ? theme.onPrimary : cell.isPast ? theme.textFaint : theme.text}
                    align="center"
                    numeric
                  >
                    {numDisplay}
                  </Text>
                </View>
              </Pressy>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  headerCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  headerTitle: {
    alignItems: 'center',
    gap: space[1],
  },
  disabled: {
    opacity: 0.3,
  },
  calendarGridContainer: {
    padding: space[3],
    borderRadius: radius.lg,
    gap: space[2],
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[2],
  },
  monthNavBtn: {
    padding: space[2],
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: space[1],
  },
  weekdayCell: {
    flex: 1,
    textAlign: 'center',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[1] / 2,
  },
  /* ★ THE CELL IS SQUARE BY ASPECT RATIO, SO THE CIRCLE MUST FIT INSIDE IT.
     The inner disc was a FIXED 36pt square (the segmented-control token) sitting
     in a cell that is 14.28% of the grid's width — around 41pt on a 390pt
     phone, but under 36pt on a small one. Where the disc overflowed the cell,
     Android clipped it, and a clipped pill renders as the sharp-cornered
     rectangle this fix is about. `overflow: 'hidden'` plus a circular radius on
     the disc's own size keeps the shape round at every width. */
  cellInner: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: size.segment,
    maxHeight: size.segment,
    alignSelf: 'center',
    borderRadius: radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellSelected: {
    borderRadius: radius.pill,
  },
});
