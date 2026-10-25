/**
 * The language control for Settings (PRD-11 S15, Plan 11 Task 6a).
 *
 * ★ THE CURRENT LANGUAGE IS SHOWN AS SELECTED, AND THE OTHER ONE IS A CHOICE.
 *
 * A segmented control that looks instant is a lie here — the layout direction
 * cannot change under a live view tree — so the selection reports progress and
 * the RESTART PROMPT is the honest ending (PRD-10 D11A).
 *
 * ★ THE PROMPT STATES THE REASON AND NAMES THE ACTION.
 *
 * `«برای اعمال انگلیسی، برنامه باید دوباره اجرا شود — چون چیدمان از
 * راستبهچپ به چپبهراست تغییر میکند.»` A restart with no explanation reads as a
 * crash, and "restart required" with no button leaves the user to guess how.
 *
 * ★ A FAILED FLUSH HOLDS THE RESTART.
 *
 * Restarting over an unsent vote would lose it, so when the flush fails the
 * prompt is replaced by the failure and a retry — the language is already
 * persisted, and the write matters more than the direction.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { switchLanguage } from '@/src/features/settings/services/switch-language';
import type { Language } from '@/src/i18n/types';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface LanguageToggleProps {
  /** The language currently rendering. */
  current: Language;
  /** Sends queued writes before the restart is offered. */
  flush?: () => Promise<void>;
  testID?: string;
}

const OPTIONS: ReadonlyArray<{ value: Language; labelKey: string }> = [
  { value: 'fa', labelKey: 'settings.languageFa' },
  { value: 'en', labelKey: 'settings.languageEn' },
];

export function LanguageToggle({ current, flush, testID }: LanguageToggleProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [busy, setBusy] = useState(false);
  const [restartReasonKey, setRestartReasonKey] = useState<string | null>(null);
  const [restartAcknowledged, setRestartAcknowledged] = useState(false);
  const [failed, setFailed] = useState(false);

  const choose = useCallback(
    async (next: Language) => {
      if (next === current) return;

      setBusy(true);
      setFailed(false);

      const result = await switchLanguage({ current, flush });
      setBusy(false);

      if (result.flushErrorKey) {
        setFailed(true);
        return;
      }

      if (result.restartRequired) {
        setRestartReasonKey(result.reasonKey);
      }
    },
    [current, flush],
  );

  const closeAndReopen = useCallback(() => {
    // The build has no programmatic relaunch, so the confirmed choice is
    // recorded inline instead of in an OS dialog.
    //
    // ★ THE INSTRUCTION STAYS ON SCREEN.
    //
    // `Alert.alert` put "close the app and open it again" in a modal, which
    // vanishes the moment it is dismissed — leaving the user in an app that
    // still looks the same with nothing telling them what to do next. The
    // prompt keeps that sentence visible with a Done control that clears it.
    setRestartReasonKey(null);
    setRestartAcknowledged(true);
  }, []);

  return (
    <View testID={testID ?? 'language-toggle'}>
      <View style={styles.row} accessibilityRole="radiogroup">
        {OPTIONS.map((option) => {
          const selected = option.value === current;

          return (
            <Button
              key={option.value}
              label={t(option.labelKey)}
              variant={selected ? 'primary' : 'secondary'}
              size="medium"
              disabled={busy}
              onPress={() => void choose(option.value)}
              testID={`language-option-${option.value}`}
              style={styles.option}
            />
          );
        })}
      </View>

      {/* ★ The restart instruction, with its reason — and it stays put. */}
      {restartAcknowledged && restartReasonKey === null && (
        <View
          style={[styles.prompt, { backgroundColor: theme.surface2 }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID="language-restart-instruction"
        >
          <Text variant="body" color={theme.text}>
            {t('states.languageRestartAction')}
          </Text>
          <Button
            label={t('common.done')}
            variant="secondary"
            size="small"
            onPress={() => setRestartAcknowledged(false)}
            testID="language-restart-dismiss"
            style={styles.promptButton}
          />
        </View>
      )}

      {/* ★ The restart prompt, with its reason. */}
      {restartReasonKey !== null && (
        <View
          style={[styles.prompt, { backgroundColor: theme.surface2 }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          testID="language-restart-prompt"
        >
          <Text variant="body" color={theme.text}>
            {t(restartReasonKey)}
          </Text>
          <View style={styles.promptActions}>
            <Button
              label={t('states.languageRestartLater')}
              variant="secondary"
              size="small"
              onPress={() => setRestartReasonKey(null)}
              testID="language-restart-later"
              style={styles.promptButton}
            />
            <Button
              label={t('states.languageRestartAction')}
              variant="primary"
              size="small"
              onPress={closeAndReopen}
              testID="language-restart-confirm"
              style={styles.promptButton}
            />
          </View>
        </View>
      )}

      {/* ★ A failed flush holds the restart and offers the send again. */}
      {failed && (
        <View
          style={[styles.prompt, { backgroundColor: theme.surface2 }]}
          accessibilityRole="alert"
          testID="language-flush-error"
        >
          <Text variant="body" color={theme.text}>
            {t('errors.unknown')}
          </Text>
          <Button
            label={t('common.retry')}
            variant="secondary"
            size="small"
            onPress={() => void choose(current)}
            testID="language-flush-retry"
            style={styles.promptButton}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[2],
  },
  option: {
    flex: 1,
  },
  prompt: {
    marginTop: space[3],
    padding: space[3],
    gap: space[2],
  },
  promptActions: {
    flexDirection: 'row',
    gap: space[2],
  },
  promptButton: {
    flex: 1,
  },
});
