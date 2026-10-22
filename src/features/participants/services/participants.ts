/**
 * The S13 participant list client (Plan 09 Task 13).
 *
 * The payload carries `start_point_state`, never a coordinate — the server
 * decides what each viewer may see, so the screen has no filtering of its own to
 * get wrong.
 */

import { apiRequest } from '@/src/lib/api';

/** Per-viewer state of one member's start point. */
export type StartPointState = 'shared' | 'not_shared' | 'none';

export interface ParticipantAudienceEntry {
  id: string;
  display_name: string;
  role: 'organizer' | 'member';
  start_point_shared: boolean;
  start_point_state: StartPointState;
  is_self: boolean;
}

export async function listParticipants(
  eventId: string,
  userId: string | null,
): Promise<ParticipantAudienceEntry[]> {
  const { data } = await apiRequest<{ participants: ParticipantAudienceEntry[] }>(
    `/api/events/${encodeURIComponent(eventId)}/participants`,
    { method: 'GET', userId },
  );

  return data.participants;
}
