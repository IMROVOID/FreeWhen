/**
 * The mute toggle (Plan 10 Task 6, FR-6.19, AC-6.4.1).
 *
 * ★ MUTING SILENCES N1–N3 (AND N5/N6). IT NEVER SILENCES N4.
 *
 * This is the product's core promise, and the copy says so plainly rather than
 * leaving the user to discover it. The bypass itself lives in
 * `server/routes/notifications.ts` (`MUTABLE_TYPES` omits N4) — this component
 * only states the rule and records the preference.
 *
 * ★ THE SUBTITLE IS NOT OPTIONAL POLISH.
 *
 * A user who mutes expecting silence and then receives a notification assumes the
 * toggle is broken. Telling them, at the moment they mute, that the decision will
 * still arrive is what makes the exception read as a feature.
 */

import { useCallback, useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AccentSwitch } from '@/src/components/ui/AccentSwitch';
import { Text } from '@/src/components/ui/Text';
import { getStoredUserId } from '@/src/lib/session';
import { useTheme } from '@/src/theme/useTheme';

import { toggleMute } from '../services/mute';

/**
 * The transport, loaded on demand.
 *
 * See the note in `toggle`: a static import of `src/lib/api` drags
 * `expo-modules-core` into any process that renders this component, which the
 * Node test runner cannot satisfy.
 */
async function loadTransport() {
  return import('@/src/lib/api');
}

export interface MuteToggleProps {
  eventId: string;
  muted: boolean;
  onChange: (muted: boolean) => void;
  /**
   * Read-only, for when the general notifications switch is off.
   *
   * The row still SHOWS muted — the app has silenced it — but pressing it does
   * nothing, because the stored value must stay untouched for the restore to be
   * exact.
   */
  disabled?: boolean;
  testID?: string;
}

export function MuteToggle({ eventId, muted, onChange, disabled = false, testID }: MuteToggleProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  /**
   * A stable id for the visually-hidden description, so several rows on one screen
   * cannot point at each other's text.
   */
  const descriptionId = useId();

  const toggle = useCallback(
    async (next: boolean) => {
      setErrorKey(null);
      setPending(true);

      // The optimistic flip and its revert live in `toggleMute`, so the pair is
      // exercised by the test suite rather than only by this component.
      //
      // ★ THE TRANSPORT IS LOADED INSIDE THE HANDLER, NOT IMPORTED AT THE TOP.
      //
      // `src/lib/api.ts` imports `expo-constants`, which pulls
      // `expo-modules-core` — a native module the Node test runner cannot load.
      // A static import would make this component unrenderable in the UI suite,
      // and the mounted-render assertions are the ones that catch a switch that
      // draws correctly and does nothing.
      const { apiRequest, ApiFailure } = await loadTransport();

      const result = await toggleMute({
        eventId,
        userId: await getStoredUserId(),
        next,
        onChange,
        request: apiRequest,
        messageKeyOf: (error) => (error instanceof ApiFailure ? error.messageKey : null),
      });

      if (!result.ok) setErrorKey(result.messageKey);
      setPending(false);
    },
    [eventId, onChange],
  );

  /**
   * ★ THE ROW IS A NAME AND A SWITCH. THE WORDS MOVE TO THE ACCESSIBLE TREE.
   *
   * This rendered the label «بی‌صدا کردن اعلان‌های این برنامه» and the subtitle
   * «اعلان «تصمیم نهایی» هرگز بی‌صدا نمی‌شود.» under EVERY event row. Settings lists
   * one row per event, so a group of five repeated that pair five times and each row
   * stood three lines tall — the list stopped reading as a list.
   *
   * The exception still has to be announced: a user who mutes expecting silence and
   * then receives the decision reads the toggle as broken. So the text survives as
   * the switch's accessible name plus a description element it points at.
   *
   * ★ `aria-describedby`, NOT `aria-description`.
   *
   * react-native-web filters unknown `aria-*` props, so `aria-description` never
   * reaches the DOM and the hint would be silently lost on web — which is what
   * `accessibilityHint` alone already did, since it has no web equivalent. An
   * `aria-describedby` reference to a visually-hidden node is forwarded, so the
   * sentence is announced on both platforms.
   */
  return (
    /**
     * ★ NO ROW HERE, AND THAT IS THE ALIGNMENT FIX.
     *
     * This used to wrap the switch in its own `row` — `flexDirection: 'row'`,
     * `justifyContent: 'flex-end'` and `gap: space[3]` — with a zero-size
     * description node as its second child. That gap applied to the hidden node
     * too, so the switch sat 12px inside the row it was placed in, while the
     * general switch above it had no such wrapper. Two switches on one screen,
     * one gap apart: "align the Event notifications toggles with the General
     * notifications toggle horizontally".
     *
     * The ROW belongs to `NotificationRow`, which both call sites render. This
     * component is the switch and its accessible description; where it sits is
     * not its business.
     */
    <View testID={testID}>
      <AccentSwitch
        value={muted}
        onValueChange={(next) => void toggle(next)}
        disabled={pending || disabled}
        accessibilityLabel={t('notifications.mute.label')}
        accessibilityHint={t('notifications.mute.hint')}
        describedBy={descriptionId}
        testID={testID ? `${testID}-switch` : undefined}
      />

      {/* Present in the accessibility tree, absent from the layout. Zero size rather
          than `display: none`, which would remove it from that tree as well. */}
      <View style={styles.srOnly} nativeID={descriptionId} accessibilityRole="text">
        <Text variant="caption">{t('notifications.mute.hint')}</Text>
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
  srOnly: {
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
});
