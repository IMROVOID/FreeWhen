/**
 * One notification row: a title on the reading edge, a control on the other.
 *
 * ★ THE TWO LISTS HAD SWITCHES IN DIFFERENT COLUMNS.
 *
 * Settings renders a general switch and then one switch per event. Both were
 * "a row with a switch at the end", but each built its own row: the general one
 * had a hint line under its label, the per-event one did not, and the per-event
 * rows are separated by the list's `gap` — so the two sets of switches landed at
 * different x positions a few pixels apart. The report calls it out directly.
 *
 * One component means one geometry. The control is the fixed side of the row
 * (`flexShrink: 0`, no padding of its own) and the title takes the rest, so every
 * row on the screen resolves to the same switch column for the same container
 * width — by construction, not by two styles happening to agree.
 *
 * ★ THE TITLE IS NOT BESIDE THE SWITCH.
 *
 * "move the Title to right (on Persian, or Left on English) not next to Toggle".
 * The title is `flex: 1` with `align="start"`, which in a Persian layout is the
 * RIGHT edge and in English the left — so the words sit on the reading edge and
 * the switch is pushed to the opposite one, as far from the title as the row
 * allows.
 *
 * ★ THE CONTROL IS PASSED IN, NOT BUILT HERE.
 *
 * The general switch is a plain `AccentSwitch`; the per-event one is `MuteToggle`,
 * which owns an optimistic write and a disabled state. The ROW is the shared
 * thing — the geometry — so it takes the control as a child rather than
 * duplicating either behaviour.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface NotificationRowProps {
  title: string;
  /** A second line under the title. Omitted for the per-event rows. */
  hint?: string;
  /** The id of the hidden description node, for `aria-describedby` on web. */
  hintId?: string;
  /** The switch, rendered by the caller. */
  children: React.ReactNode;
  testID?: string;
}

export function NotificationRow({ title, hint, hintId, children, testID }: NotificationRowProps) {
  const { t: theme } = useTheme();

  return (
    <View style={styles.row} testID={testID}>
      <View style={styles.labels}>
        <Text variant="body" weight={600} align="start" numberOfLines={1}>
          {title}
        </Text>
        {hint ? (
          <Text
            variant="caption"
            color={theme.textMuted}
            align="start"
            nativeID={hintId}
          >
            {hint}
          </Text>
        ) : null}
      </View>

      {/* The fixed side of the row. It contributes no padding of its own, because
          `AccentSwitch` already carries its hit padding and `MuteToggle` wraps it. */}
      <View style={styles.control}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // Both children are vertically centred on the same axis, which is what puts
    // the switch on the row's middle regardless of whether there is a hint.
    alignItems: 'center',
    gap: space[3],
  },
  labels: {
    // ★ THE TITLE TAKES EVERYTHING THE SWITCH DOES NOT.
    //
    // `flex: 1` is what separates the words from the switch; without it the two
    // hug each other in the middle of the row.
    flex: 1,
    gap: space[1],
  },
  control: {
    flexShrink: 0,
  },
});
