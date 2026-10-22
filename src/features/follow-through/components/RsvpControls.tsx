/**
 * The RSVP control (Plan 10 Task 1, FR-6.1, AC-6.1.1).
 *
 * ★ THIS COMPONENT RENDERS NOTHING UNTIL THE EVENT IS `CONFIRMED` (FR-6.1).
 *
 * Before the decision the honest signal is the vote, and two competing signals
 * make the group read the wrong one. The guard is here as well as on the server
 * and in `canRsvp` — a rule this load-bearing should not depend on one caller
 * remembering it.
 *
 * ★ RSVP IS NOT GATED ON HAVING VOTED (FR-6.6, OQ-6.2).
 *
 * `RsvpControls` takes no vote state at all. There is deliberately no prop a
 * future change could wire a "must have voted" check into: requiring a vote would
 * punish the busy person the product exists for.
 *
 * ★ THE OPTIMISTIC WRITE REVERTS VISIBLY.
 *
 * Same contract as the vote control: the change lands immediately, and a failure
 * restores what the user last saw and says so. A silent revert would look like a
 * tap that did nothing.
 */

import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { ApiFailure } from '@/src/lib/api';
import { getStoredUserId } from '@/src/lib/session';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import {
  RSVP_VALUES,
  canRsvp,
  optimisticRsvp,
  putRsvp,
  type RsvpState,
  type RsvpValue,
} from '../services/rsvp';

export interface RsvpControlsProps {
  eventId: string;
  /** The event's status. RSVP appears only when this is `CONFIRMED`. */
  eventStatus: string | null | undefined;
  state: RsvpState;
  /** The caller's own display name, for the optimistic patch. */
  myName: string;
  onChange: (next: RsvpState) => void;
  testID?: string;
}

export function RsvpControls({
  eventId,
  eventStatus,
  state,
  myName,
  onChange,
  testID,
}: RsvpControlsProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [pending, setPending] = useState<RsvpValue | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const snapshot = useRef<RsvpState | null>(null);

  const choose = useCallback(
    async (value: RsvpValue) => {
      if (state.mine === value) return;

      setErrorKey(null);
      snapshot.current = state;
      onChange(optimisticRsvp(state, myName, value));
      setPending(value);

      try {
        const userId = await getStoredUserId();
        const response = await putRsvp(eventId, value, userId);
        // The server's counts are the authority — somebody else may have
        // answered while this request was in flight.
        onChange({ attendance: response.attendance, mine: response.rsvp.value });
      } catch (error) {
        // ★ VISIBLE REVERT: the snapshot goes back, and the reason is shown.
        if (snapshot.current) onChange(snapshot.current);

        setErrorKey(
          error instanceof ApiFailure ? error.messageKey : 'rsvp.errors.castFailed',
        );
      } finally {
        setPending(null);
      }
    },
    [state, myName, onChange, eventId],
  );

  // ★ AC-6.1.1: no RSVP control before confirmation. The caller renders the vote
  // state instead; this component contributes nothing.
  if (!canRsvp(eventStatus)) return null;

  return (
    <View style={styles.wrapper} testID={testID}>
      <View
        style={styles.group}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('rsvp.question')}
      >
        {RSVP_VALUES.map((value) => {
          const selected = state.mine === value;
          const busy = pending === value;

          return (
            <Pressy
              key={value}
              onPress={() => void choose(value)}
              disabled={pending !== null}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: pending !== null, busy }}
              accessibilityLabel={t(`rsvp.values.${value}`)}
              style={styles.optionSlot}
              testID={testID ? `${testID}-${value}` : undefined}
            >
              <View
                style={[
                  styles.option,
                  { backgroundColor: selected ? theme.primary : theme.surface2 },
                ]}
              >
                <Text
                  variant="body"
                  color={selected ? theme.onPrimary : theme.textMuted}
                  align="center"
                >
                  {t(`rsvp.values.${value}`)}
                </Text>
              </View>
            </Pressy>
          );
        })}
      </View>

      {errorKey !== null && (
        <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
          {t(errorKey)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: space[2],
  },
  group: {
    flexDirection: 'row',
    gap: space[2],
  },
  optionSlot: {
    flex: 1,
  },
  option: {
    // ≥48pt target (Style Guide §7.3); `size.buttonMedium` is 48.
    height: size.buttonMedium,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: border.hairline,
    borderColor: 'transparent',
    paddingHorizontal: space[3],
  },
});
