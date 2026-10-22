/**
 * Guest join (Plan 05 Task 5).
 *
 * ★ THE JOIN SEND IS ONE REQUEST WITH ONE FIELD.
 *
 * `opened_at` rides along as metadata for the funnel metric — it is not a
 * second piece of information the guest has to supply, and the server treats a
 * missing value as "unmeasured" rather than zero (PRD-12 §8.1).
 *
 * There is no location call anywhere on this path, and nothing here can prompt
 * for one: FR-1.22 is satisfied by the absence of code, which is the only kind
 * of guarantee that survives a refactor.
 */

import { apiRequest } from '@/src/lib/api';
import { storeUserId } from '@/src/lib/session';
import type { JoinResult } from '@/src/types/event';

export interface JoinOptions {
  /** When the invite screen mounted, for `guest_joined.seconds_from_open`. */
  openedAt?: string;
  userId?: string | null;
}

export async function joinEvent(
  token: string,
  displayName: string,
  options: JoinOptions = {},
): Promise<JoinResult> {
  const { data, userId } = await apiRequest<JoinResult>(`/api/invite/${token}/join`, {
    method: 'POST',
    body: {
      display_name: displayName,
      ...(options.openedAt ? { opened_at: options.openedAt } : {}),
    },
    userId: options.userId ?? null,
    platform: 'app',
  });

  // Persist before returning: a join that succeeded but was forgotten strands
  // the participant it created, and they would join again as a stranger.
  if (userId) await storeUserId(userId);

  return data;
}
