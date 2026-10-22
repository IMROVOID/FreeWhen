/**
 * S3's share surface (Plan 05 Task 8, PRD-11 S3).
 *
 * The link, a copy action, the native share sheet, the mandatory privacy line,
 * and the destructive actions. It is a component rather than screen-local markup
 * because the same card belongs on the event shell later — the organizer needs
 * to re-reach the link without hunting through Settings.
 *
 * ★ THE PRIVACY LINE IS NOT DECORATION.
 *
 * The link IS the credential, and whoever holds it can join and see approximate
 * locations. Saying so at the moment of sharing is the consent the product
 * depends on; omitting it is a silent expansion of who can see where people
 * live (PRD-08 §3).
 */

import { StyleSheet, Share, View } from 'react-native';
import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Text } from '@/src/components/ui/Text';
import { Toast } from '@/src/components/ui/Toast';
import { border, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface InviteShareCardProps {
  url: string;
  /** The expiry, already formatted in the active calendar. */
  expiresLabel: string;
  /** Shown only once somebody has joined, per PRD-11 S3. */
  canRevoke: boolean;
  canRotate: boolean;
  onRevoke: () => void;
  onRotate: () => void;
  testID?: string;
}

export function InviteShareCard({
  url,
  expiresLabel,
  canRevoke,
  canRotate,
  onRevoke,
  onRotate,
  testID,
}: InviteShareCardProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
  };

  const share = async () => {
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

      <Card variant="raised" style={styles.linkCard}>
        {/* `selectable` so the link can be copied by long-press as well — the
            copy button is the fast path, not the only one. */}
        <Text variant="body" color={theme.text} align="start" selectable numberOfLines={2}>
          {url}
        </Text>
        <Text variant="caption" color={theme.textFaint} align="start" numeric>
          {expiresLabel}
        </Text>
      </Card>

      <View style={styles.actions}>
        <Button label={t('invite.copy')} onPress={copy} variant="primary" testID="invite-copy" />
        <Button label={t('invite.share')} onPress={share} variant="secondary" testID="invite-share" />
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
          variant="ghost"
          size="medium"
          testID="invite-rotate"
          style={styles.secondaryAction}
        />
      )}

      {canRevoke && (
        <Button
          label={t('invite.revoke')}
          onPress={onRevoke}
          variant="danger"
          size="medium"
          testID="invite-revoke"
          style={styles.secondaryAction}
        />
      )}

      <Toast
        message={t('invite.copied')}
        visible={copied}
        onDismiss={() => setCopied(false)}
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
  linkCard: {
    gap: space[2],
  },
  actions: {
    gap: space[3],
    marginTop: space[4],
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
