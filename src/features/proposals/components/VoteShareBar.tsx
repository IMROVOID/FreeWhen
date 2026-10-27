/**
 * The vote-share bar on a proposal box (Plan 49 T13).
 *
 * ★ A SHARED DENOMINATOR, SO THE BARS ARE COMPARABLE.
 *
 * The fill is this proposal's answers over the sum of every proposal's answers —
 * not over its own participant count. Three options each filled against their own
 * total would all look nearly full and communicate nothing about which one the
 * group is converging on.
 *
 * ★ IT IS A BAR, NOT THE TALLY.
 *
 * `TallyBar` already states "3 of 8 answered" for one proposal. This is the
 * complementary question — "how much of the group's attention is on this one?" —
 * and the two are deliberately kept side by side rather than merged: the pill
 * answers within a proposal, the bar answers across the list.
 *
 * The bar sits flush against the box's edges with only the card's own radius
 * rounding it, which is why it takes a `position` prop rather than a padding.
 */

import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface VoteShareBarProps {
  /** 0–1. Clamped, so a rounding error cannot overflow the track. */
  share: number;
  /** Which edge of the card the bar is drawn along. */
  position?: 'top' | 'bottom';
  testID?: string;
}

export function VoteShareBar({ share, position = 'bottom', testID = 'vote-share-bar' }: VoteShareBarProps) {
  const { t } = useTheme();

  // A NaN or a value from a stale payload must never produce a negative width or
  // one wider than the track.
  const clamped = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const percent = `${Math.round(clamped * 100)}%` as const;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, position === 'top' ? styles.trackTop : styles.trackBottom]}
    >
      <View style={[styles.fill, { width: percent, backgroundColor: t.brand }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    // A hairline of height: it is an indicator along the card edge, not a
    // component in its own right.
    height: space[1],
    width: '100%',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  trackTop: {
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
  },
  trackBottom: {
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  fill: {
    height: '100%',
  },
});
