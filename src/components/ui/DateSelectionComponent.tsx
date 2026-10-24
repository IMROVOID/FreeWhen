/**
 * A modern, accessible Jalali Date Selection Component.
 *
 * Provides a clean day selector with weekday names, Persian day numbers,
 * month badges, and quick-step navigation within the event window.
 */

import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from 'phosphor-react-native';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { formatDate } from '@/src/lib/format';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { Language } from '@/src/i18n/types';

export interface DateSelectionComponentProps {
  /** The event date window; selector restricts to these bounds. */
  windowStart: string;
  windowEnd: string;
  /** Currently selected ISO date */
  value: string;
  onChange: (isoDate: string) => void;
  testID?: string;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 60;

function generateDays(windowStart: string, windowEnd: string): string[] {
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    // Fallback: 14 days from now
    const now = Date.now();
    return Array.from({ length: 14 }, (_, i) => new Date(now + i * DAY_MS).toISOString());
  }

  const days: string[] = [];
  for (let cursor = start; cursor <= end && days.length < MAX_DAYS; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString());
  }
  return days;
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

  const days = useMemo(() => generateDays(windowStart, windowEnd), [windowStart, windowEnd]);

  // Find index of selected day
  const selectedDayValue = value || days[0] || new Date().toISOString();
  const selectedDateOnly = selectedDayValue.slice(0, 10);

  const selectedIndex = Math.max(
    0,
    days.findIndex((d) => d.slice(0, 10) === selectedDateOnly),
  );

  const currentFormatted = formatDate(days[selectedIndex] ?? selectedDayValue, locale);

  const handlePrevDay = () => {
    if (selectedIndex > 0) {
      onChange(days[selectedIndex - 1]!);
    }
  };

  const handleNextDay = () => {
    if (selectedIndex < days.length - 1) {
      onChange(days[selectedIndex + 1]!);
    }
  };

  return (
    <View style={styles.container} testID={testID}>
      {/* Date Header with Stepper Buttons */}
      <View style={[styles.headerCard, { backgroundColor: theme.surface2 }]}>
        <Pressy
          onPress={handlePrevDay}
          disabled={selectedIndex === 0}
          accessibilityRole="button"
          accessibilityLabel={t('common.previous', 'قبلی')}
          style={styles.navButton}
        >
          <View style={[styles.navIcon, selectedIndex === 0 && styles.disabled]}>
            <CaretRight size={20} color={selectedIndex === 0 ? theme.textFaint : theme.text} />
          </View>
        </Pressy>

        <View style={styles.headerTitle}>
          <Text variant="caption" color={theme.textMuted} align="center">
            {t('slots.chosenDate', 'تاریخ انتخاب‌شده')}
          </Text>
          <Text variant="bodyL" color={theme.primary} align="center" numeric>
            {currentFormatted.primary}
          </Text>
        </View>

        <Pressy
          onPress={handleNextDay}
          disabled={selectedIndex === days.length - 1}
          accessibilityRole="button"
          accessibilityLabel={t('common.next', 'بعدی')}
          style={styles.navButton}
        >
          <View style={[styles.navIcon, selectedIndex === days.length - 1 && styles.disabled]}>
            <CaretLeft size={20} color={selectedIndex === days.length - 1 ? theme.textFaint : theme.text} />
          </View>
        </Pressy>
      </View>

      {/* Horizontal Day Carousel */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
      >
        {days.map((dayIso, index) => {
          const isSelected = index === selectedIndex;
          const formatted = formatDate(dayIso, locale);
          // Split out components for the badge
          const parts = formatted.primary.split(' ');
          const weekday = parts[0] ?? '';
          const dayNumber = parts[1] ?? '';
          const monthName = parts[2] ?? '';

          return (
            <Pressy
              key={dayIso}
              onPress={() => onChange(dayIso)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              testID={testID ? `${testID}-day-${index}` : undefined}
              style={styles.dayCardPressy}
            >
              <View
                style={[
                  styles.dayCard,
                  {
                    backgroundColor: isSelected ? theme.primary : theme.surface2,
                    borderColor: isSelected ? theme.primary : theme.line,
                  },
                ]}
              >
                <Text
                  variant="caption"
                  color={isSelected ? theme.onPrimary : theme.textMuted}
                  align="center"
                >
                  {weekday}
                </Text>
                <Text
                  variant="h2"
                  color={isSelected ? theme.onPrimary : theme.text}
                  align="center"
                  numeric
                >
                  {dayNumber}
                </Text>
                <Text
                  variant="caption"
                  color={isSelected ? theme.onPrimary : theme.textFaint}
                  align="center"
                >
                  {monthName}
                </Text>
              </View>
            </Pressy>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
    gap: space[1],
  },
  navButton: {
    padding: space[1],
  },
  navIcon: {
    width: size.stepperButton,
    height: size.stepperButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.3,
  },
  carousel: {
    gap: space[2],
    paddingVertical: space[1],
  },
  dayCardPressy: {
    alignSelf: 'stretch',
  },
  dayCard: {
    width: size.buttonLarge + space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    borderWidth: border.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
});
