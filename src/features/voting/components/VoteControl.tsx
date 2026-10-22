/**
 * The three-way vote control (Plan 07 Task 6).
 *
 * ★ "MAYBE" NEEDS HELP, ONCE.
 *
 * Users do not distinguish "maybe" from "no" without being told (PRD-02 R1), and
 * the difference decides whether an option survives. The helper line is shown
 * until the participant has voted once — after that it is noise on every card.
 * It is not decoration and it is not dismissible copy: it is the only place the
 * semantics are stated.
 *
 * ★ VOTING IS AVAILABLE ON THE FIRST SCREEN, NOT BEHIND A TAB.
 *
 * The 20-second acquisition rule depends on it (PRD-11 §4.2), so this control is
 * placed on the card itself rather than behind a detail route.
 *
 * ★ ≥44×44 pt TARGETS AND A SCREEN-READER LABEL ON ALL THREE (PRD-11 §8).
 *
 * The buttons carry the full word as their accessibility label even where the
 * visible glyph is short, and the selected state is exposed as
 * `accessibilityState.selected` rather than only as a colour.
 */

import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { Pressy } from '@/src/components/ui/Pressy';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import type { VoteValue } from '@/src/types/vote';

/** The three values, in the order the screen presents them. */
export const VOTE_OPTIONS: readonly VoteValue[] = ['yes', 'maybe', 'no'] as const;

export interface VoteControlProps {
  current: VoteValue | null;
  onVote: (value: VoteValue) => void;
  disabled?: boolean;
  /** The proposal currently being written, so the control can show progress. */
  pending?: boolean;
  /** Show the one-time "what maybe means" line. */
  showHelper?: boolean;
  testID?: string;
}

export function VoteControl({
  current,
  onVote,
  disabled = false,
  pending = false,
  showHelper = false,
  testID,
}: VoteControlProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  return (
    <View testID={testID} style={styles.container}>
      <View
        style={styles.row}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('voting.yourVote')}
      >
        {VOTE_OPTIONS.map((value) => {
          const selected = current === value;
          const label = t(`voting.${value}`);

          // ★ THE SELECTED STATE IS INDICATED BY THREE CHANNELS.
          //
          // Fill, border AND the accessibility state. A colour change alone is
          // invisible to a colour-blind reader and to a screen reader.
          const background = selected
            ? value === 'yes'
              ? theme.success
              : value === 'maybe'
                ? theme.warning
                : theme.danger
            : theme.surface2;

          const labelColor = selected ? theme.onPrimary : theme.text;

          return (
            <Pressy
              key={value}
              onPress={disabled || pending ? undefined : () => onVote(value)}
              disabled={disabled || pending}
              haptic={selected ? 'light' : 'medium'}
              testID={testID ? `${testID}-${value}` : undefined}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected, disabled: disabled || pending }}
              style={styles.option}
            >
              <View
                style={[
                  styles.pill,
                  {
                    backgroundColor: background,
                    borderColor: selected ? theme.text : theme.line,
                  },
                ]}
              >
                <Text variant="caption" color={labelColor} align="center">
                  {label}
                </Text>
              </View>
            </Pressy>
          );
        })}
      </View>

      {showHelper && (
        <Text variant="caption" color={theme.textFaint} testID={testID ? `${testID}-helper` : undefined}>
          {t('voting.maybeHelper')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    gap: space[2],
  },
  option: {
    flex: 1,
    // The 48pt target is met by the pill's height, and `hitSlop` in `Pressy`
    // covers the gap between two adjacent options.
    minWidth: size.buttonSmall,
  },
  pill: {
    minHeight: size.buttonMedium,
    borderRadius: radius.pill,
    borderWidth: border.strong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
});
