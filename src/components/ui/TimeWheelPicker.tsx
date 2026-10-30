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
import {
  indexForScroll,
  snapOffsetFor,
} from '@/src/components/ui/time-wheel-geometry';
import { haptics } from '@/src/platform/haptics';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

/**
 * ★ THE FOCUS RING IS SUPPRESSED FOR A MOUSE ONLY.
 *
 * `outline: none` on the item would remove the ring a keyboard user needs to see
 * where they are — the report is about the box a CLICK leaves behind, not about
 * focus indication. `:focus:not(:focus-visible)` is the browser's own distinction
 * between the two, so it is used rather than guessed at.
 *
 * The rule is scoped by the wheel's own testID-ish attribute so it cannot leak
 * into any other focusable element on the screen.
 */
const POINTER_FOCUS_CSS = `
[data-freewhen-wheel] { -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
/* Pointer focus is invisible; :focus-visible keeps the keyboard ring. */
[data-freewhen-wheel] :focus:not(:focus-visible) { outline: none; }
`;

/**
 * Installs the wheel's stylesheet once, on the web.
 *
 * A `StyleSheet` entry cannot express `:focus:not(:focus-visible)`, and the
 * property being fixed IS that distinction — suppressing the outline from a style
 * would remove it for keyboard users too. Guarded by `document`, so native (where
 * this is meaningless) does nothing.
 */
function installWheelCss(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('freewhen-time-wheel-css')) return;

  const style = document.createElement('style');
  style.id = 'freewhen-time-wheel-css';
  style.textContent = POINTER_FOCUS_CSS;
  document.head.appendChild(style);
}

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

  /**
   * ★ THE DRUM IS DRAGGED BY THE POINTER, NOT ONLY BY THE BROWSER'S SCROLL.
   *
   * On react-native-web this is a `div` with `overflow: auto`. A mouse drag inside
   * a block of text is a SELECTION gesture, not a scroll, so on the web build the
   * wheel could not be dragged at all: the labels came up highlighted and the
   * reader had to click each time individually. Touch worked, which is why it
   * survived a phone review.
   *
   * So the pointer drives `scrollTop` itself, and the column refuses to be
   * selected. `snapToInterval` and the momentum handlers still serve touch and a
   * real trackpad; this is the path a mouse needs.
   */
  const drag = useRef<{ startY: number; startScroll: number; moved: boolean } | null>(null);

  const scrollNode = useCallback((): HTMLElement | null => {
    const node = scrollRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.scrollTop !== 'number') return null;
    return node;
  }, []);

  const onPointerDown = useCallback(
    (event: { nativeEvent: { clientY?: number; pageY?: number } }) => {
      const node = scrollNode();
      if (!node) return;

      const y = event.nativeEvent.clientY ?? event.nativeEvent.pageY ?? 0;
      drag.current = { startY: y, startScroll: node.scrollTop, moved: false };
    },
    [scrollNode],
  );

  const onPointerMove = useCallback(
    (event: { nativeEvent: { clientY?: number; pageY?: number } }) => {
      const state = drag.current;
      const node = scrollNode();
      if (!state || !node) return;

      const y = event.nativeEvent.clientY ?? event.nativeEvent.pageY ?? 0;
      const dy = y - state.startY;

      // A few pixels of travel is a click, not a drag; below that the press still
      // selects the item under the finger.
      if (Math.abs(dy) > 3) state.moved = true;
      if (!state.moved) return;

      node.scrollTop = state.startScroll - dy;
    },
    [scrollNode],
  );

  const settleFromOffset = useCallback(
    (node: HTMLElement) => {
      const offset = snapOffsetFor(node.scrollTop, items.length, ITEM_HEIGHT);
      node.scrollTop = offset;

      const index = indexForScroll(offset, items.length, ITEM_HEIGHT);
      if (index !== lastIndex.current) {
        lastIndex.current = index;
        onSelect(index);
      }
    },
    [items.length, onSelect],
  );

  const endDrag = useCallback(() => {
    const state = drag.current;
    const node = scrollNode();
    drag.current = null;

    if (!state || !node || !state.moved) return;
    settleFromOffset(node);
  }, [scrollNode, settleFromOffset]);

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
    <View
      style={styles.column}
      testID={testID}
      /**
       * ★ THE MARKER IS SET IMPERATIVELY, BECAUSE THE SHEET DROPS UNKNOWN PROPS.
       *
       * react-native-web filters props it does not recognise, so a `data-*`
       * attribute passed through JSX never reaches the DOM — measured: the
       * column carried only `class` and `data-testid`, and the stylesheet's
       * `[data-freewhen-wheel]` selector matched nothing at all. Writing the
       * attribute on the node is what actually scopes the rules.
       */
      ref={(node) => {
        const el = node as unknown as HTMLElement | null;
        if (el && typeof el.setAttribute === 'function') {
          el.setAttribute('data-freewhen-wheel', '');
        }
      }}
    >
      <ScrollView
        ref={scrollRef}
        nestedScrollEnabled={true}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        contentContainerStyle={styles.columnContent}
        // ★ THE COLUMN ITSELF MUST SCROLL ON THE WEB BUILD.
        //
        // react-native-web compiles `ScrollView` to a div and only gives it
        // `overflow: auto` when it is told the scroll axis is enabled — measured:
        // `overflow-y: visible`, so `scrollTop` was pinned at 0 and no drag could
        // ever move the drum. Setting it explicitly is what makes the column a
        // real scroller on web; on native these two are ignored.
        {...({ style: styles.wheelScroller } as object)}
        {...({
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerLeave: endDrag,
        } as object)}
      >
        <View style={styles.spacer} />
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <Pressable
              key={String(index)}
              /**
               * ★ THE FOCUS RING IS A KEYBOARD AFFORDANCE, NOT A CLICK EFFECT.
               *
               * Clicking a time left the browser's outline around the item — the
               * box in the report. The outline is suppressed for POINTER focus and
               * kept for `:focus-visible`, which is the browser's own answer to
               * "did this focus come from a keyboard?". Removing it outright would
               * have taken the ring away from keyboard users too.
               */
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

  useEffect(() => {
    installWheelCss();
  }, []);

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
  const periodLabel = selectedPeriod === 'AM' ? t('slots.am') : t('slots.pm');

  return (
    <View style={styles.container} testID={testID}>
      {/* Current selection summary */}
      <View style={[styles.summaryBadge, { backgroundColor: theme.surface2 }]}>
        <Text variant="caption" color={theme.textMuted}>
          {t('slots.chosenTime')}
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
            const label = p === 'AM' ? t('slots.am') : t('slots.pm');
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
    /**
     * ★ A DRAG ON THE WHEEL MUST NOT BECOME A TEXT SELECTION.
     *
     * Declared here for the type-safe part, and completed by the stylesheet in
     * `POINTER_FOCUS_CSS`: React Native's style types have no
     * `WebkitUserSelect`, and the prefixed spelling is not optional — Safari
     * honours only that one, and without it the wheel shows its own numbers
     * highlighted instead of scrolling.
     */
    userSelect: 'none',
  },
  /**
   * The scrollable node inside the column.
   *
   * `overflowY: 'auto'` is the web half: react-native-web leaves a `ScrollView`
   * at `overflow: visible` unless it is told the axis scrolls, and a node that
   * does not scroll has no `scrollTop` to drag. Native ignores it.
   */
  wheelScroller: {
    overflowY: 'auto',
    overflow: 'hidden',
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
