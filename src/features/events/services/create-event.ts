/**
 * `POST /api/events` (Plan 05 Task 3).
 *
 * Creating an event mints an anonymous identity if the device has none, returns
 * the invite URL exactly once, and stores the identity so the organizer can come
 * back to their own event. The store happens before the caller sees the result:
 * a participant row whose owner forgets their id is a row nobody can reach.
 */

import { apiRequest } from '@/src/lib/api';
import { storeUserId } from '@/src/lib/session';
import type {
  EventCreateInput,
  EventSummary,
  InviteIssue,
  ParticipantSummary,
} from '@/src/types/event';

export interface CreateEventResult {
  event: EventSummary;
  participant: ParticipantSummary;
  invite: InviteIssue;
  userId: string;
}

export async function createEvent(
  input: EventCreateInput,
  currentUserId: string | null,
): Promise<CreateEventResult> {
  const { data, userId } = await apiRequest<{
    event: EventSummary;
    participant: ParticipantSummary;
    invite: InviteIssue;
    user_id: string;
  }>('/api/events', {
    method: 'POST',
    body: input,
    userId: currentUserId,
  });

  if (userId) await storeUserId(userId);

  return {
    event: data.event,
    participant: data.participant,
    invite: data.invite,
    userId: data.user_id,
  };
}
