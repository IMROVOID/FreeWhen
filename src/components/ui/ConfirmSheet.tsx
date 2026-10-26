/**
 * The in-app confirmation surface.
 *
 * ★ A CONFIRMATION IS A SHEET, NOT A SYSTEM DIALOG.
 *
 * `Alert.alert` raises a second window in the platform's own styling: it does
 * not follow the theme, it does not mirror for RTL, and it is unreachable from
 * a test. A sheet inherits all three, and it sits over the screen that asked
 * the question instead of dimming it behind an opaque system overlay.
 */

import { View, StyleSheet } from 'react-native';

import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface ConfirmSheetProps {
  visible: boolean;
  /** The question, e.g. «این رویداد حذف شود؟» */
  title: string;
  /** One line of consequence. Optional: some questions need no gloss. */
  body?: string;
  /** The confirm control's own label — it names the action, not "OK". */
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive actions read as danger; the default is the quiet variant. */
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onDismiss: () => void;
  testID?: string;
}

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onConfirm,
  onDismiss,
  testID = 'confirm-sheet',
}: ConfirmSheetProps) {
  const { t: theme } = useTheme();

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} testID={testID}>
      <View style={styles.content}>
        <Text variant="h2" align="start">
          {title}
        </Text>
        {body ? (
          <Text
            variant="body"
            color={theme.textMuted}
            align="start"
            style={styles.body}
          >
            {body}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={confirmLabel}
            onPress={onConfirm}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            testID={`${testID}-confirm`}
          />
          <Button
            label={cancelLabel}
            onPress={onDismiss}
            variant="ghost"
            size="medium"
            testID={`${testID}-cancel`}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: space[3],
  },
  body: {
    marginTop: space[1],
  },
  actions: {
    marginTop: space[4],
    gap: space[3],
  },
});
