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

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PencilSimple } from 'phosphor-react-native';

import { Text } from '@/src/components/ui/Text';
import { Pressy } from '@/src/components/ui/Pressy';
import { radius, size, space } from '@/src/theme/tokens';
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
  /**
   * Whether the caller has vetoed this proposal (FR-2.17).
   *
   * ★ A VETO IS A SECOND, DELIBERATE ACT (OQ-2.2).
   *
   * Tapping `no` is a preference; vetoing is a hard exclusion that removes the
   * venue for the whole group. The two are separate controls so that a casual
   * `no` cannot silently eliminate an option — which is exactly the failure
   * conflating them produces.
   */
  veto?: boolean;
  /** Toggles the veto. Absent means the affordance is not offered at all. */
  onToggleVeto?: () => void;
  testID?: string;
}

export function VoteControl({
  current,
  onVote,
  disabled = false,
  pending = false,
  showHelper = false,
  veto = false,
  onToggleVeto,
  testID,
}: VoteControlProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const busy = disabled || pending;

  /**
   * ★ AFTER VOTING, THE THREE PILLS COLLAPSE TO THE ANSWER PLUS AN EDIT BUTTON.
   *
   * Three always-visible options on every proposal turn a list of five into
   * fifteen competing controls, and after a vote the reader has already answered
   * — the thing they need is confirmation, not a re-vote. So the answered state
   * shows WHICH answer was given and one edit affordance in the trailing corner;
   * pressing it restores the pills with the current choice already filled, which
   * is what makes changing a vote a deliberate second act.
   *
   * An unanswered proposal keeps the full row: that is the state where the reader
   * has something to decide.
   */
  const [editing, setEditing] = useState(false);

  // A vote arriving from elsewhere (another device, a poll refresh) should
  // collapse the row again, and a cleared vote should not leave an edit button
  // pointing at nothing.
  useEffect(() => {
    setEditing(false);
  }, [current]);

  const answered = current !== null && current !== undefined;
  const collapsed = answered && !editing;

  if (collapsed) {
    const answerColor =
      current === 'yes' ? theme.success : current === 'maybe' ? theme.warning : theme.danger;

    return (
      <View testID={testID} style={styles.collapsedRow}>
        {/* ★ THE COLLAPSED ROW STAYS A RADIOGROUP.
            Collapsing three pills into one answer removes the other two from the
            DOM, so a screen reader would lose both the fact that alternatives
            exist and which one is selected. The row keeps the group role and the
            selection is announced on the visible pill, and the edit button names
            the one action that is actually available. */}
        <View
          style={styles.answerGroup}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('voting.yourVote')}
        >
          <View
            accessibilityRole="radio"
            accessibilityLabel={t(`voting.${current}`)}
            // `accessibilityState.selected` is a React Native hint that
            // react-native-web does not translate on a non-interactive `View`, so
            // the selection would be silent on the web build. `aria-checked` is
            // the attribute a screen reader actually reads for `role="radio"`.
            aria-checked
            style={[styles.pill, styles.answerPill, { backgroundColor: answerColor }]}
          >
            <Text variant="caption" color={theme.onPrimary} align="center">
              {t(`voting.${current}`)}
            </Text>
          </View>
        </View>

        <Pressy
          onPress={busy ? undefined : () => setEditing(true)}
          disabled={busy}
          haptic="light"
          testID={testID ? `${testID}-edit` : undefined}
          accessibilityRole="button"
          accessibilityLabel={t('voting.changeVote')}
          accessibilityState={{ disabled: busy }}
          style={styles.editButton}
        >
          <View style={[styles.editInner, { backgroundColor: theme.surface2 }]}>
            <PencilSimple size={18} color={theme.text} weight="bold" />
          </View>
        </Pressy>
      </View>
    );
  }

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

          // ★ THE SELECTED STATE IS INDICATED BY TWO CHANNELS.
          //
          // Fill AND the accessibility state. A colour change alone is invisible
          // to a colour-blind reader and to a screen reader. The border was a
          // third channel that made every unselected pill look like an outlined
          // button, so the row read as three competing CTAs rather than one
          // question with three answers.
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
              <View style={[styles.pill, { backgroundColor: background }]}>
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

      {/* ★ THE VETO IS OFFERED ONLY ONCE `no` IS THE ANSWER (OQ-2.2).

          It is not a fourth vote — it is a property OF the no. Offering it
          beside "yes" would invite a veto from someone who is happy to go, and
          the affordance's whole job is to make the exclusion deliberate. */}
      {onToggleVeto && current === 'no' && (
        <Pressy
          onPress={busy ? undefined : onToggleVeto}
          disabled={busy}
          haptic={veto ? 'light' : 'medium'}
          testID={testID ? `${testID}-veto` : undefined}
          accessibilityRole="switch"
          accessibilityLabel={t('dealbreaker.veto')}
          accessibilityHint={t('dealbreaker.vetoHint')}
          accessibilityState={{ checked: veto, disabled: busy }}
          style={styles.vetoRow}
        >
          <View
            style={[
              styles.vetoPill,
              {
                backgroundColor: veto ? theme.danger : theme.surface2,
              },
            ]}
          >
            <Text variant="caption" color={veto ? theme.onPrimary : theme.text} align="center">
              {veto ? t('dealbreaker.vetoOn') : t('dealbreaker.veto')}
            </Text>
          </View>
        </Pressy>
      )}

      {/* Why the veto matters, said once, in the place it can be read. */}
      {onToggleVeto && current === 'no' && (
        <Text variant="caption" color={theme.textFaint} testID={testID ? `${testID}-veto-hint` : undefined}>
          {t('dealbreaker.vetoHint')}
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  collapsedRow: {
    // The answer on the leading edge, the edit affordance in the TRAILING corner
    // — logical properties, so it lands in the top-right in English and the
    // top-left in Persian without a direction branch.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  a11yOnly: {
    // Visually absent, present in the accessibility tree. Zero size rather than
    // `display: none`, which would remove it from that tree as well.
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  answerGroup: {
    // The group is the pill's own wrapper, so the selected state and the group
    // role sit on the same visible node the answer is rendered in.
    alignSelf: 'flex-start',
  },
  answerPill: {
    alignSelf: 'flex-start',
    minWidth: size.buttonLarge,
  },
  editButton: {
    width: size.stepperButton,
    height: size.stepperButton,
  },
  editInner: {
    flex: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vetoRow: {
    alignSelf: 'flex-start',
  },
  vetoPill: {
    minHeight: size.buttonMedium,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
});
