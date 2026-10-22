/**
 * Start point and profile writes (Plan 05 Task 11).
 *
 * The rounding has already happened by the time anything here is called — the
 * payload is built by `round-coords.ts` on the device. This module only
 * transports it, so there is exactly one place a coordinate is produced and one
 * place it is not (a screen).
 */

import { apiRequest } from '@/src/lib/api';
import type { ParticipantPatchInput, ParticipantSummary } from '@/src/types/event';

import type { StartPointPayload } from './round-coords';

export interface SavedStartPoint {
  lat: number;
  lng: number;
  accuracy_m: number;
  label: string | null;
}

export interface SaveStartPointResult {
  start_point: SavedStartPoint;
  /** The audience and expiry shown after adding (FR-8.9). */
  audience: { participant_count: number; expires_at: string } | null;
}

export async function saveStartPoint(
  eventId: string,
  payload: StartPointPayload,
  userId: string | null,
): Promise<SaveStartPointResult> {
  const { data } = await apiRequest<SaveStartPointResult>('/api/participants/me/start-point', {
    method: 'PUT',
    body: { event_id: eventId, ...payload },
    userId,
  });

  return data;
}

/** Removes the location. The participant and their votes survive (FR-8.21). */
export async function deleteStartPoint(eventId: string, userId: string | null): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    `/api/participants/me/start-point?event_id=${encodeURIComponent(eventId)}`,
    { method: 'DELETE', userId },
  );
}

export async function patchProfile(
  eventId: string,
  patch: ParticipantPatchInput,
  userId: string | null,
): Promise<ParticipantSummary> {
  const { data } = await apiRequest<{ participant: ParticipantSummary }>(
    '/api/participants/me',
    { method: 'PATCH', body: { event_id: eventId, ...patch }, userId },
  );

  return data.participant;
}
