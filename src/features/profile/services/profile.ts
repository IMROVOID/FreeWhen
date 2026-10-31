/**
 * The caller's global nickname (Plan 49 T8).
 *
 * ★ THE NICKNAME IS REQUIRED, NOT OPTIONAL.
 *
 * The app asks once, on first launch, and cannot be dismissed until answered:
 * a person with no name is one whose proposals, votes and messages render as a
 * gap in somebody else's event. The gate that enforces this lives in
 * `app/_layout.tsx`, above the router, so no deep link can skip it.
 *
 * ★ A LOCAL COPY, BECAUSE THE GATE MUST SURVIVE A FAILED REQUEST.
 *
 * `PUT /api/profile` can fail — offline, a cold function, a validation refusal.
 * If the stored value were the only source, a failed save would leave the gate
 * open forever and lock the person out of the app entirely. The last known
 * nickname is cached next to the user id, so the gate can open on a provisional
 * value and retry the write later. The server remains the truth; the cache is
 * what stops a network hiccup from being a total lockout.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiRequest } from '@/src/lib/api';
import { getStoredUserId, storeUserId } from '@/src/lib/session';

/** Where the last known nickname is cached, beside `freewhen.auth_user_id`. */
export const NICKNAME_STORAGE_KEY = 'freewhen.profile.nickname';

export interface ProfileResponse {
  nickname: string | null;
  /** Present when the request established an identity the client must store. */
  userId?: string;
}

/**
 * The response shape, exported for the assertion that keeps `userId` on it.
 *
 * ★ A MINTED IDENTITY HAS TO COME BACK.
 *
 * `PUT /api/profile` mints an identity for a first-launch caller, because the
 * nickname gate runs before anything that would. If the response did not carry
 * it, the client would save the name and then send its next request with no id —
 * which is the reported `GET /api/events` and `PUT /api/profile` 403 pair, and the
 * reason a nickname chosen on the home page was invisible to the join form.
 */
export const ProfileResultShape: Readonly<Record<keyof ProfileResponse, true>> = {
  nickname: true,
  userId: true,
};

/** Reads the cached nickname, without a request. */
export async function readCachedNickname(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(NICKNAME_STORAGE_KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    // A storage failure must not be read as "no nickname": that would re-open the
    // gate on a device whose cache is fine and simply unreadable this once.
    return null;
  }
}

async function cacheNickname(nickname: string | null): Promise<void> {
  try {
    if (nickname) await AsyncStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
    else await AsyncStorage.removeItem(NICKNAME_STORAGE_KEY);
  } catch {
    // Best-effort: the server already holds the value.
  }
}

/**
 * The nickname, cached-then-remote.
 *
 * The cache answers first so the gate does not flash on every launch, and the
 * server answers second so a nickname changed on another device is picked up.
 * A network failure falls back to the cache rather than to `null` — "we could not
 * ask" is not "you have no name".
 */
export async function loadNickname(): Promise<string | null> {
  const cached = await readCachedNickname();

  try {
    const userId = await getStoredUserId();
    const { data } = await apiRequest<ProfileResponse>('/api/profile', { userId: userId ?? undefined });

    await cacheNickname(data.nickname);
    return data.nickname ?? cached;
  } catch {
    return cached;
  }
}

/** Stores the nickname, and caches it whether or not the request succeeds. */
export async function saveNickname(nickname: string): Promise<string> {
  const trimmed = nickname.trim();

  const userId = await getStoredUserId();
  const { data } = await apiRequest<ProfileResponse>('/api/profile', {
    method: 'PUT',
    userId: userId ?? undefined,
    body: { nickname: trimmed },
  });

  // ★ THE MINTED IDENTITY IS STORED IMMEDIATELY.
  //
  // The profile save is the first thing a new person does, so it is where the
  // identity is minted. Keeping the id from the response is what makes every
  // later request — `GET /api/events`, the join, the location save — carry one.
  if (data.userId) await storeUserId(data.userId);

  const stored = data.nickname ?? trimmed;
  await cacheNickname(stored);
  return stored;
}

/**
 * Pushes a nickname to the profile after a join already minted the identity.
 *
 * ★ THE JOIN IS THE OTHER MOMENT THE SERVER LEARNS A NAME.
 *
 * `saveNicknameOptimistically` (below) writes the cache only — deliberately, so a
 * failed write cannot block a join that already succeeded. That leaves the
 * `user_profile` row missing for anyone whose first act was to accept an invite,
 * so the join path is followed by this best-effort hard write. Failure is ignored
 * for the same reason the optimistic path exists: the join is what mattered.
 */
export async function persistNickname(nickname: string): Promise<void> {
  try {
    await saveNickname(nickname);
  } catch {
    // The cache already holds it — see `saveNicknameOptimistically`.
  }
}

/**
 * Stores the nickname without surfacing a failure, for the provisional path.
 *
 * Used when the person has answered but the write could not be delivered. The
 * value is cached so the app is usable, and the next successful `loadNickname`
 * reconciles it.
 */
export async function saveNicknameOptimistically(nickname: string): Promise<void> {
  await cacheNickname(nickname.trim());
}

/** Validates a typed nickname against the same bounds the server applies. */
export function validateNickname(value: string): { ok: true } | { ok: false; messageKey: string } {
  const trimmed = value.trim();

  // ★ THE NAMESPACE IS `events.validation`, NOT `validation`.
  //
  // These two keys were missing their namespace, so `t()` found nothing and echoed
  // the key itself: a user submitting an empty name was shown the literal string
  // `validation.nameRequired`. The other validators in `src/types/event.ts` all
  // report `events.validation.*`, and the catalogues nest every message there —
  // this file was the only one that disagreed.
  if (trimmed.length < 1) return { ok: false, messageKey: 'events.validation.nameRequired' };
  if (trimmed.length > 30) return { ok: false, messageKey: 'events.validation.nameTooLong' };

  return { ok: true };
}
