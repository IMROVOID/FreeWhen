/**
 * The share sheet for one event.
 *
 * ★ THE ROWS ARE INSET ONCE, NOT TWICE.
 *
 * "Code" and "Link" were two `Card`s inside a container that padded by
 * `space[5]` — and the sheet already pads by `space[5]`. The rows therefore
 * stopped well short of the Share button beneath them, and the inset read as
 * nesting: as though the code and the link belonged to some inner group. The
 * container no longer pads horizontally, so both rows and the button span the
 * same width.
 *
 * ★ A COPY PROVES ITSELF WHERE THE TAP LANDED.
 *
 * The copy buttons changed nothing, so the only evidence was a toast at the
 * bottom of the screen three seconds later — away from the control that was
 * pressed. Each button now flips to a check mark and pulses, in place, and the
 * confirmation is therefore visible even before the toast arrives. The toast
 * stays: it names what was copied, which an icon cannot.
 *
 * ★ THE LINK NAMES THE READER'S OWN HOST.
 *
 * `invite_url` is built server-side from the request's origin, which on a
 * serverless deployment is the `*.vercel.app` host rather than the custom
 * domain the reader typed. `republishOnOrigin` moves the link onto the page's own
 * origin and leaves the path alone — see `src/lib/public-url.ts` for why it
 * cannot be fixed by reading a header instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Check, Copy, ShareNetwork } from 'phosphor-react-native';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { OverlayToast } from '@/src/components/ui/OverlayToast';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { republishOnOrigin } from '@/src/lib/public-url';
import { haptics } from '@/src/platform/haptics';
import { dur, spring } from '@/src/theme/motion';
import { radius, size, space } from '@/src/theme/tokens';
import { useMotion } from '@/src/theme/useMotion';
import { useTheme } from '@/src/theme/useTheme';

/** How long the check mark stays before returning to the copy icon. */
const COPIED_FEEDBACK_MS = 1600;

export interface EventShareModalProps {
  visible: boolean;
  onDismiss: () => void;
  eventTitle: string;
  inviteCode?: string | null;
  inviteUrl?: string | null;
  testID?: string;
}

/** Which row was just copied, so only that button confirms. */
type CopiedRow = 'code' | 'link' | null;

/**
 * The page's own origin, when there is one to publish on.
 *
 * Static rendering and native have no page, so the server's value stands.
 */
function pageOrigin(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  return window.location?.origin;
}

export function EventShareModal({
  visible,
  onDismiss,
  eventTitle,
  inviteCode,
  inviteUrl,
  testID = 'event-share-modal',
}: EventShareModalProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopiedRow>(null);

  const shareUrl = republishOnOrigin(inviteUrl, pageOrigin()) ?? null;

  /** The reset timer, cleared on unmount so a dismiss cannot poke dead state. */
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const confirmCopy = useCallback((row: Exclude<CopiedRow, null>, message: string) => {
    setCopied(row);
    setToastMessage(message);
    haptics.impact('light');

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS);
  }, []);

  const copyCode = useCallback(async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode);
    confirmCopy('code', t('events.shareModal.copiedCode'));
  }, [inviteCode, confirmCopy, t]);

  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    confirmCopy('link', t('events.shareModal.copiedLink'));
  }, [shareUrl, confirmCopy, t]);

  const shareSystem = useCallback(async () => {
    if (!shareUrl && !inviteCode) return;
    const target = shareUrl ?? inviteCode ?? '';

    try {
      await Share.share({
        title: eventTitle,
        message: target,
        url: target || undefined,
      });
    } catch {
      // Share dismissed
    }
  }, [eventTitle, inviteCode, shareUrl]);

  return (
    <>
      <BottomSheet visible={visible} onDismiss={onDismiss} testID={testID}>
        <View style={styles.container}>
          <Text variant="h3" align="start">
            {t('events.shareModal.title')}
          </Text>

          {inviteCode ? (
            <Card variant="surface" style={styles.itemCard}>
              <View style={styles.boxRow}>
                <View style={styles.boxContent}>
                  <Text variant="caption" color={theme.textMuted} align="start">
                    {t('events.shareModal.codeLabel')}
                  </Text>
                  <Text variant="body" weight={600} align="start" selectable numberOfLines={1}>
                    {inviteCode}
                  </Text>
                </View>
                <CopyButton
                  copied={copied === 'code'}
                  onPress={copyCode}
                  label={t('events.shareModal.copyCode')}
                  testID="copy-code-button"
                />
              </View>
            </Card>
          ) : null}

          {shareUrl ? (
            <Card variant="surface" style={styles.itemCard}>
              <View style={styles.boxRow}>
                <View style={styles.boxContent}>
                  <Text variant="caption" color={theme.textMuted} align="start">
                    {t('events.shareModal.linkLabel')}
                  </Text>
                  <Text variant="body" weight={600} align="start" selectable numberOfLines={1}>
                    {shareUrl}
                  </Text>
                </View>
                <CopyButton
                  copied={copied === 'link'}
                  onPress={copyLink}
                  label={t('events.shareModal.copyLink')}
                  testID="copy-link-button"
                />
              </View>
            </Card>
          ) : null}

          <Button
            label={t('events.shareModal.shareSystem')}
            onPress={shareSystem}
            variant="primary"
            size="large"
            icon={<ShareNetwork size={20} color={theme.onPrimary} />}
            testID="share-system-button"
            style={styles.shareButton}
          />
        </View>
      </BottomSheet>

      {/* Sits above the sheet, so the confirmation is visible without the sheet
          growing to make room for it. */}
      <OverlayToast
        message={toastMessage ?? ''}
        visible={toastMessage !== null}
        onDismiss={() => setToastMessage(null)}
        tone="success"
      />
    </>
  );
}

/**
 * A copy control that says it worked.
 *
 * ★ THE PULSE IS THE POINT, NOT THE ICON SWAP.
 *
 * A glyph that changes colour is easy to miss when the eye is on the text being
 * copied; a scale pulse at the tap site is not. Under Reduce Motion the icon
 * still swaps — the confirmation is the state, and the pulse is decoration.
 */
function CopyButton({
  copied,
  onPress,
  label,
  testID,
}: {
  copied: boolean;
  onPress: () => void | Promise<void>;
  label: string;
  testID: string;
}) {
  const { t: theme } = useTheme();
  const motion = useMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!copied || motion.reduce) {
      scale.value = 1;
      return;
    }

    scale.value = withSequence(
      withTiming(0.86, { duration: dur.instant }),
      withSpring(1, spring.snappy),
    );
  }, [copied, motion.reduce, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressy
        onPress={() => void onPress()}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: copied }}
        style={[
          styles.copyIconBtn,
          { backgroundColor: copied ? theme.surface3 : theme.surface2 },
        ]}
        testID={testID}
      >
        {copied ? (
          <Check size={18} color={theme.success} weight="bold" />
        ) : (
          <Copy size={18} color={theme.text} />
        )}
      </Pressy>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // ★ NO HORIZONTAL PADDING — THE SHEET ALREADY HAS IT.
    //
    // `BottomSheet` pads its content by `space[5]`; adding the same again here
    // made the two cards stop far short of the Share button below them.
    paddingVertical: space[3],
    gap: space[3],
  },
  itemCard: {
    padding: space[3],
    borderRadius: radius.md,
  },
  boxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  boxContent: {
    flex: 1,
    gap: space[1],
  },
  copyIconBtn: {
    width: size.buttonSmall,
    height: size.buttonSmall,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButton: {
    marginTop: space[2],
  },
});
