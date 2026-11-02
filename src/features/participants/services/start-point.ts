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

/**
 * Reads the caller's saved start point for one event.
 *
 * ★ THIS IS WHAT MAKES THE SAVE PERSIST ACROSS VISITS.
 *
 * The row was always written and always per-event, but the client could only
 * learn a point from the result of its own `saveStartPoint` — so leaving the event
 * page and returning produced a map with no origin dot and no route, which reads
 * as "my location was not saved".
 *
 * Resolves to `null` for "no point", and THROWS only on a transport failure, so
 * the hook can tell "the participant has none" from "we do not know": the first is
 * a supported state that re-opens the sheet, the second is not a reason to ask the
 * question again or to erase one that is on the server.
 */
export async function readStartPoint(
  eventId: string,
  userId: string | null,
): Promise<SavedStartPoint | null> {
  const { data } = await apiRequest<{ start_point: SavedStartPoint | null }>(
    `/api/participants/me/start-point?event_id=${encodeURIComponent(eventId)}`,
    { method: 'GET', userId },
  );

  const point = data.start_point;
  if (!point) return null;

  // A malformed row is "no usable point", not a crash on a screen that is only
  // trying to draw a dot.
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;

  return point;
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
