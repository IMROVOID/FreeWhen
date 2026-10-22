/**
 * The device-scoped guest identity (PRD-01 FR-1.18).
 *
 * ★ THIS IS THE WHOLE OF A GUEST'S ACCOUNT, AND IT LIVES ON THE DEVICE.
 *
 * There is no email, no password and no recovery. Clearing storage or switching
 * devices means the participant row can never be reached again, which the join
 * screen states plainly in one line rather than in a modal that people dismiss
 * without reading.
 *
 * The id is written the moment the server mints one, before the screen that
 * needed it finishes rendering: a join whose response is discarded because the
 * app closed a frame later would strand the participant it just created.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Namespaced so a second app on the same origin cannot collide with it. */
const STORAGE_KEY = 'freewhen.auth_user_id';

/** The stored identity, or `null` on a fresh install. */
export async function getStoredUserId(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    return value && value.trim() !== '' ? value : null;
  } catch {
    // Storage can be unavailable (Safari private mode, a corrupt store). A
    // guest with no readable identity is a new guest, which is recoverable;
    // throwing here would make the join screen unreachable.
    return null;
  }
}

export async function storeUserId(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, userId);
  } catch {
    // Best effort: the join still succeeded on the server, and the participant
    // is a participant whether or not this device remembers them.
  }
}

/** Forgets the identity. Used by Settings and by the tests. */
export async function clearStoredUserId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the next read already fails closed to `null`.
  }
}
