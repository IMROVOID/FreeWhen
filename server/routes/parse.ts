/**
 * `POST /api/events/:id/parse` (Plan 14 Task 7, PRD-07 G1).
 *
 * ★ THIS FILE HAS NO WRITE PATH, AND THAT IS STRUCTURAL (G1, AC-7.1.1).
 *
 * It imports one read (`eventForParticipant`), the pure parser, and the HTTP
 * envelope. There is no insert, no upsert, no transaction: a candidate exists
 * only in the response body until the user confirms it through the ordinary
 * create endpoint. `tests/parser/deterministic.test.ts` asserts the absence
 * rather than trusting this comment.
 *
 * ★ A PARSE THAT FINDS NOTHING IS A 200 (FR-7.9).
 *
 * An empty candidate list is the parser being honest, and the screen answers it
 * with the raw text plus a manual-entry prompt. A 422 here would be a red banner
 * over a screen where nothing went wrong — and would teach the user that pasting
 * their chat is an error rather than a shortcut.
 */

import { parseChat, isWithinPasteLimit } from '@/src/features/parser/chat-parser';
import { windowDays } from '@/src/features/parser/deterministic';
import { PASTE_MAX_CHARS } from '@/src/features/parser/types';
import { zoneOffsetMs } from '@/src/features/proposals/services/slot-time';

import { callerIdFrom, isUuid, json, readJsonBody, validationFailed, wireError } from '../lib/http';
import { track } from '../lib/funnel';
import { limiters } from '../lib/rate-limit';
import { eventForParticipant } from '../lib/proposal-service';
import { resolveCaller, type Caller } from '../lib/supabase';

/** The catalogue key for an oversized paste, so the screen explains the cap. */
export const PASTE_TOO_LONG_KEY = 'parser.validation.textTooLong';

async function callerFrom(request: Request): Promise<Caller | null> {
  const userId = callerIdFrom(request);
  if (!userId || !isUuid(userId)) return null;

  return resolveCaller(userId);
}

/** The event's wall clock at `instant`, in its own zone. */
function wallClock(instant: Date, homeTz: string): { date: string; time: string } {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), homeTz));
  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));

  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

/**
 * `POST /api/events/:id/parse`
 *
 * Body: `{ text: string }`. Response: `{ candidates, recognised }`.
 */
export async function parseHandler(
  request: Request,
  params: Record<string, string>,
): Promise<Response> {
  const caller = await callerFrom(request);
  if (!caller) return wireError('NOT_PARTICIPANT');

  const eventId = params.id ?? '';
  if (!isUuid(eventId)) return wireError('NOT_PARTICIPANT');

  const event = await eventForParticipant(caller, eventId);
  if (!event) return wireError('NOT_PARTICIPANT');

  // ★ THE LIMITER IS THE SAME ONE THE CREATE PATH USES.
  //
  // A parse costs no provider quota today, but a model-backed source later will,
  // and a route whose budget is set only when the expensive dependency arrives
  // is a route that shipped unbounded.
  const budget = limiters.mutationByParticipant.check(`parse:${caller.userId}`);
  if (!budget.allowed) return wireError('RATE_LIMITED');

  const body = await readJsonBody(request);
  if (!body) return validationFailed([{ path: [], message: 'errors.validationFailed' }]);

  const text = body.text;
  if (typeof text !== 'string') {
    return validationFailed([{ path: ['text'], message: 'errors.validationFailed' }]);
  }

  // ★ AN OVERSIZED PASTE IS REPORTED, NOT TRUNCATED.
  //
  // Silently cutting the tail drops the last suggestions in the paste — the ones
  // the user most likely just added — with no way to tell they were ignored.
  if (!isWithinPasteLimit(text)) {
    return validationFailed([{ path: ['text'], message: PASTE_TOO_LONG_KEY }]);
  }

  const days = windowDays(event.window_start, event.window_end, event.home_tz);

  const result = parseChat(
    text,
    {
      windowStartDate: days.start,
      windowEndDate: days.end,
      homeTz: event.home_tz,
      now: wallClock(new Date(), event.home_tz),
    },
    new Date(),
  );

  // ★ THE PAYLOAD NAMES THE OUTCOME, NEVER THE TEXT.
  //
  // Pasted chat is the most sensitive thing this app touches, and `track` runs
  // the payload through `logSafe`. Counts and a boolean are all the metric needs.
  track('chat_parse_ran', {
    event_id: eventId,
    candidate_count: result.candidates.length,
    recognised: result.recognised,
  });

  // ★ THE RESPONSE IS THE WHOLE DELIVERABLE. Nothing was written.
  return json({
    candidates: result.candidates,
    recognised: result.recognised,
    limits: { maxChars: PASTE_MAX_CHARS },
  });
}
