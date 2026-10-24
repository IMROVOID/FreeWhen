import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { Button } from './Button';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface EmptyStateProps {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The prop that is floated above the message. */
  prop?: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * An empty state is an invitation to act, never a blank screen with just
 * text (Style Guide §11.10).
 */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  prop,
  testID,
  style,
}: EmptyStateProps) {
  const { t } = useTheme();

  return (
    <View testID={testID} style={[styles.container, style]}>
      {prop && <View style={styles.prop}>{prop}</View>}

      <Text variant="h2" align="center">
        {title}
      </Text>
      <Text variant="body" color={t.textMuted} align="center">
        {body}
      </Text>

      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} variant="primary" style={styles.action} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    padding: space[6],
    overflow: 'hidden',
  },
  prop: {
    marginBottom: space[2],
  },
  action: {
    marginTop: space[2],
  },
});
