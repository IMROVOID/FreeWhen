import { useState, useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ArrowsClockwise, SignOut, Trash } from 'phosphor-react-native';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Text } from '@/src/components/ui/Text';
import { Toast } from '@/src/components/ui/Toast';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface EventManagementModalProps {
  visible: boolean;
  onDismiss: () => void;
  isOwner: boolean;
  eventTitle: string;
  onRename: (newTitle: string) => Promise<void>;
  onRegenerateCode: () => Promise<void>;
  onDeleteEvent: () => Promise<void>;
  onLeaveEvent: () => Promise<void>;
  testID?: string;
}

export function EventManagementModal({
  visible,
  onDismiss,
  isOwner,
  eventTitle,
  onRename,
  onRegenerateCode,
  onDeleteEvent,
  onLeaveEvent,
  testID = 'event-management-modal',
}: EventManagementModalProps) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();

  const [titleInput, setTitleInput] = useState(eventTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleSaveRename = useCallback(async () => {
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === eventTitle) return;

    setIsSubmitting(true);
    try {
      await onRename(trimmed);
      setToastMessage(t('events.management.renamed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [eventTitle, onRename, t, titleInput]);

  const confirmRegenerate = useCallback(() => {
    Alert.alert(
      t('events.management.regenerateTitle'),
      t('events.management.regenerateBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('events.management.regenerateCode'),
          style: 'destructive',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              await onRegenerateCode();
              setToastMessage(t('events.management.regenerated'));
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ],
    );
  }, [onRegenerateCode, t]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      t('events.management.deleteTitle'),
      t('events.management.deleteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('events.management.delete'),
          style: 'destructive',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              await onDeleteEvent();
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ],
    );
  }, [onDeleteEvent, t]);

  const confirmLeave = useCallback(() => {
    Alert.alert(
      t('events.management.leaveTitle'),
      t('events.management.leaveBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('events.management.leave'),
          style: 'destructive',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              await onLeaveEvent();
            } finally {
              setIsSubmitting(false);
            }
          },
        },
      ],
    );
  }, [onLeaveEvent, t]);

  return (
    <>
      <BottomSheet
        visible={visible}
        onDismiss={onDismiss}
        snapPoints={isOwner ? ['65%'] : ['40%']}
        testID={testID}
      >
        <View style={styles.container}>
          <Text variant="h3" align="start">
            {t('events.management.title')}
          </Text>

          {isOwner ? (
            <>
              <Input
                value={titleInput}
                onChangeText={setTitleInput}
                label={t('events.management.nameLabel')}
                testID="rename-input"
              />

              <Button
                label={t('events.management.save')}
                onPress={handleSaveRename}
                variant="primary"
                size="medium"
                disabled={isSubmitting || titleInput.trim() === eventTitle || titleInput.trim().length === 0}
                testID="save-rename-button"
              />

              <Button
                label={t('events.management.regenerateCode')}
                onPress={confirmRegenerate}
                variant="secondary"
                size="medium"
                icon={<ArrowsClockwise size={18} color={theme.text} />}
                disabled={isSubmitting}
                testID="regenerate-code-button"
                style={styles.actionButton}
              />

              <Button
                label={t('events.management.delete')}
                onPress={confirmDelete}
                variant="danger"
                size="medium"
                icon={<Trash size={18} color={theme.onDanger} />}
                disabled={isSubmitting}
                testID="delete-event-button"
                style={styles.actionButton}
              />
            </>
          ) : (
            <Button
              label={t('events.management.leave')}
              onPress={confirmLeave}
              variant="danger"
              size="medium"
              icon={<SignOut size={18} color={theme.onDanger} />}
              disabled={isSubmitting}
              testID="leave-event-button"
              style={styles.actionButton}
            />
          )}
        </View>
      </BottomSheet>

      <Toast
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
  actionButton: {
    marginTop: space[1],
  },
});
