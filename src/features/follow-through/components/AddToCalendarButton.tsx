/**
 * Add to calendar (Plan 10 Task 9, AC-3.4.1).
 *
 * ★ THE FILE IS BUILT ON THE DEVICE, IN FULL.
 *
 * `buildIcs` is pure and this component only writes its string out. There is no
 * fetch here and no OAuth: a calendar entry is a local text file, and treating it
 * as a server operation would add a dependency and a token surface to a pure
 * transformation. The button works in airplane mode, which is the honest test.
 *
 * ★ IT DEGRADES TO THE CLIPBOARD WHERE THERE IS NO SHARE SHEET (E6).
 *
 * `expo-sharing` is unavailable on web and on some Android configurations. Rather
 * than disappearing, the button copies the `.ics` text so the user can still get
 * the entry — a worse path that works beats a disabled control.
 */

import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { buildIcs, icsFileName, type IcsEvent } from '../services/ics';

export interface AddToCalendarButtonProps {
  event: IcsEvent;
  /** Injected so the component is testable and web can differ. */
  onShare?: (fileName: string, contents: string) => Promise<boolean>;
  onCopy?: (contents: string) => Promise<void>;
  testID?: string;
}

export function AddToCalendarButton({
  event,
  onShare,
  onCopy,
  testID,
}: AddToCalendarButtonProps) {
  const { t: theme } = useTheme();
  const { t } = useTranslation();

  const [state, setState] = useState<'idle' | 'working' | 'done' | 'copied' | 'failed'>('idle');

  const add = useCallback(async () => {
    setState('working');

    try {
      // ★ Pure, local, synchronous. This is the whole of AC-3.4.1.
      const contents = buildIcs(event);
      const fileName = icsFileName(event.title);

      if (onShare) {
        const shared = await onShare(fileName, contents);
        if (shared) {
          setState('done');
          return;
        }
      }

      // No share sheet (web, or sharing disabled): copy instead of failing.
      if (onCopy) {
        await onCopy(contents);
        setState('copied');
        return;
      }

      // Nothing to hand it to. The file was still produced, so this is a
      // capability gap rather than an error the user caused.
      setState('failed');
    } catch {
      setState('failed');
    }
  }, [event, onShare, onCopy]);

  return (
    <View style={styles.wrapper}>
      <Button
        label={t('calendar.add')}
        onPress={() => void add()}
        variant="secondary"
        size="medium"
        loading={state === 'working'}
        testID={testID}
      />

      {state === 'copied' && Platform.OS === 'web' && (
        <Text variant="caption" color={theme.textMuted} accessibilityLiveRegion="polite">
          {t('calendar.copied')}
        </Text>
      )}

      {state === 'failed' && (
        <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
          {t('calendar.unavailable')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: space[2],
  },
});
