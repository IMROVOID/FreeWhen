/**
 * Push permission, requested after the first vote (Plan 10 Task 7, FR-6.14,
 * AC-6.2.1).
 *
 * ★ NEVER AT LAUNCH (FR-6.14).
 *
 * A launch-time prompt is asked before the user has any reason to say yes, so it
 * is denied — and a denial is expensive to recover: iOS only lets an app prompt
 * once, and afterwards the user must go to Settings. The request is therefore
 * driven by `requestAfterFirstVote()`, called at a moment the user has just
 * demonstrated the app is worth something.
 *
 * ★ THE APP IS FULLY USABLE WITH NOTIFICATIONS DENIED (FR-6.13, AC-6.2.1).
 *
 * Nothing in this hook gates a feature. `status` is reported so a caller can show
 * an in-app badge instead, and the in-app attention signal carries everything the
 * push notification would have said. Apple §5.1.2(i) forbids requiring system
 * functionality to reach features, and this is where that is honoured.
 *
 * ★ LOCAL NOTIFICATIONS NEED NO PERMISSION ON WEB, AND NO DEVICE TOKEN ANYWHERE.
 *
 * Remote push requires a dev build and a token (P1, Phase 14); this phase ships
 * local + in-app only, so a missing token is a normal state rather than a failure
 * (E5).
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** What the OS currently allows. */
export type PermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unavailable';

/**
 * The notification module, loaded defensively.
 *
 * `expo-notifications` is not a dependency of this phase and is not installed for
 * the web build. Rather than failing the import, the hook reports the capability
 * as unavailable — which is the honest state and keeps the app fully usable (E2).
 */
interface NotificationsModule {
  getPermissionsAsync: () => Promise<{ status: string; canAskAgain?: boolean }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
}

function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    // Not installed in this build. In-app delivery already covers the signal.
    return null;
  }
}

/** Whether the user has already been asked, so a repeat prompt is not shown. */
const ASKED_KEY = 'freewhen.push.asked';

export interface UsePushPermissionResult {
  status: PermissionStatus;
  /** True once the request has been made at least once on this device. */
  hasAsked: boolean;
  /**
   * Requests permission. Call ONLY after a first successful vote.
   *
   * Returns the resulting status; never throws, because a denied or unavailable
   * permission is a normal outcome and not an error the caller should handle.
   */
  requestAfterFirstVote: () => Promise<PermissionStatus>;
}

export function usePushPermission(): UsePushPermissionResult {
  const [status, setStatus] = useState<PermissionStatus>('undetermined');
  const [hasAsked, setHasAsked] = useState(false);

  // Reads the current status WITHOUT prompting. This is the only thing that runs
  // on mount — there is deliberately no `requestPermissionsAsync` call here.
  useEffect(() => {
    const module = loadNotifications();
    if (!module) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;

    void module
      .getPermissionsAsync()
      .then((result) => {
        if (cancelled) return;
        setStatus(toStatus(result.status));
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const requestAfterFirstVote = useCallback(async (): Promise<PermissionStatus> => {
    // A second prompt is not shown. Once denied, the path is the OS settings
    // screen, and re-asking in-app would be nagging with no effect.
    if (hasAsked) return status;

    const module = loadNotifications();
    if (!module) {
      setStatus('unavailable');
      return 'unavailable';
    }

    setHasAsked(true);

    try {
      const result = await module.requestPermissionsAsync();
      const next = toStatus(result.status);
      setStatus(next);

      if (next === 'denied' || next === 'granted') {
        // Recorded so a later launch does not re-prompt (FR-6.14).
        try {
          await AsyncStorage.setItem(ASKED_KEY, '1');
        } catch {
          // Best effort: a device that cannot remember still works, it may just
          // ask again on a future install.
        }
      }

      return next;
    } catch {
      setStatus('unavailable');
      return 'unavailable';
    }
  }, [hasAsked, status]);

  return { status, hasAsked, requestAfterFirstVote };
}

/** Normalises the OS's status strings. */
function toStatus(raw: string): PermissionStatus {
  if (raw === 'granted') return 'granted';
  if (raw === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Whether the in-app badge should carry the signal.
 *
 * True whenever push cannot be relied on — denied, unavailable, or never asked.
 * AC-6.2.1 is this function returning true and every screen honouring it.
 */
export function needsInAppSignal(status: PermissionStatus): boolean {
  return status !== 'granted';
}
