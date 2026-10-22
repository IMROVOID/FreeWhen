/**
 * The empty state (PRD-11 §6, Plan 11 Task 1, AC-11.3.1).
 *
 * ★ EVERY EMPTY STATE OFFERS THE NEXT ACTION.
 *
 * The empty state is the FIRST thing a new organizer sees (§15.3), so it is P0
 * rather than polish. An empty state that only says "nothing here yet" leaves
 * the user at a dead end on the screen that decides whether the product works.
 *
 * ★ THE ACTION IS A NODE, NOT A LABEL.
 *
 * The call site supplies the control itself, so an empty state can offer
 * something other than a button — a manual-entry form, a set of choices — when
 * the next step is not a single tap. That is what the permission-denied state
 * needs, and what a label-only prop could not express.
 */

import { StyleSheet, View } from 'react-native';

import { Text } from '@/src/components/ui/Text';
import { radius, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export interface EmptyStateProps {
  /** The one-line prompt, in the user's language. */
  prompt: string;
  /** Optional second line stating what happens next and why. */
  body?: string;
  /** The next action — a control the call site builds. */
  action?: React.ReactNode;
  testID?: string;
}

export function EmptyState({ prompt, body, action, testID }: EmptyStateProps) {
  const { t: theme } = useTheme();

  return (
    <View
      testID={testID ?? 'empty-state'}
      style={[styles.container, { backgroundColor: theme.surface2 }]}
    >
      <Text variant="h3">{prompt}</Text>

      {body && (
        <Text variant="body" color={theme.textMuted}>
          {body}
        </Text>
      )}

      {action && <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    padding: space[5],
    gap: space[2],
  },
  action: {
    marginTop: space[2],
  },
});
