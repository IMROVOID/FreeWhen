/**
 * A drum-roll scroll wheel time picker (Hours, Minutes, AM/PM).
 *
 * Designed to match modern Material You / iOS drum wheel selectors with
 * middle window framing, smooth deceleration snapping, and haptic feedback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { haptics } from '@/src/platform/haptics';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface TimeWheelPickerProps {
  /** 24-hour hour (0-23) */
  hour24?: number;
  /** Minute (0-59) */
  minute?: number;
  onChange: (time: { hour24: number; minute: number; label: string }) => void;
  testID?: string;
}

const ITEM_HEIGHT = size.tabItem; // 44
const WHEEL_HEIGHT = ITEM_HEIGHT * 3; // 132

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10, ... 55
const PERIODS = ['AM', 'PM'] as const;

interface WheelColumnProps<T> {
  items: readonly T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  testID?: string;
}

function WheelColumn<T>({
  items,
  selectedIndex,
  onSelect,
  renderItem,
  testID,
}: WheelColumnProps<T>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrollRef = useRef<any>(null);
  const lastIndex = useRef(selectedIndex);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: true });
      lastIndex.current = selectedIndex;
    }
  }, [selectedIndex]);

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const index = Math.max(0, Math.min(items.length - 1, Math.round(y / ITEM_HEIGHT)));
      if (index !== lastIndex.current) {
        lastIndex.current = index;
        haptics.impact('light');
        onSelect(index);
      }
    },
    [items.length, onSelect],
  );

  return (
    <View style={styles.column} testID={testID}>
      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        contentContainerStyle={styles.columnContent}
      >
        <View style={styles.spacer} />
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Pressable
              key={String(index)}
              style={styles.itemWrapper}
              onPress={() => {
                if (index !== selectedIndex) {
                  onSelect(index);
                  scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
                  haptics.impact('light');
                }
              }}
            >
              {renderItem(item, isSelected)}
            </Pressable>
          );
        })}
        <View style={styles.spacer} />
      </ScrollView>
    </View>
  );
}

