/**
 * The language control for Settings.
 *
 * ★ IT SWITCHES, LIVE, IN BOTH DIRECTIONS.
 *
 * The old control persisted the choice and then explained, at length, that the
 * app had to be closed and reopened — because `I18nManager.forceRTL` cannot
 * reflow a mounted tree. That prompt was the defect's most visible symptom:
 * nobody restarts from a settings screen, so the app kept rendering the old
 * catalogue, and selecting the original language afterwards compared equal and
 * did nothing. See `services/switch-language.ts` for the full diagnosis and
 * `src/i18n/index.ts#setLanguage` for the live path.
 *
 * The control is a segmented rail rather than two buttons, matching every other
 * binary choice in the product, and the pill slides to the answer the tap asked
 * for.
 *
 * ★ A FAILED FLUSH STILL SWITCHES, AND SAYS SO.
 *
 * Restarting over an unsent vote would have lost it, so the failure is surfaced.
 * It does not roll the language back: the user asked for the catalogue, and the
 * queue is a separate problem with its own retry.
 */

import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { SegmentedControl, type SegmentedOption } from '@/src/components/ui/Chip';
import { Text } from '@/src/components/ui/Text';
import { chooseLanguage } from '@/src/features/settings/services/switch-language';
import type { Language } from '@/src/i18n/types';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface LanguageToggleProps {
  /** The language currently rendering. */
  current: Language;
  /** Sends queued writes before the catalogue changes. */
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
  const [failed, setFailed] = useState(false);

  /**
   * ★ THE CONTROL FOLLOWS THE LANGUAGE THAT IS ACTUALLY RENDERING.
   *
   * The selection used to be a private `useState` seeded from `current` once and
   * written only by a successful `choose()` call. That is stale in two ways, and
   * both were visible on the device:
   *
   *  1. `app/_layout.tsx` rebuilds the tree on a direction change, so this
   *     instance re-seeds — but a switch WITHIN one direction (fa ↔ a future
   *     second RTL locale) would not, and the pill would keep the old answer;
   *  2. more importantly, this component's own state is not the source of truth
   *     for what is on screen. `current` comes from `i18n.language` on every
   *     render the catalogue changes, so deriving from it cannot disagree.
   *
   * Observed against the shipped build: after tapping فارسی the whole screen
   * laid out right-to-left and the pill stayed under "English" — the control said
   * the opposite of the interface.
   */
  const shown = current;

  const choose = useCallback(
    async (next: Language) => {
      if (next === shown) return;

      setBusy(true);
      setFailed(false);

      const result = await chooseLanguage(next, { current: shown, flush });

      setBusy(false);

      if (result.flushErrorKey) setFailed(true);
    },
    [shown, flush],
  );

  return (
    <View testID={testID ?? 'language-toggle'}>
      <SegmentedControl
        options={OPTIONS.map(
          (option): SegmentedOption => ({ value: option.value, label: t(option.labelKey) }),
        )}
        value={shown}
        onChange={(next) => void choose(next as Language)}
        disabled={busy}
        testID="language-option"
        testIDPrefix={`${testID ?? 'language-toggle'}-option`}
      />

      {/* ★ A failed flush is reported, and the retry re-sends it. The language
          has already changed — a `.language` swap is not reversible by holding
          it back, and pretending otherwise would leave the control lying. */}
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
            onPress={() => {
              setFailed(false);
              void choose(shown === 'fa' ? 'en' : 'fa').then(() => setFailed(false));
            }}
            testID="language-flush-retry"
            style={styles.promptButton}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  prompt: {
    marginTop: space[3],
    padding: space[3],
    gap: space[2],
  },
  promptButton: {
    alignSelf: 'flex-start',
  },
});
