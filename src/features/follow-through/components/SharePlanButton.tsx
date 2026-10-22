/**
 * Share the plan (Plan 10 Task 10, FR-6.23, AC-6.6.1, E8).
 *
 * ★ THIS IS THE VIRALITY PATH, SO IT GETS THE REAL SHARE SHEET.
 *
 * The shared text goes into a group chat and is seen by people who do not have the
 * app. `shareText` carries the title, the date in BOTH calendars, the time, the
 * venue, a map link and the attendee count — composed in `share-plan.ts` so what
 * is shared is testable rather than assembled inline here.
 *
 * ★ WEB FALLS BACK TO A COPYABLE LINK (E8).
 *
 * There is no native share sheet on web. The button copies the same text, which is
 * what the user would have pasted anyway.
 */

import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Text } from '@/src/components/ui/Text';
import type { Language } from '@/src/i18n/types';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import {
  sharePayload,
  type SharePayload,
  type ShareablePlan,
  type ShareTemplates,
} from '../services/share-plan';

export interface SharePlanButtonProps {
  plan: ShareablePlan;
  /** Native share, returning false when no sheet is available. */
  onShare?: (payload: SharePayload) => Promise<boolean>;
  onCopy?: (text: string) => Promise<void>;
  testID?: string;
}

export function SharePlanButton({ plan, onShare, onCopy, testID }: SharePlanButtonProps) {
  const { t: theme } = useTheme();
  const { t, i18n } = useTranslation();

  const [state, setState] = useState<'idle' | 'working' | 'copied' | 'failed'>('idle');

  const locale: Language = i18n.language === 'en' ? 'en' : 'fa';

  const share = useCallback(async () => {
    setState('working');

    try {
      const templates: ShareTemplates = {
        heading: t('followThrough.share.heading'),
        when: t('followThrough.share.when'),
        where: t('followThrough.share.where'),
        attendees: (going, maybe) =>
          maybe > 0
            ? t('followThrough.attendees.counts', { going, maybe })
            : t('followThrough.attendees.goingOnly', { going }),
      };

      const payload = sharePayload(plan, locale, templates);

      if (onShare) {
        const shared = await onShare(payload);
        if (shared) {
          setState('idle');
          return;
        }
      }

      if (onCopy) {
        await onCopy(payload.message);
        setState('copied');
        return;
      }

      setState('failed');
    } catch {
      setState('failed');
    }
  }, [plan, locale, t, onShare, onCopy]);

  return (
    <View style={styles.wrapper}>
      <Button
        label={t('followThrough.share.action')}
        onPress={() => void share()}
        variant="secondary"
        size="medium"
        loading={state === 'working'}
        testID={testID}
      />

      {state === 'copied' && (
        <Text
          variant="caption"
          color={theme.textMuted}
          accessibilityLiveRegion="polite"
          testID={testID ? `${testID}-copied` : undefined}
        >
          {t('followThrough.share.copied')}
        </Text>
      )}

      {state === 'failed' && (
        <Text variant="caption" color={theme.danger} accessibilityLiveRegion="polite">
          {t('followThrough.share.unavailable')}
        </Text>
      )}

      {/* Web keeps a hint that the copy path is what happened, so the button does
          not appear to have done nothing (E8). */}
      {Platform.OS === 'web' && state === 'idle' && (
        <Text variant="caption" color={theme.textMuted}>
          {t('followThrough.share.webHint')}
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
