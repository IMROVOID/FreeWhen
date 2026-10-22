/**
 * The five-state wrapper (PRD-11 §6, Plan 11 Task 1).
 *
 * ★ ONE COMPONENT, FIVE STATES — AND NO SIXTH.
 *
 * A screen that forgets a state renders nothing, and the omission is invisible
 * in review because the happy path looks fine. This union makes the state
 * exhaustive at the type level: every screen must name which of the five it is
 * in, so a missing branch is a compile error rather than a blank panel in
 * production.
 *
 * ★ OFFLINE IS NOT ONE OF THE FIVE.
 *
 * Offline is orthogonal — every state can be offline at the same time, and
 * §6 is explicit that it is a persistent banner over readable cached content,
 * never a replacement for the screen. Modelling it as a sixth member of the
 * union would make "offline AND ready" unrepresentable, and the first thing a
 * developer would then do is special-case it back out.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text } from '@/src/components/ui/Text';
import { space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { ListSkeleton } from './ListSkeleton';
import { OfflineBanner } from './OfflineBanner';
import { PermissionDeniedState } from './PermissionDeniedState';

export type ScreenState =
  | { kind: 'loading'; rows?: number }
  | { kind: 'error'; onRetry?: () => void; messageKey?: string; retryKey?: string }
  | { kind: 'empty'; prompt: string; body?: string; action?: React.ReactNode }
  | { kind: 'ready'; children: React.ReactNode }
  | { kind: 'permissionDenied'; alternative: React.ReactNode; messageKey?: string };

export interface ScreenStateGateProps {
  state: ScreenState;
  /** Whether the connection is down; renders the non-blocking banner. */
  offline?: boolean;
  /** Writes waiting to flush, passed through to the banner. */
  pendingCount?: number;
  /** Shown instead of the state when the caller pre-empted everything. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function ScreenStateGate({
  state,
  offline = false,
  pendingCount = 0,
  testID,
  style,
}: ScreenStateGateProps) {
  const { t: theme } = useTheme();

  return (
    <View testID={testID} style={[styles.container, { backgroundColor: theme.bg }, style]}>
      {/* ★ PERSISTENT AND FIRST. The banner sits above whatever the state
          renders, because the reader needs to know the connection is gone
          before they judge what is on screen. */}
      {offline && <OfflineBanner pendingCount={pendingCount} />}
      {renderState(state)}
    </View>
  );
}

function renderState(state: ScreenState): React.ReactNode {
  switch (state.kind) {
    case 'loading':
      return <ListSkeleton rows={state.rows ?? 3} testID="screen-state-loading" />;

    case 'error':
      return (
        <ErrorState
          messageKey={state.messageKey ?? 'states.errorBody'}
          retryKey={state.retryKey}
          onRetry={state.onRetry}
          testID="screen-state-error"
        />
      );

    case 'empty':
      return (
        <EmptyState
          prompt={state.prompt}
          body={state.body}
          action={state.action}
          testID="screen-state-empty"
        />
      );

    case 'permissionDenied':
      return (
        <PermissionDeniedState
          messageKey={state.messageKey}
          alternative={state.alternative}
          testID="screen-state-denied"
        />
      );

    case 'ready':
      return state.children;
  }
}

/**
 * The one place a screen may turn a failure into a sentence.
 *
 * Screens hold catalogue KEYS, never messages, so this exists to keep the
 * "plain language, never a code" rule (§6) in a single spot: a key that does
 * not resolve would surface the key itself, which is exactly the raw
 * identifier the rule forbids.
 */
export function useStateCopy() {
  const { t } = useTranslation();

  return {
    loading: t('states.loading'),
    errorTitle: t('states.errorTitle'),
    errorBody: t('states.errorBody'),
    retry: t('common.retry'),
  };
}

/**
 * A titled block for a screen that is ready but has nothing in one section.
 *
 * S6's organizer-alone case is the important one (AC-11.3.1): the screen is
 * ready, the proposals list is empty, and the prompt is the only thing on it
 * that a new organizer can act on.
 */
export function SectionPlaceholder({ message }: { message: string }) {
  const { t: theme } = useTheme();

  return (
    <View style={[styles.placeholder, { backgroundColor: theme.surface2 }]}>
      <Text variant="body" color={theme.textMuted}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[3],
  },
  placeholder: {
    borderRadius: space[3],
    padding: space[4],
  },
});
