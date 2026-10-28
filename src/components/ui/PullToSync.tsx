/**
 * Pull to resync (Plan 49 T16).
 *
 * ★ THIS IS A DRAG OF THE PAGE, NOT A SENTINEL SPINNER.
 *
 * The request is specific: dragging down should drag the WHOLE PAGE down, reveal a
 * tinted band beneath it with a rotating reload icon, and round the page's top
 * corners while it is displaced — the way a native refresh control feels, rather
 * than a small spinner appearing at the top edge. So the tree is a band and a
 * page, and the page translates.
 *
 * ★ IT DELEGATES THE CADENCE IT CAN.
 *
 * The screens already poll (`useRealtime`, `useProposals`). This trigger calls the
 * same `onRefresh` those expose, so the automatic path adds no second timer — the
 * poller is the automatic refresh, and a pull is a manual one. A component-local
 * interval would double the request rate the backoff work just reduced.
 *
 * ★ NATIVE KEEPS `RefreshControl`.
 *
 * A JS drag over a native ScrollView fights the scroll view's own gesture
 * handling, so on iOS and Android the platform control does this job properly and
 * is used instead. The custom one exists because the web build has no
 * `RefreshControl` at all.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ArrowsClockwise } from 'phosphor-react-native';

import {
  BAND_HEIGHT,
  MAX_PULL,
  REFRESH_THRESHOLD,
  cornerRadiusFor,
  displacementFor,
  shouldRefresh,
} from '@/src/components/ui/pull-to-sync-geometry';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface PullToSyncProps {
  children: React.ReactNode;
  /** Refetches the screen's data. A Promise, so the indicator shows until done. */
  onRefresh: () => Promise<void> | void;
  testID?: string;
}

export function PullToSync({ children, onRefresh, testID = 'pull-to-sync' }: PullToSyncProps) {
  const { t } = useTheme();

  /**
   * ★ ONE ANIMATED VALUE DRIVES THE TRANSLATION, THE RADIUS AND THE BAND.
   *
   * The displacement used to live in React state, written on every move frame, and
   * the corner radius was derived from it. Two things went wrong with that:
   *
   *  - it re-rendered per frame, so the radius arrived a frame late and read as
   *    stepped rather than smooth;
   *  - `settle()` animated `translateY` but only updated the state in the animation's
   *    COMPLETION callback, so on release the radius held its pulled value through
   *    the whole spring and then snapped to 0 — the "sharp again" the report
   *    describes.
   *
   * Keeping it in the animation graph means the radius cannot disagree with the
   * translation at any point in either direction, and the page rounds and un-rounds
   * with the same curve it slides on.
   */
  const translateY = useSharedValue(0);
  const busy = useRef(false);

  const [refreshing, setRefreshing] = useState(false);

  const settle = useCallback(
    (to: number) => {
      translateY.value = withTiming(to, { duration: 180 });
    },
    [translateY],
  );

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;

    settle(BAND_HEIGHT);
    setRefreshing(true);

    try {
      await onRefresh();
    } finally {
      // The indicator is shown for at least as long as the fetch, then the page
      // returns. A flash on an instant cache hit would read as nothing happening.
      settle(0);
      setRefreshing(false);
      busy.current = false;
    }
  }, [onRefresh, settle]);

  /**
   * The radius, read off the same value the page slides on.
   *
   * `cornerRadiusFor` turns a displacement into a radius; driving it through
   * `interpolate` over the value's whole range keeps the mapping in one place (the
   * geometry module) while the animation stays on the native thread.
   */
  const pageStyle = useAnimatedStyle(() => {
    // Mirror the displacement→radius curve at a fixed sample rate. `interpolate`
    // needs static stops, and `MAX_PULL` is the largest displacement the gesture can
    // produce, so the two curves agree everywhere the page can actually be.
    const steps = 32;
    const inputRange = Array.from({ length: steps + 1 }, (_, i) => (i / steps) * MAX_PULL);
    const outputRange = inputRange.map((value) => cornerRadiusFor(value));

    return {
      transform: [{ translateY: translateY.value }],
      borderTopLeftRadius: interpolate(translateY.value, inputRange, outputRange, 'clamp'),
      borderTopRightRadius: interpolate(translateY.value, inputRange, outputRange, 'clamp'),
    };
  });

  const bandStyle = useAnimatedStyle(() => ({
    opacity: refreshing ? 1 : Math.min(1, Math.max(0, translateY.value) / BAND_HEIGHT),
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        // One full turn by the time the page reaches the refresh threshold, then it
        // holds — past that the release WILL refresh, so more rotation says nothing.
        rotate: `${interpolate(
          translateY.value,
          [0, REFRESH_THRESHOLD],
          [0, 360],
          'clamp',
        )}deg`,
      },
    ],
  }));

  /**
   * ★ THE GESTURE IS WEB-ONLY, AND THE COMMENT ABOVE USED TO PROMISE THAT
   *   WITHOUT DELIVERING IT.
   *
   * On native, a JS `PanResponder` competes with the ScrollView's own gesture
   * recogniser for the same vertical drag, so a pull either does nothing or steals
   * the scroll. The platform control does this job properly there, which is why
   * callers wrap their ScrollView in a `RefreshControl` on native instead of using
   * this component's drag. Building the responder unconditionally is what made the
   * header's claim false.
   */
  const responder = useMemo(
    () =>
      Platform.OS !== 'web'
        ? null
        : PanResponder.create({
            // Only claim a gesture that is clearly vertical and downward, so a
            // horizontal swipe or a normal scroll is untouched.
            onMoveShouldSetPanResponder: (_event, gesture) =>
              gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),

            onPanResponderMove: (_event, gesture) => {
              if (busy.current) return;
              translateY.value = displacementFor(gesture.dy);
            },

            onPanResponderGrant: () => {
              // ★ THE ANIMATION MUST BE STOPPED WHEN THE FINGER LANDS.
              //
              // Without this, a pull that starts while the page is still settling from
              // the previous one fights the running timing animation: both write the
              // same value, the later frame wins, and the page judders. The settle has
              // to yield to the finger immediately.
              cancelAnimation(translateY);
            },

            onPanResponderRelease: (_event, gesture) => {
              if (busy.current) return;

              if (shouldRefresh(gesture.dy)) {
                void refresh();
                return;
              }

              // Not far enough: spring back and do nothing. A refresh here would
              // teach the reader that the threshold does not exist.
              settle(0);
            },

            onPanResponderTerminate: () => {
              if (!busy.current) settle(0);
            },
          }),
    [refresh, settle, translateY],
  );

  return (
    <View style={styles.root} testID={testID}>
      {/* The revealed band. It sits BEHIND the page, so the page's rounded top
          corners show it through rather than over it. */}
      <Reanimated.View
        pointerEvents="none"
        style={[styles.band, { backgroundColor: t.surface2 }, bandStyle]}
        testID={`${testID}-band`}
      >
        <Reanimated.View style={spinnerStyle}>
          <ArrowsClockwise size={22} color={t.textMuted} weight="bold" />
        </Reanimated.View>
      </Reanimated.View>

      <Reanimated.View
        {...(responder?.panHandlers ?? {})}
        style={[styles.page, { backgroundColor: t.bg }, pageStyle]}
      >
        {children}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // The band is positioned against this box, and `overflow: hidden` keeps the
    // page's shadowless edges from drawing outside it as it lifts.
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: 0,
    // Logical insets, so the band spans the width in both directions.
    insetInlineStart: 0,
    insetInlineEnd: 0,
    height: BAND_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: space[2],
  },
  page: {
    flex: 1,
  },
});