export function TimeWheelPicker({
  hour24 = 19,
  minute = 0,
  onChange,
  testID,
}: TimeWheelPickerProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  // Convert 24-hour to 12-hour + period
  const initialPeriod: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM';
  const initialHour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const initialHourIndex = Math.max(0, HOURS_12.indexOf(initialHour12));
  // Snap minute to nearest 5
  const roundedMinute = Math.round(minute / 5) * 5 % 60;
  const initialMinuteIndex = Math.max(0, MINUTES.indexOf(roundedMinute));
  const initialPeriodIndex = initialPeriod === 'PM' ? 1 : 0;

  const [hourIndex, setHourIndex] = useState(initialHourIndex);
  const [minuteIndex, setMinuteIndex] = useState(initialMinuteIndex);
  const [periodIndex, setPeriodIndex] = useState(initialPeriodIndex);

  const notifyChange = useCallback(
    (hIdx: number, mIdx: number, pIdx: number) => {
      const h12 = HOURS_12[hIdx] ?? 12;
      const m = MINUTES[mIdx] ?? 0;
      const p = PERIODS[pIdx] ?? 'PM';

      let resolvedHour24 = h12 % 12;
      if (p === 'PM') resolvedHour24 += 12;

      const formattedHour = resolvedHour24 < 10 ? `0${resolvedHour24}` : `${resolvedHour24}`;
      const formattedMinute = m < 10 ? `0${m}` : `${m}`;
      const label = `${formattedHour}:${formattedMinute}`;

      onChange({ hour24: resolvedHour24, minute: m, label });
    },
    [onChange],
  );

  const handleHourSelect = useCallback(
    (idx: number) => {
      setHourIndex(idx);
      notifyChange(idx, minuteIndex, periodIndex);
    },
    [minuteIndex, periodIndex, notifyChange],
  );

  const handleMinuteSelect = useCallback(
    (idx: number) => {
      setMinuteIndex(idx);
      notifyChange(hourIndex, idx, periodIndex);
    },
    [hourIndex, periodIndex, notifyChange],
  );

  const handlePeriodSelect = useCallback(
    (idx: number) => {
      setPeriodIndex(idx);
      notifyChange(hourIndex, minuteIndex, idx);
    },
    [hourIndex, minuteIndex, notifyChange],
  );

  const selectedHour = HOURS_12[hourIndex] ?? 12;
  const selectedMinute = MINUTES[minuteIndex] ?? 0;
  const selectedPeriod = PERIODS[periodIndex] ?? 'PM';

  const hourDisplay = selectedHour < 10 ? `0${selectedHour}` : `${selectedHour}`;
  const minuteDisplay = selectedMinute < 10 ? `0${selectedMinute}` : `${selectedMinute}`;
  const periodLabel = selectedPeriod === 'AM' ? t('slots.am', 'ق.ظ') : t('slots.pm', 'ب.ظ');

  return (
    <View style={styles.container} testID={testID}>
      {/* Current selection summary */}
      <View style={[styles.summaryBadge, { backgroundColor: theme.surface2 }]}>
        <Text variant="caption" color={theme.textMuted}>
          {t('slots.chosenTime', 'زمان انتخاب‌شده:')}
        </Text>
        <Text variant="h3" color={theme.primary} numeric>
          {`${hourDisplay}:${minuteDisplay} ${periodLabel}`}
        </Text>
      </View>

      {/* Drum-Roll Wheels Container */}
      <View style={[styles.wheelFrame, { backgroundColor: theme.surface1, borderColor: theme.line }]}>
        {/* Middle highlight frame */}
        <View
          style={[
            styles.middleWindow,
            { borderColor: theme.primary, backgroundColor: theme.surface2 },
          ]}
          pointerEvents="none"
        />

        {/* Column 1: Hours */}
        <WheelColumn
          items={HOURS_12}
          selectedIndex={hourIndex}
          onSelect={handleHourSelect}
          testID={testID ? `${testID}-hours` : undefined}
          renderItem={(h, isSelected) => {
            const display = h < 10 ? `0${h}` : `${h}`;
            return (
              <Text
                variant="h3"
                color={isSelected ? theme.text : theme.textFaint}
                align="center"
                numeric
              >
                {display}
              </Text>
            );
          }}
        />

        {/* Separator Colon */}
        <View style={styles.colonWrapper} pointerEvents="none">
          <Text variant="h2" color={theme.textMuted} align="center">
            :
          </Text>
        </View>

        {/* Column 2: Minutes */}
        <WheelColumn
          items={MINUTES}
          selectedIndex={minuteIndex}
          onSelect={handleMinuteSelect}
          testID={testID ? `${testID}-minutes` : undefined}
          renderItem={(m, isSelected) => {
            const display = m < 10 ? `0${m}` : `${m}`;
            return (
              <Text
                variant="h3"
                color={isSelected ? theme.text : theme.textFaint}
                align="center"
                numeric
              >
                {display}
              </Text>
            );
          }}
        />

        {/* Column 3: AM / PM */}
        <WheelColumn
          items={PERIODS}
          selectedIndex={periodIndex}
          onSelect={handlePeriodSelect}
          testID={testID ? `${testID}-period` : undefined}
          renderItem={(p, isSelected) => {
            const label = p === 'AM' ? t('slots.am', 'ق.ظ') : t('slots.pm', 'ب.ظ');
            return (
              <Text
                variant="bodyL"
                color={isSelected ? theme.primary : theme.textFaint}
                align="center"
              >
                {label}
              </Text>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  summaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  wheelFrame: {
    height: WHEEL_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: border.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  middleWindow: {
    position: 'absolute',
    start: space[2],
    end: space[2],
    top: ITEM_HEIGHT,
    height: ITEM_HEIGHT,
    borderRadius: radius.md,
    borderWidth: border.hairline,
  },
  column: {
    flex: 1,
    height: WHEEL_HEIGHT,
  },
  columnContent: {
    alignItems: 'center',
  },
  spacer: {
    height: ITEM_HEIGHT,
  },
  itemWrapper: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  colonWrapper: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
});
