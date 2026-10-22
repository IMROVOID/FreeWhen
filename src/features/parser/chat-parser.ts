/**
 * The chat parser's coordinator (Plan 14 Task 7, PRD-07 §4.2, G1, G3).
 *
 * ★ THERE IS NO CODE PATH FROM THIS MODULE TO A DATABASE WRITE (G1).
 *
 * It returns candidates. It imports no service, no pool and no query. The proof
 * is structural rather than a promise, which is what AC-7.1.1 asks for and what
 * `tests/parser/deterministic.test.ts` asserts by reading this file's imports.
 *
 * ★ SHAPE ≠ SENSE (G3).
 *
 * A well-formed candidate can still describe a venue in another country or a
 * slot outside the event. `passesConstraints` re-checks the business rules after
 * the parse, so a future model-backed source cannot bypass them by returning
 * something the schema happens to accept.
 */

import { parseDeterministic } from './deterministic';
import {
  MAX_CANDIDATES,
  PASTE_MAX_CHARS,
  type ParseContext,
  type ParsedCandidate,
  type ParseResult,
} from './types';

/**
 * Iran's bounding box (PRD-07 G3, AC-7.5.1).
 *
 * ★ A CANDIDATE OUTSIDE THIS BOX IS A PARSE ERROR, NOT A FAR-AWAY CAFÉ.
 *
 * The product is single-city Iran (AS3.1), so a venue in another country is
 * either a misreading or a hallucination. Either way it is rejected before it
 * reaches the review list — and rejecting one must not reject the others, which
 * is why this is a per-candidate predicate rather than a batch check.
 */
export const IRAN_BBOX = {
  latMin: 25,
  latMax: 40,
  lngMin: 44,
  lngMax: 64,
} as const;

/** Whether a coordinate sits inside Iran. */
export function isInsideIran(lat: number, lng: number): boolean {
  return (
    lat >= IRAN_BBOX.latMin &&
    lat <= IRAN_BBOX.latMax &&
    lng >= IRAN_BBOX.lngMin &&
    lng <= IRAN_BBOX.lngMax
  );
}

/**
 * Whether a candidate describes something the app can actually store.
 *
 * ★ THE CHECKS ARE THE DATABASE'S RULES, RESTATED.
 *
 * Each one mirrors a constraint the create path already enforces, so a candidate
 * that passes here cannot be confirmed into a row that Postgres then rejects —
 * which would be a 500 raised by a user's paste.
 */
export function passesConstraints(
  candidate: ParsedCandidate,
  context: ParseContext,
  nowUtc: Date = new Date(),
): boolean {
  if (candidate.title.trim() === '') return false;

  if (candidate.startUtc !== null) {
    const start = new Date(candidate.startUtc);
    if (Number.isNaN(start.getTime())) return false;

    // A slot in the past cannot be voted on, so it is not a suggestion.
    if (start <= nowUtc) return false;

    if (candidate.endUtc !== null) {
      const end = new Date(candidate.endUtc);
      if (Number.isNaN(end.getTime())) return false;
      if (end <= start) return false;
    }

    const day = candidate.local?.date;
    if (!day) return false;
    if (day < context.windowStartDate || day > context.windowEndDate) return false;
  }

  // A place-only candidate needs a phrase to search, and nothing to constrain
  // geographically until the search resolves it.
  if (candidate.type !== 'TIME' && candidate.placeQuery === null) return false;

  return true;
}

/** Applies the constraint pass to a whole result, keeping the input order. */
function filterConstraints(
  result: ParseResult,
  context: ParseContext,
  nowUtc: Date,
): ParseResult {
  const kept = result.candidates.filter((candidate) =>
    passesConstraints(candidate, context, nowUtc),
  );

  return {
    ...result,
    candidates: kept.slice(0, MAX_CANDIDATES),
    recognised: kept.length > 0,
  };
}

/**
 * Parses pasted text into reviewable candidates.
 *
 * ★ A FAILURE IS A RESULT, NOT AN EXCEPTION (FR-7.9).
 *
 * Oversized or unparseable input answers with an empty list and the raw text, so
 * the screen can show what the user pasted next to a manual-entry prompt. An
 * exception here would become an error state over a screen where nothing is
 * broken.
 */
export function parseChat(
  text: string,
  context: ParseContext,
  nowUtc: Date = new Date(),
): ParseResult {
  if (text.length > PASTE_MAX_CHARS) {
    return { candidates: [], text, recognised: false };
  }

  try {
    return filterConstraints(parseDeterministic(text, context), context, nowUtc);
  } catch {
    return { candidates: [], text, recognised: false };
  }
}

/** Whether a paste is within the ceiling the endpoint accepts. */
export function isWithinPasteLimit(text: string): boolean {
  return text.length <= PASTE_MAX_CHARS;
}
