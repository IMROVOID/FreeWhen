import { apiRequest } from '@/src/lib/api';
import type { EventSummary } from '@/src/types/event';

/** Renames the event / venue. Only organizer has permission. */
export async function renameEvent(
  eventId: string,
  title: string,
  userId: string | null,
): Promise<EventSummary> {
  const { data } = await apiRequest<{ event: EventSummary }>(`/api/events/${eventId}`, {
    method: 'PATCH',
    body: { title },
    userId,
  });

  return data.event;
}

/** Deletes the event / venue and cascades. Only organizer has permission. */
export async function deleteEvent(eventId: string, userId: string | null): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/events/${eventId}`, {
    method: 'DELETE',
    userId,
  });
}

/** Removes a participant from the event. Only organizer has permission. */
export async function removeParticipant(
  eventId: string,
  participantId: string,
  userId: string | null,
): Promise<void> {
  await apiRequest<{ removed: boolean }>(`/api/events/${eventId}/participants/${participantId}`, {
    method: 'DELETE',
    userId,
  });
}

/** Leaves the event. Allowed for non-organizer members. */
export async function leaveEvent(eventId: string, userId: string | null): Promise<void> {
  await apiRequest<{ left: boolean }>(`/api/events/${eventId}/leave`, {
    method: 'POST',
    userId,
  });
}
