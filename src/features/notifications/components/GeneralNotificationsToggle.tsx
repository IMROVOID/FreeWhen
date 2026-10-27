/**
 * The general notifications toggle (Plan 49 T18).
 *
 * ★ CLIENT-SIDE, BY DECISION.
 *
 * This switch is an affordance on the device that holds it: it greys out the
 * per-event switches and silences what this app shows. It does not change what the
 * server queues, because the write that would do that is `participant` rows the
 * server owns. Stated here so the next reader does not mistake it for an
 * enforcement point.
 *
 * ★ GREYED OUT, NOT FORCED OFF.
 *
 * Every per-event row becomes read-only and displays as muted while this is off,
 * but its stored value is untouched. That is what makes switching back on restore
 * exactly the events that were muted before — see `services/general-switch.ts`.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AccentSwitch } from '@/src/components/ui/AccentSwitch';
import { Text } from '@/src/components/ui/Text';
import {
  INITIAL_SWITCH,
  disableAll,
  displayedEventMute,
  enableAll,
  isEventRowInteractive,
  type NotificationSwitchState,
} from '@/src/features/notifications/services/general-switch';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface GeneralNotificationsToggleProps {
  /** The events muted individually right now, so the snapshot is exact. */
  mutedEventIds: readonly string[];
  /**
   * Called on every change with whether the switch is on.
   *
   * The owner uses this to grey the per-event rows. It does NOT need to rewrite
   * any per-event value: the stored values are never touched, which is precisely
   * why restoring is exact.
   */
  onChange: (enabled: boolean) => void;
  testID?: string;
}

export function GeneralNotificationsToggle({
  mutedEventIds,
  onChange,
  testID = 'general-notifications',
}: GeneralNotificationsToggleProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [state, setState] = useState<NotificationSwitchState>(INITIAL_SWITCH);

  const toggle = useCallback(
    (next: boolean) => {
      if (next) {
        // Consumes the snapshot and hands back the set that was in force, so the
        // restore is exact rather than "enable everything".
        const { state: enabled } = enableAll(state);
        setState(enabled);
        onChange(true);
        return;
      }

      setState(disableAll(mutedEventIds));
      onChange(false);
    },
    [state, mutedEventIds, onChange],
  );

  return (
    <View style={styles.wrapper} testID={testID}>
      <View style={styles.row}>
        <View style={styles.labels}>
          <Text variant="body">{t('notifications.general.label')}</Text>
          <Text variant="caption" color={theme.textMuted} testID={`${testID}-hint`}>
            {t('notifications.general.hint')}
          </Text>
        </View>

        <AccentSwitch
          value={state.enabled}
          onValueChange={toggle}
          accessibilityLabel={t('notifications.general.label')}
          accessibilityHint={t('notifications.general.hint')}
          testID={`${testID}-switch`}
        />
      </View>
    </View>
  );
}

/** Re-exported so a caller rendering per-event rows uses the same rule. */
export { displayedEventMute, isEventRowInteractive };

const styles = StyleSheet.create({
  wrapper: {
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  labels: {
    flexShrink: 1,
    gap: space[1],
  },
});
