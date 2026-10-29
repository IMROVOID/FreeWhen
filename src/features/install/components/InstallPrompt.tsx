/**
 * The install offer, as an overlay.
 *
 * ★ IT REUSES THE SHEET EVERY OTHER DOCUMENT IN THE PRODUCT USES.
 *
 * The request asked for the existing `Overlay` component, and that is also the
 * right answer: the sheet already owns the scrim, the escape key, the drag-down
 * dismissal, the scroll lock and the exit animation. A second overlay primitive
 * would be a second place for the teardown bug to live.
 *
 * ★ THE ACTION DEPENDS ON WHERE IT IS BEING SEEN, NOT ON A BUILD FLAG.
 *
 * A phone browser is offered the APK; a desktop Chromium is offered the
 * browser's own install prompt. `services/install-prompt.ts` owns that decision
 * and the deferred `beforeinstallprompt` event, so this component is only
 * presentation plus one `await`.
 *
 * Dismissal is permanent — the service writes the flag — which is why the button
 * is labelled "Not now" rather than "Close": it is a decision, not a dismissal.
 */

import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import {
  ANDROID_RELEASE_URL,
  detectInstallEnvironment,
  dismissInstall,
  fireInstallPrompt,
  installActionFor,
  installSurfaceFor,
} from '@/src/features/install/services/install-prompt';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface InstallPromptProps {
  visible: boolean;
  onDismiss: () => void;
  testID?: string;
}

export function InstallPrompt({
  visible,
  onDismiss,
  testID = 'install-prompt',
}: InstallPromptProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [failed, setFailed] = useState(false);

  const surface = installSurfaceFor(detectInstallEnvironment());
  const action = installActionFor(surface);
  const desktop = surface === 'desktop-pwa';

  const closeForGood = useCallback(() => {
    dismissInstall();
    setFailed(false);
    onDismiss();
  }, [onDismiss]);

  const act = useCallback(async () => {
    setFailed(false);

    if (action === 'prompt') {
      const fired = await fireInstallPrompt();
      if (fired) {
        // The browser owns the rest of the flow — including whether the user
        // accepted — so the sheet steps aside rather than narrating it.
        onDismiss();
        return;
      }
      // No deferred event: the browser cannot install, so say so instead of
      // leaving a button that looks broken.
      setFailed(true);
      return;
    }

    /*
     * ★ THE DOWNLOAD LINK IS THE RELEASE PAGE, AND IT IS OPENED, NOT FETCHED.
     *
     * `releases/latest` always redirects to the newest build, so nothing here is
     * pinned to a version. Opening it (rather than downloading through the app)
     * leaves the install in the browser's hands, which is where Play Protect and
     * the unknown-source warning live.
     */
    try {
      await Linking.openURL(ANDROID_RELEASE_URL);
      onDismiss();
    } catch {
      setFailed(true);
    }
  }, [action, onDismiss]);

  const body = desktop ? t('install.desktopBody') : t('install.mobileBody');
  const note = desktop ? t('install.desktopNote') : t('install.mobileNote');
  const primary =
    action === 'none'
      ? t('install.desktopUnavailable')
      : desktop
        ? t('install.desktopAction')
        : t('install.mobileAction');

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} testID={testID}>
      <View style={styles.content}>
        <Text variant="h2" align="start">
          {desktop ? t('install.desktopTitle') : t('install.mobileTitle')}
        </Text>

        <Text variant="body" color={theme.textMuted} align="start">
          {body}
        </Text>

        {action === 'none' ? (
          <Text variant="caption" color={theme.textFaint} align="start">
            {primary}
          </Text>
        ) : (
          <Button
            label={primary}
            onPress={() => void act()}
            variant="primary"
            size="large"
            testID={`${testID}-action`}
          />
        )}

        {action !== 'none' && (
          <Text variant="caption" color={theme.textFaint} align="start">
            {note}
          </Text>
        )}

        {failed && (
          <Text variant="caption" color={theme.danger} align="start" accessibilityLiveRegion="polite">
            {t('install.failed')}
          </Text>
        )}

        {/* The decision is permanent, so it is named as one. */}
        <Button
          label={t('install.dismiss')}
          onPress={closeForGood}
          variant="ghost"
          size="medium"
          testID={`${testID}-dismiss`}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[4],
  },
});
