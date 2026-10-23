/**
 * Reopening a confirmed decision (Plan 14 Task 2, PRD-02 FR-2.22, AC-2.6.1).
 *
 * ★ A REASON IS REQUIRED, AND AN EMPTY ONE IS REFUSED (AC-2.6.1).
 *
 * Reopening is legitimate — the wrong night was confirmed, a venue closed — but
 * it is also disruptive: it restarts a vote everybody had finished. The reason
 * is what makes it explicable to the group instead of chaotic, so it is a
 * requirement in the database write, not a hint in the UI.
 *
 * ★ HISTORY IS PRESERVED, NEVER OVERWRITTEN (FR-2.22).
 *
 * The decision row is not deleted. `reopened_at` and `reopen_reason` are set, and
 * the partial unique index on `(event_id, axis) where reopened_at is null` then
 * permits a new live decision while the old one remains readable. A delete would
 * erase the fact that a group decided something and then changed their minds —
 * which is exactly the context they need later.
 *
 * ★ THE CHOSEN PROPOSAL GOES BACK TO `REOPENED`, NOT TO `OPEN`.
 *
 * The status records how the option arrived at its current state. A proposal
 * that was chosen and then reopened is a different fact from one nobody has
 * decided on, and the card's copy differs accordingly.
 */

import type { Proposal } from '@/src/types/proposal';
import type { DecisionAxis } from '@/src/types/vote';

import { PROPOSAL_COLUMNS, PROPOSAL_FROM, toProposal, type ProposalRow } from './proposal-row';
import { REASON_MAX_CHARS, REASON_MIN_CHARS } from '@/src/types/vote';

import { appendActivity, participantIn } from './vote-service';
import { scopedQueryable, withTransaction, type Caller } from './supabase';

/**
 * The reason's bounds.
 *
 * Short enough to read in a banner, long enough to be an explanation. The lower
 * bound is what makes AC-2.6.1 meaningful: a single character is not a reason.
 *
 * ★ DECLARED IN `src/types/vote.ts` AND RE-EXPORTED HERE. The sheet that
 * counts the characters is a client component; importing them from this module
 * dragged the database pool into the app bundle. Re-exporting keeps every
 * existing server caller pointed at the same value.
 */
export { REASON_MAX_CHARS, REASON_MIN_CHARS };

export type ReopenOutcome =
  | { status: 'REOPENED'; decisionId: string; reopenedProposals: Proposal[] }
  | { status: 'NO_LIVE_DECISION' }
  | { status: 'NOT_ORGANIZER' }
  | { status: 'NOT_PARTICIPANT' }
  | { status: 'EMPTY_REASON' };

/** A reason, trimmed and checked. `null` when it fails either bound. */
export function normaliseReason(reason: string): string | null {
  const trimmed = reason.trim();

  if (trimmed.length < REASON_MIN_CHARS || trimmed.length > REASON_MAX_CHARS) return null;

  return trimmed;
}

/** Every axis with a live decision in the event, or `[]`. */
export async function liveDecisionAxes(eventId: string): Promise<DecisionAxis[]> {
  const result = await scopedQueryable().query<{ axis: DecisionAxis }>(
    `select axis from decision where event_id = $1 and reopened_at is null`,
    [eventId],
  );

  return result.rows.map((row) => row.axis);
}

/**
 * Reopens the event's live decisions.
 *
 * ★ THE EVENT ROW IS LOCKED FIRST.
 *
 * Two organizers tapping reopen at the same moment must not both find a live
 * decision and both insert activity rows. The lock serialises them, so the
 * second call sees `reopened_at` already set and answers `NO_LIVE_DECISION`
 * rather than duplicating the work.
 */
export async function reopenEvent(
  caller: Caller,
  eventId: string,
  reason: string,
): Promise<ReopenOutcome> {
  const trimmed = normaliseReason(reason);
  if (!trimmed) return { status: 'EMPTY_REASON' };

  return withTransaction(async (client) => {
    const locked = await client.query<{ id: string; status: string; created_by: string }>(
      `select id, status, created_by from event where id = $1 for update`,
      [eventId],
    );

    const event = locked.rows[0];
    if (!event) return { status: 'NOT_PARTICIPANT' } as const;

    const me = await participantIn(eventId, caller, client);
    if (!me) return { status: 'NOT_PARTICIPANT' } as const;

    // Only the organizer may restart the vote. Enforced here as well as in the
    // route, because a route that trusted only itself would be one refactor away
    // from letting any participant reopen a decision they lost.
    if (me.role !== 'organizer' || event.created_by !== caller.userId) {
      return { status: 'NOT_ORGANIZER' } as const;
    }

    const live = await client.query<{ id: string; axis: DecisionAxis; proposal_id: string | null }>(
      `select id, axis, proposal_id
       from decision
       where event_id = $1 and reopened_at is null`,
      [eventId],
    );

    if (live.rows.length === 0) return { status: 'NO_LIVE_DECISION' } as const;

    // Both columns in one statement, so a decision can never be marked reopened
    // without the reason that justifies it.
    await client.query(
      `update decision
          set reopened_at = now(), reopen_reason = $2
        where event_id = $1 and reopened_at is null`,
      [eventId, trimmed],
    );

    const chosenIds = live.rows
      .map((row) => row.proposal_id)
      .filter((id): id is string => id !== null);

    if (chosenIds.length > 0) {
      await client.query(
        `update proposal set status = 'REOPENED' where id = any($1::uuid[])`,
        [chosenIds],
      );
    }

    // ★ THE EVENT GOES BACK TO VOTING, NOT TO ITS INITIAL STATE.
    //
    // `DECIDING` is the state that says "a decision is being made" — which is
    // true again. `PAST` and `CANCELLED` are terminal and are left alone: a
    // cancelled event does not become votable because somebody reopened it.
    await client.query(
      `update event
          set status = 'DECIDING', updated_at = now()
        where id = $1 and status in ('CONFIRMED','DECIDING')`,
      [eventId],
    );

    await appendActivity(client, {
      eventId,
      actorId: me.id,
      action: 'reopened',
      subjectType: 'decision',
      subjectId: live.rows[0]?.id ?? null,
      // ★ THE REASON IS THE ONE DELIBERATE PROSE IN THE LOG.
      //
      // Everywhere else the detail holds enum tokens, because a rendered
      // sentence freezes one language forever. Here the reason IS the content:
      // the organizer's own words are what the group needs to read, and
      // translating them would be inventing words they did not write.
      detail: {
        axes: live.rows.map((row) => row.axis).join(','),
        reopened_count: live.rows.length,
        reason: trimmed,
      },
    });

    const reopened = await client.query<ProposalRow>(
      `select ${PROPOSAL_COLUMNS} ${PROPOSAL_FROM} where pr.id = any($1::uuid[])`,
      [chosenIds],
    );

    return {
      status: 'REOPENED',
      decisionId: live.rows[0]?.id ?? '',
      reopenedProposals: reopened.rows.map(toProposal),
    } as const;
  });
}

/** The most recent reopen reason for the event, or `null` when never reopened. */
export async function latestReopenReason(
  eventId: string,
): Promise<{ reason: string; reopenedAt: string } | null> {
  const result = await scopedQueryable().query<{ reopen_reason: string | null; reopened_at: Date | null }>(
    `select reopen_reason, reopened_at
       from decision
      where event_id = $1 and reopened_at is not null
      order by reopened_at desc
      limit 1`,
    [eventId],
  );

  const row = result.rows[0];
  if (!row?.reopened_at) return null;

  return { reason: row.reopen_reason ?? '', reopenedAt: row.reopened_at.toISOString() };
}
