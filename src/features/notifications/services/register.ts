/**
 * Local notification registration (Plan 10 Task 7, FR-6.13–FR-6.15).
 *
 * ★ LOCAL ONLY. REMOTE PUSH IS PHASE 14.
 *
 * This module sets the handler that decides whether a notification is shown while
 * the app is foregrounded, and offers `presentLocal()`. It registers no push
 * token, opens no socket, and calls no push service — remote push needs a dev
 * build on Android since SDK 53, and making the MVP depend on it would make the
 * feature unavailable in Expo Go.
 *
 * ★ A FOREGROUND NOTIFICATION IS SUPPRESSED, AND THE IN-APP SIGNAL CARRIES IT.
 *
 * Showing an OS banner over the screen the user is already looking at is noise.
 * The Decision Status area is the real signal (PRD-06 §1); a foreground
 * notification would duplicate it on top of itself.
 *
 * ★ EVERY ENTRY POINT IS DEFENSIVE.
 *
 * `expo-notifications` is absent on web and may be absent from a given build. When
 * it cannot load, `available` is false and `presentLocal` is a no-op — never a
 * throw, because AC-6.2.1 requires the app to be fully usable without any
 * notification capability at all.
 */

import { Platform } from 'react-native';

/** The subset of the module this phase uses. */
interface NotificationsModule {
  setNotificationHandler: (handler: {
    handleNotification: () => Promise<{
      shouldShowBanner: boolean;
      shouldShowList: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }) => void;
  scheduleNotificationAsync: (request: {
    content: { title: string; body: string; data?: Record<string, unknown> };
    trigger: null;
  }) => Promise<string>;
}

function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web') return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

/** Whether this build can raise a local notification at all. */
export function notificationsAvailable(): boolean {
  return loadNotifications() !== null;
}

let configured = false;

/**
 * Installs the foreground handler. Idempotent, and safe to call before the module
 * exists.
 */
export function registerLocalNotifications(): void {
  if (configured) return;
  configured = true;

  const module = loadNotifications();
  if (!module) return;

  try {
    module.setNotificationHandler({
      // ★ NOTHING SHOWS IN THE FOREGROUND. The user is already in the app, and
      // the status area already says what the notification would have said.
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // A build without the native module. In-app delivery is unaffected.
  }
}

export interface LocalNotification {
  title: string;
  body: string;
  /** Read back by `handler.deepLinkFromData` on tap (FR-6.20). */
  deepLink: string;
}

/**
 * Raises a local notification immediately.
 *
 * Returns whether it was handed to the OS. A `false` result is not an error: the
 * caller shows the in-app badge instead (AC-6.2.1).
 */
export async function presentLocal(notification: LocalNotification): Promise<boolean> {
  const module = loadNotifications();
  if (!module) return false;

  try {
    await module.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: { deepLink: notification.deepLink },
      },
      // `null` means now. Nothing in this phase schedules a future notification;
      // the leave-now reminder (N7) is Phase 14.
      trigger: null,
    });

    return true;
  } catch {
    return false;
  }
}
