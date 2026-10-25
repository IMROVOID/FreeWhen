import { useState, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ArrowsClockwise, SignOut, Trash } from 'phosphor-react-native';

import { BottomSheet } from '@/src/components/ui/BottomSheet';
import { Button } from '@/src/components/ui/Button';
import { ConfirmSheet } from '@/src/components/ui/ConfirmSheet';
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
  /** Which destructive action is waiting on its confirmation. */
  const [pendingAction, setPendingAction] = useState<'regenerate' | 'delete' | 'leave' | null>(null);

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

  const runPendingAction = useCallback(async () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === null) return;

    setIsSubmitting(true);
    try {
      if (action === 'regenerate') {
        await onRegenerateCode();
        setToastMessage(t('events.management.regenerated'));
      } else if (action === 'delete') {
        await onDeleteEvent();
      } else {
        await onLeaveEvent();
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [onDeleteEvent, onLeaveEvent, onRegenerateCode, pendingAction, t]);

  const confirmLabels = {
    regenerate: {
      title: t('events.management.regenerateTitle'),
      body: t('events.management.regenerateBody'),
      confirm: t('events.management.regenerateCode'),
      tone: 'default' as const,
    },
    delete: {
      title: t('events.management.deleteTitle'),
      body: t('events.management.deleteBody'),
      confirm: t('events.management.delete'),
      tone: 'danger' as const,
    },
    leave: {
      title: t('events.management.leaveTitle'),
      body: t('events.management.leaveBody'),
      confirm: t('events.management.leave'),
      tone: 'danger' as const,
    },
  };

  const pending = pendingAction === null ? null : confirmLabels[pendingAction];

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
                onPress={() => setPendingAction('regenerate')}
                variant="secondary"
                size="medium"
                icon={<ArrowsClockwise size={18} color={theme.text} />}
                disabled={isSubmitting}
                testID="regenerate-code-button"
                style={styles.actionButton}
              />

              <Button
                label={t('events.management.delete')}
                onPress={() => setPendingAction('delete')}
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
              onPress={() => setPendingAction('leave')}
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

      <ConfirmSheet
        visible={pending !== null}
        title={pending?.title ?? ''}
        body={pending?.body}
        confirmLabel={pending?.confirm ?? ''}
        cancelLabel={t('common.cancel')}
        tone={pending?.tone}
        onConfirm={() => void runPendingAction()}
        onDismiss={() => setPendingAction(null)}
        testID="event-management-confirm"
      />

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
