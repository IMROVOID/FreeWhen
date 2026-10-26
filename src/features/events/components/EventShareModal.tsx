import { useState, useCallback } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Copy, ShareNetwork } from 'phosphor-react-native';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { OverlayToast } from '@/src/components/ui/OverlayToast';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface EventShareModalProps {
  visible: boolean;
  onDismiss: () => void;
  eventTitle: string;
  inviteCode?: string | null;
  inviteUrl?: string | null;
  testID?: string;
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

  const copyCode = useCallback(async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode);
    setToastMessage(t('events.shareModal.copiedCode'));
  }, [inviteCode, t]);

  const copyLink = useCallback(async () => {
    if (!inviteUrl) return;
    await Clipboard.setStringAsync(inviteUrl);
    setToastMessage(t('events.shareModal.copiedLink'));
  }, [inviteUrl, t]);

  const shareSystem = useCallback(async () => {
    if (!inviteUrl && !inviteCode) return;
    const shareUrl = inviteUrl ?? inviteCode ?? '';

    try {
      await Share.share({
        title: eventTitle,
        message: shareUrl,
        url: shareUrl || undefined,
      });
    } catch {
      // Share dismissed
    }
  }, [eventTitle, inviteCode, inviteUrl]);

  return (
    <>
      <BottomSheet
        visible={visible}
        onDismiss={onDismiss}
        testID={testID}
      >
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
                <Pressy
                  onPress={copyCode}
                  accessibilityRole="button"
                  accessibilityLabel={t('events.shareModal.copyCode')}
                  style={[styles.copyIconBtn, { backgroundColor: theme.surface2 }]}
                  testID="copy-code-button"
                >
                  <Copy size={18} color={theme.text} />
                </Pressy>
              </View>
            </Card>
          ) : null}

          {inviteUrl ? (
            <Card variant="surface" style={styles.itemCard}>
              <View style={styles.boxRow}>
                <View style={styles.boxContent}>
                  <Text variant="caption" color={theme.textMuted} align="start">
                    {t('events.shareModal.linkLabel')}
                  </Text>
                  <Text variant="body" weight={600} align="start" selectable numberOfLines={1}>
                    {inviteUrl}
                  </Text>
                </View>
                <Pressy
                  onPress={copyLink}
                  accessibilityRole="button"
                  accessibilityLabel={t('events.shareModal.copyLink')}
                  style={[styles.copyIconBtn, { backgroundColor: theme.surface2 }]}
                  testID="copy-link-button"
                >
                  <Copy size={18} color={theme.text} />
                </Pressy>
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

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space[5],
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
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButton: {
    marginTop: space[2],
  },
});
