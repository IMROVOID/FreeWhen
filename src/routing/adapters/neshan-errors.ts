/**
 * The Neshan error-code table — implemented literally.
 *
 * PRD-05 §12.3 publishes nine documented HTTP statuses and the correct
 * response to each. The distinction that matters most is **which failures
 * are worth retrying**, and the table encodes it exactly:
 *
 * - A **config fault** (480, 483, 484, 485) looks transient and is not.
 *   Retrying never helps, and a retry-on-reflex implementation will burn
 *   the whole backoff budget discovering that.
 * - **481 `LimitExceeded`** means the quota is spent. A retry cannot buy
 *   quota back; it only delays the fallback that would have worked.
 * - **470 `CoordinateParseError`** is a statement about ONE point, not about
 *   the request. Treating it as a whole-request failure discards seven good
 *   measurements because one origin was malformed.
 * - **500 `GenericError`** is the only genuinely transient code, so it is
 *   the only one that earns a retry.
 *
 * The mapping is a pure function of the status code, so it is exhaustively
 * testable without a network (Task 1).
 */

/**
 * What the caller should do about a status code.
 *
 * The kinds are mutually exclusive and each one implies a different code
 * path in the adapter, so a `switch` on `kind` is exhaustive by
 * construction.
 */
export type NeshanAction =
  /** 400 — the request is wrong. Fix the caller. Never retry. */
  | { kind: 'fix_caller' }
  /** 470 — drop THAT point, keep the rest of the matrix. */
  | { kind: 'drop_point' }
  /** 480/483/484/485 — a config fault. Log loudly and degrade; retrying never helps. */
  | { kind: 'log_and_degrade'; loud: true }
  /** 481 — the quota is exhausted. Degrade immediately; never retry. */
  | { kind: 'degrade_immediately' }
  /** 482 — the per-minute cap. Back off, then degrade if it persists. */
  | { kind: 'backoff_then_degrade' }
  /** 500 — transient. Retry once, then degrade. */
  | { kind: 'retry_once_then_degrade' };

/**
 * Maps a Neshan HTTP status to its documented action.
 *
 * The default is `degrade_immediately`: an undocumented status is treated as
 * a failure to degrade from, not as a reason to keep retrying. The ladder's
 * contract is that it never fails, so an unknown code must move the ladder
 * forward rather than stall it.
 */
export function mapNeshanStatus(http: number): NeshanAction {
  switch (http) {
    case 400:
      return { kind: 'fix_caller' };
    case 470:
      return { kind: 'drop_point' };
    case 480:
      return { kind: 'log_and_degrade', loud: true };
    case 481:
      return { kind: 'degrade_immediately' };
    case 482:
      return { kind: 'backoff_then_degrade' };
    case 483:
    case 484:
    case 485:
      return { kind: 'log_and_degrade', loud: true };
    case 500:
      return { kind: 'retry_once_then_degrade' };
    default:
      return { kind: 'degrade_immediately' };
  }
}

/**
 * Whether the action involves a retry.
 *
 * Exactly one documented status earns one: 500. Every other code either
 * cannot succeed on a retry (a config fault, an exhausted quota) or is not
 * about the request at all (470).
 */
export function neshanActionRetries(action: NeshanAction): boolean {
  return action.kind === 'retry_once_then_degrade';
}

/**
 * The status codes this table covers, in the order PRD-05 §12.3 lists them.
 *
 * The test suite iterates this list, so a code added to the table without a
 * test fails the suite rather than passing silently.
 */
export const NESHAN_DOCUMENTED_STATUSES = [
  400, 470, 480, 481, 482, 483, 484, 485, 500,
] as const;

/**
 * The per-element statuses a Neshan matrix response can carry.
 *
 * `Ok` is a resolved pair. `NoRoute` is a **resolved absence**: the
 * provider says no road connects these two points, which is a fact about
 * the world and NOT a low cost and NOT an instant journey. `UnknownError`
 * is the provider's own uncertainty.
 */
export type NeshanElementStatus = 'Ok' | 'NoRoute' | 'UnknownError';

/**
 * Why a provider refused.
 *
 * The reason decides how long the provider is benched, so it matters:
 * a quota lasts for hours, a rate cap for a minute, and a config fault
 * until someone deploys a fix.
 */
export type RefusalReason = 'quota' | 'rate' | 'config' | 'transient';

/**
 * The refusal reason a documented status implies.
 *
 * Derived from the ACTION rather than from the status code, so the two
 * cannot disagree: the action is the single place the table is encoded,
 * and this is a restatement of it in the vocabulary the backoff uses.
 */
export function refusalReasonFor(
  http: number,
  action: NeshanAction = mapNeshanStatus(http),
): RefusalReason {
  switch (action.kind) {
    case 'degrade_immediately':
      // 481 is the quota. It is the only status that reaches this branch
      // from the documented table, so it is the quota.
      return http === 481 ? 'quota' : 'transient';
    case 'backoff_then_degrade':
      return 'rate';
    case 'log_and_degrade':
      return 'config';
    case 'fix_caller':
      // A caller bug is not the provider's fault, so it benches nothing.
      return 'transient';
    case 'retry_once_then_degrade':
      return 'transient';
    case 'drop_point':
      return 'transient';
  }
}
