import { useState, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { extractInviteToken } from '@/src/features/events/utils/invite-token';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface JoinEventCardProps {
  onJoin: (token: string) => void;
  testID?: string;
}

export function JoinEventCard({ onJoin, testID = 'join-event-card' }: JoinEventCardProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [input, setInput] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const handleJoin = useCallback(() => {
    const inviteCode = extractInviteToken(input);
    if (!inviteCode) {
      setErrorKey('events.join.invalidError');
      return;
    }

    setErrorKey(null);
    onJoin(inviteCode);
  }, [input, onJoin]);

  const handleChangeText = useCallback((text: string) => {
    setInput(text);
    if (errorKey) {
      setErrorKey(null);
    }
  }, [errorKey]);

  return (
    <Card variant="raised" testID={testID}>
      <Text variant="h3" align="start">
        {t('events.join.heading')}
      </Text>
      <Text variant="caption" color={theme.textMuted} align="start" style={styles.subheading}>
        {t('events.join.subheading')}
      </Text>

      <Input
        value={input}
        onChangeText={handleChangeText}
        label={t('events.join.label')}
        error={errorKey ? t(errorKey) : undefined}
        // ★ A CODE OR A URL IS A LEFT-TO-RIGHT RUN.
        //
        // The field follows the interface direction by default, which is right
        // for a name. This one holds an invite token or an `https://…/e/…`
        // address, and an RTL context reorders the scheme and the slashes
        // around the Latin run — the address reads as corrupt even though the
        // bytes are correct.
        direction="ltr"
        testID="join-event-input"
        style={styles.input}
      />

      <Button
        label={t('events.join.button')}
        onPress={handleJoin}
        variant="primary"
        size="medium"
        testID="join-event-button"
        disabled={input.trim().length === 0}
        style={styles.button}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  subheading: {
    marginBottom: space[2],
  },
  input: {
    marginTop: space[1],
  },
  button: {
    marginTop: space[2],
    // ★ THE CARD NEEDS ITS OWN BOTTOM BREATHING ROOM.
    //
    // The button previously sat flush against the card's last edge, so the one
    // action in the block had no more space below it than its own corner radius.
    marginBottom: space[2],
  },
});
