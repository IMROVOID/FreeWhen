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
  /**
   * The corner rounding to apply, in points.
   *
   * ★ THE BAR TAKES THE CARD'S RADIUS, AND IT IS THE CARD'S `radius.lg`.
   *
   * The track used to round itself to `radius.md` inside a card rounded to
   * `radius.lg`, and its own corners were transparent — so at the card's foot the
   * gauge's straight left and right edges crossed the card's curve and the fill
   * read as a strip UNDER the box rather than as an edge OF it. The caller passes
   * the radius it draws with, so the two cannot disagree.
   */
  cornerRadius?: number;
  /**
   * The colour behind the bar — the card's own surface.
   *
   * A transparent track leaves whatever is beneath it showing, which is why the
   * unfilled part of the gauge looked like the page rather than the box. Painting
   * the track with the card's fill makes the bar read as an INSIDE edge: masked to
   * the box, not overflowing it.
   */
  trackColor?: string;
  testID?: string;
}

export function VoteShareBar({
  share,
  position = 'bottom',
  cornerRadius = radius.md,
  trackColor,
  testID = 'vote-share-bar',
}: VoteShareBarProps) {
  const { t } = useTheme();

  // A NaN or a value from a stale payload must never produce a negative width or
  // one wider than the track.
  const clamped = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const percent = `${Math.round(clamped * 100)}%` as const;

  /** The two corners on the edge this bar is drawn against. */
  const corners =
    position === 'top'
      ? { borderTopLeftRadius: cornerRadius, borderTopRightRadius: cornerRadius }
      : { borderBottomLeftRadius: cornerRadius, borderBottomRightRadius: cornerRadius };

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        styles.track,
        corners,
        { backgroundColor: trackColor ?? t.surface1 },
      ]}
    >
      {/* The fill takes the same corners on the bar's own edge, so a full bar ends
          inside the card's curve instead of squaring it off. */}
      <View style={[styles.fill, corners, { width: percent, backgroundColor: t.brand }]} />
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
  },
  fill: {
    height: '100%',
  },
});
