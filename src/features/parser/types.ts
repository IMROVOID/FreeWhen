/**
 * The chat parser's contract (Plan 14 Task 7, PRD-07 §2, §4.2).
 *
 * ★ A CANDIDATE IS A SUGGESTION, NEVER A ROW.
 *
 * Nothing in this file describes a proposal. It describes something the parser
 * *thinks* it read, with a confidence and with the exact span of the pasted
 * text it came from. The user confirms a candidate into a proposal through the
 * ordinary create path; the parse endpoint has no write access at all (G1,
 * AC-7.1.1). Keeping the two shapes distinct is what makes that structural
 * rather than a convention someone can forget.
 *
 * ★ EVERY CANDIDATE CARRIES ITS EVIDENCE.
 *
 * `evidence` is the substring the match came from and `confidence` is how sure
 * the parser is. The review screen shows both, because a parser that cannot say
 * why it proposed something is asking the user to trust a guess — and E4 requires
 * that an ambiguous «جمعه» is SHOWN as a resolution rather than silently picked.
 */

import type { ProposalType } from '@/src/types/proposal';

/**
 * The pasted-text ceiling, in characters (plan E1).
 *
 * A group chat export pasted whole is a different feature; four thousand
 * characters is several screens of conversation, which is the realistic paste.
 * Over the cap the request is rejected with a catalogue key rather than
 * truncated, because a truncated tail silently drops suggestions.
 */
export const PASTE_MAX_CHARS = 4000;

/**
 * The candidate ceiling (plan E5).
 *
 * Beyond ten, the review list stops being a review and becomes a second job.
 * Candidates are ordered by confidence, so the cap drops the least certain.
 */
export const MAX_CANDIDATES = 10;

/**
 * Where a candidate came from.
 *
 * `deterministic` is the only reachable value today: the deterministic parser is
 * the primary implementation (FR-7.2, §7 G5), not a fallback for when a model is
 * available. A model, when one is reachable, may only ADD candidates — it can
 * never remove or rewrite one of these.
 */
export type CandidateSource = 'deterministic' | 'ai';

/** A date and time the parser believes it read, in the event's own zone. */
export interface ParsedDateTime {
  /** `YYYY-MM-DD` in the event's zone. */
  date: string;
  /** `HH:MM` in the event's zone. */
  time: string;
  /** The weekday the date resolves to — what the confirmation line names. */
  weekday: string;
  /**
   * True when the input named a weekday with no date, so the parser had to
   * choose the nearest future occurrence inside the window (plan E4).
   *
   * The screen shows the resolved date for confirmation when this is true, and
   * does not when the user typed an explicit date.
   */
  resolvedFromWeekday: boolean;
}

/** One suggested proposal, awaiting confirmation. */
export interface ParsedCandidate {
  /** Stable within one parse response; the review list's key. */
  id: string;
  /** The shape the proposal would take if confirmed. */
  type: ProposalType;
  /** A title taken from the text, trimmed to the column's 60 characters. */
  title: string;
  /** The place phrase as written, for the search the user then runs. */
  placeQuery: string | null;
  /** The instant, when a time was read. */
  startUtc: string | null;
  endUtc: string | null;
  /** The local date/time, so the review line reads in the event's zone. */
  local: ParsedDateTime | null;
  /** 0–1. Drives the ordering and the cap. */
  confidence: number;
  /** The substring the candidate came from — shown, never logged. */
  evidence: string;
  source: CandidateSource;
}

/**
 * The parse response.
 *
 * ★ AN EMPTY LIST IS A NORMAL RESULT (FR-7.9).
 *
 * There is no error field for "nothing was recognised". A parse that finds
 * nothing is the parser being honest, and the screen answers it with the raw
 * text plus a manual-entry prompt — not an error state over a screen where
 * nothing went wrong.
 */
export interface ParseResult {
  candidates: ParsedCandidate[];
  /** The text the candidates were derived from, so a failure can echo it. */
  text: string;
  /** Whether any text at all was recognised. */
  recognised: boolean;
}

/** The event facts a parse needs: where its window sits, and in which zone. */
export interface ParseContext {
  /** `YYYY-MM-DD` in the event's zone — the first day a proposal may use. */
  windowStartDate: string;
  /** `YYYY-MM-DD` in the event's zone — the last day a proposal may use. */
  windowEndDate: string;
  homeTz: string;
  /**
   * The instant the parse runs, as the event's own wall clock.
   *
   * Passed in rather than read from `Date.now()` so the relative-date resolver
   * is testable at a fixed moment — the whole Esfand/March boundary case (E9)
   * depends on controlling it.
   */
  now: { date: string; time: string };
}
