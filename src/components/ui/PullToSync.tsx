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
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { ArrowsClockwise } from 'phosphor-react-native';

import {
  BAND_HEIGHT,
  bandOpacityFor,
  cornerRadiusFor,
  displacementFor,
  shouldRefresh,
  spinnerRotationFor,
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

  const [displaced, setDisplaced] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const translateY = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);

  const settle = useCallback(
    (to: number) => {
      Animated.timing(translateY, {
        toValue: to,
        duration: 180,
        useNativeDriver: true,
      }).start(() => setDisplaced(to));
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

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Only claim a gesture that is clearly vertical and downward, so a
        // horizontal swipe or a normal scroll is untouched.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),

        onPanResponderMove: (_event, gesture) => {
          if (busy.current) return;
          const next = displacementFor(gesture.dy);
          translateY.setValue(next);
          setDisplaced(next);
        },

        onPanResponderRelease: (_event, gesture) => {
          if (busy.current) return;

          if (shouldRefresh(gesture.dy)) {
            void refresh();
            return;
          }

          // Not far enough: spring back and do nothing. A refresh here would teach
          // the reader that the threshold does not exist.
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
      <View
        pointerEvents="none"
        style={[
          styles.band,
          {
            backgroundColor: t.surface2,
            opacity: refreshing ? 1 : bandOpacityFor(displaced),
          },
        ]}
        testID={`${testID}-band`}
      >
        <Animated.View
          style={{
            transform: [{ rotate: `${refreshing ? 360 : spinnerRotationFor(displaced)}deg` }],
          }}
        >
          <ArrowsClockwise size={22} color={t.textMuted} weight="bold" />
        </Animated.View>
      </View>

      <Animated.View
        {...responder.panHandlers}
        style={[
          styles.page,
          {
            backgroundColor: t.bg,
            transform: [{ translateY }],
            borderTopLeftRadius: cornerRadiusFor(displaced),
            borderTopRightRadius: cornerRadiusFor(displaced),
          },
        ]}
      >
        {children}
      </Animated.View>
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
