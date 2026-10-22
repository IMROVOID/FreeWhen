/**
 * Invite resolution, rotation and revocation (Plan 05 Tasks 4 and 8).
 *
 * ★ A RESOLVED INVITE IS NOT A REDEEMED ONE.
 *
 * `resolve` reads the title and count so S4 can render; it consumes nothing.
 * The caller joins by a separate call, which is what makes the S4 screen
 * re-openable without creating a participant each time.
 */

import { apiRequest } from '@/src/lib/api';
import type { EventSummary, InviteIssue, InviteResolution } from '@/src/types/event';

/** Reads an invite. Throws `ApiFailure` with `INVITE_INVALID` or `EVENT_FULL`. */
export async function resolveInvite(
  token: string,
  userId: string | null,
): Promise<InviteResolution> {
  const { data } = await apiRequest<{ event: InviteResolution }>(`/api/invite/${token}`, {
    userId,
    platform: 'app',
  });

  return data.event;
}

export interface RotateInviteResult {
  invite: InviteIssue;
  /** The organizer's identity, in case the server resolved a different one. */
  userId: string | null;
}

/**
 * Rotates the link (FR-1.11).
 *
 * The old link stops working the instant this succeeds, which is why the caller
 * confirms first — it is destructive to a URL already in circulation.
 */
export async function rotateInvite(
  eventId: string,
  userId: string | null,
): Promise<RotateInviteResult> {
  const { data, userId: echoed } = await apiRequest<{ invite: InviteIssue }>(
    `/api/events/${eventId}/invite/rotate`,
    { method: 'POST', userId },
  );

  return { invite: data.invite, userId: echoed };
}

/** Revokes the link (FR-1.10). Reversible only by rotating. */
export async function revokeInvite(eventId: string, userId: string | null): Promise<void> {
  await apiRequest<{ revoked: boolean }>(`/api/events/${eventId}/invite`, {
    method: 'DELETE',
    userId,
  });
}

/** S1 — the events this device's identity created or joined. */
export async function listMyEvents(userId: string | null): Promise<EventSummary[]> {
  const { data } = await apiRequest<{ events: EventSummary[] }>('/api/events', { userId });
  return data.events;
}
