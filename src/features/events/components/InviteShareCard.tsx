/**
 * S3's share surface (Plan 05 Task 8, PRD-11 S3).
 *
 * The venue code, invite URL, copy icons, native share sheet,
 * and regenerate link action with background styling.
 */

import { StyleSheet, Share, View } from 'react-native';
import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Copy, ShareNetwork } from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { OverlayToast } from '@/src/components/ui/OverlayToast';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import { border, radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';
import { extractInviteToken } from '@/src/features/events/utils/invite-token';

export interface InviteShareCardProps {
  url: string;
  code?: string | null;
  /** The expiry, already formatted in the active calendar. */
  expiresLabel: string;
  /** Deprecated optional flag kept for compatibility. */
  canRevoke?: boolean;
  canRotate: boolean;
  onRevoke?: () => void;
  onRotate: () => void;
  testID?: string;
}

export function InviteShareCard({
  url,
  code,
  expiresLabel,
  canRotate,
  onRotate,
  testID,
}: InviteShareCardProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const inviteCode = code ?? (url ? extractInviteToken(url) : null);

  const copyCode = async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode);
    setToastMessage(t('events.shareModal.copiedCode'));
  };

  const copyLink = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    setToastMessage(t('events.shareModal.copiedLink'));
  };

  const share = async () => {
    if (!url) return;
    await Share.share({ message: url, title: t('invite.shareTitle') });
  };

  return (
    <View testID={testID}>
      <Text variant="h1" align="start">
        {t('invite.heading')}
      </Text>
      <Text variant="body" color={theme.textMuted} align="start" style={styles.subheading}>
        {t('invite.subheading')}
      </Text>

      {inviteCode ? (
        <Card variant="raised" style={styles.boxCard}>
          <View style={styles.boxRow}>
            <View style={styles.boxContent}>
              <Text variant="caption" color={theme.textMuted} align="start">
                {t('events.shareModal.codeLabel')}
              </Text>
              <Text variant="body" color={theme.text} weight={600} align="start" selectable numberOfLines={1}>
                {inviteCode}
              </Text>
            </View>
            <Pressy
              onPress={copyCode}
              accessibilityRole="button"
              accessibilityLabel={t('events.shareModal.copyCode')}
              style={[styles.copyIconBtn, { backgroundColor: theme.surface2 }]}
              testID="invite-copy-code"
            >
              <Copy size={20} color={theme.text} />
            </Pressy>
          </View>
        </Card>
      ) : null}

      <Card variant="raised" style={styles.boxCard}>
        <View style={styles.boxRow}>
          <View style={styles.boxContent}>
            <Text variant="caption" color={theme.textMuted} align="start">
              {t('events.shareModal.linkLabel')}
            </Text>
            <Text variant="body" color={theme.text} align="start" selectable numberOfLines={2}>
              {url}
            </Text>
            {expiresLabel ? (
              <Text variant="caption" color={theme.textFaint} align="start" numeric>
                {expiresLabel}
              </Text>
            ) : null}
          </View>
          <Pressy
            onPress={copyLink}
            accessibilityRole="button"
            accessibilityLabel={t('events.shareModal.copyLink')}
            style={[styles.copyIconBtn, { backgroundColor: theme.surface2 }]}
            testID="invite-copy-link"
          >
            <Copy size={20} color={theme.text} />
          </Pressy>
        </View>
      </Card>

      <View style={styles.actions}>
        <Button
          label={t('invite.share')}
          onPress={share}
          variant="primary"
          icon={<ShareNetwork size={20} color={theme.onPrimary} />}
          testID="invite-share"
        />
      </View>

      <View style={[styles.privacyLine, { borderColor: theme.line }]}>
        <Text variant="caption" color={theme.textMuted} align="start">
          {t('invite.privacyLine')}
        </Text>
      </View>

      {canRotate && (
        <Button
          label={t('invite.rotate')}
          onPress={onRotate}
          variant="secondary"
          size="medium"
          testID="invite-rotate"
          style={styles.secondaryAction}
        />
      )}

      {/* ★ AN OVERLAY, NOT A ROW IN THIS CARD.
          Rendered in place, the confirmation appeared BETWEEN the URL card and
          the next button and pushed them apart for three seconds. It now floats
          over the screen and leaves the layout untouched. */}
      <OverlayToast
        message={toastMessage ?? ''}
        visible={toastMessage !== null}
        onDismiss={() => setToastMessage(null)}
        tone="success"
        testID="invite-copied-toast"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  subheading: {
    marginTop: space[2],
    marginBottom: space[5],
  },
  boxCard: {
    marginBottom: space[3],
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
  actions: {
    marginTop: space[3],
  },
  privacyLine: {
    marginTop: space[5],
    borderTopWidth: border.hairline,
    paddingTop: space[4],
  },
  secondaryAction: {
    marginTop: space[3],
  },
});
