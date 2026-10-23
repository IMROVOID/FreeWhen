/**
 * The proposal read/write layer (Plan 06 Tasks 5, 6).
 *
 * ★ `is_late` IS SET AT INSERT TIME, NOT DERIVED LATER.
 *
 * FR-2.9 marks a proposal that arrives after voting began so Phase 7 can render
 * the marker. Deriving it at read time would mean the marker changes retro-
 * actively when an event reopens voting, and a proposal that genuinely arrived
 * late would lose its label. The flag is a fact about the moment of creation, so
 * it is written once and never recomputed.
 *
 * ★ WITHDRAWAL IS A STATUS CHANGE, NOT A DELETE (PRD-02 E4).
 *
 * The row survives so the history survives: the card renders struck through and
 * the activity log keeps its entry. A delete would erase the fact that somebody
 * made a suggestion and changed their mind, which is exactly the context the
 * group needs when they later wonder why a place is not on the list.
 */

import type {
  EventWindow,
  Proposal,
  ProposalCreateInput,
  ProposalPatchInput,
} from '@/src/types/proposal';
import { VALIDATION } from '@/src/types/proposal';

import {
  PROPOSAL_COLUMNS,
  PROPOSAL_FROM,
  PROPOSAL_SELECT,
  iso,
  toProposal,
  type ProposalRow,
} from './proposal-row';
import { scopedQueryable, withTransaction, type Caller } from './supabase';

/**
 * The event, if the caller participates in it. `null` otherwise.
 *
 * One function for the access check on every proposal route, so an endpoint
 * cannot answer a different question than its siblings — and a non-participant
 * and a nonexistent event are indistinguishable, which is what stops an id
 * from being enumerable.
 */
export async function eventForParticipant(
  caller: Caller,
  eventId: string,
): Promise<EventWindow | null> {
  const result = await scopedQueryable().query<{
    home_tz: string;
    date_window_start: Date;
    date_window_end: Date;
  }>(
    `select e.home_tz, e.date_window_start, e.date_window_end
     from event e
     join participant me on me.event_id = e.id and me.auth_user_id = $2
     where e.id = $1`,
    [eventId, caller.userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    home_tz: row.home_tz,
    window_start: iso(row.date_window_start) ?? '',
    window_end: iso(row.date_window_end) ?? '',
  };
}

/** The caller's participant row for an event, or `null` when they are a stranger. */
async function participantId(
  caller: Caller,
  eventId: string,
  query: { query: (text: string, values?: unknown[]) => Promise<{ rows: { id: string }[] }> },
): Promise<string | null> {
  const result = await query.query(
    `select id from participant where event_id = $1 and auth_user_id = $2`,
    [eventId, caller.userId],
  );

  return result.rows[0]?.id ?? null;
}

/**
 * Whether voting has begun, so a new proposal can be flagged `is_late`.
 *
 * Two signals: an explicit deadline that has passed, or an existing vote. A
 * vote is the honest one — the group has started expressing preferences, and a
 * proposal arriving now is arriving into a conversation already under way.
 */
async function votingHasBegun(eventId: string): Promise<boolean> {
  const result = await scopedQueryable().query<{ begun: boolean }>(
    `select (
       exists (select 1 from vote v join proposal pr on pr.id = v.proposal_id
               where pr.event_id = $1)
       or exists (select 1 from event e
                  where e.id = $1 and e.voting_deadline is not null
                    and e.voting_deadline <= now())
     ) as begun`,
    [eventId],
  );

  return result.rows[0]?.begun === true;
}

/** The proposal's current status and owner, for the edit/withdraw guards. */
export async function proposalForEdit(
  caller: Caller,
  proposalId: string,
): Promise<{ proposal: Proposal; isOrganizer: boolean; isAuthor: boolean; eventStatus: string } | null> {
  const result = await scopedQueryable().query<
    ProposalRow & { is_organizer: boolean; is_author: boolean; event_status: string }
  >(
    `select ${PROPOSAL_COLUMNS}
     , exists (select 1 from event e where e.id = pr.event_id and e.created_by = $2)
       as is_organizer
     , (p.auth_user_id = $2) as is_author
     , (select e.status from event e where e.id = pr.event_id) as event_status
     ${PROPOSAL_FROM}
     where pr.id = $1
       and exists (select 1 from participant me
                   where me.event_id = pr.event_id and me.auth_user_id = $2)`,
    [proposalId, caller.userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    proposal: toProposal(row),
    isOrganizer: row.is_organizer,
    isAuthor: row.is_author,
    eventStatus: row.event_status,
  };
}

/** Resolves or creates the venue a place proposal points at. */
async function upsertVenue(
  query: { query: (text: string, values?: unknown[]) => Promise<{ rows: { id: string }[] }> },
  eventId: string,
  venue: NonNullable<ProposalCreateInput['venue']>,
): Promise<string> {
  if (venue.id) return venue.id;

  const inserted = await query.query(
    `insert into venue (event_id, name, lat, lng, address, provider_place_id)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      eventId,
      venue.name,
      venue.lat,
      venue.lng,
      venue.address ?? null,
      venue.provider_place_id ?? null,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('venue insert returned no id');

  return id;
}

/**
 * A new proposal (Task 5).
 *
 * ★ ANY PARTICIPANT MAY PROPOSE, INCLUDING A GUEST (FR-2.1).
 *
 * There is deliberately no `role` check on this path. Proposing is the core
 * contribution to a decision, and gating it on organizer status would leave the
 * group with options only the organizer thought of.
 *
 * ★ PROPOSING NEEDS NO STARTING LOCATION (FR-4.25).
 *
 * Nothing here reads `start_point`. A guest who declined location can still add
 * a venue, and that is a property of the absence of a query rather than a
 * conditional that a later change could invert.
 */
export async function createProposal(
  caller: Caller,
  eventId: string,
  input: ProposalCreateInput,
): Promise<{ proposal: Proposal; isLate: boolean }> {
  const isLate = await votingHasBegun(eventId);

  const created = await withTransaction(async (client) => {
    const proposer = await participantId(caller, eventId, client);
    if (!proposer) return null;

    const venueId = input.venue ? await upsertVenue(client, eventId, input.venue) : null;

    const inserted = await client.query<{ id: string }>(
      `insert into proposal (
         event_id, created_by, type, title, notes, link,
         venue_id, start_utc, end_utc, is_late, origin
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
       returning id`,
      [
        eventId,
        proposer,
        input.type,
        input.title,
        input.notes ?? null,
        input.link ?? null,
        venueId,
        input.start_utc ?? null,
        input.end_utc ?? null,
        isLate,
      ],
    );

    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('proposal insert returned no id');

    return readProposal(client, id);
  });

  if (!created) throw new Error('proposer is not a participant');
  return { proposal: created, isLate };
}

/** Reads one proposal by id, through the shared select. */
async function readProposal(
  query: { query: (text: string, values?: unknown[]) => Promise<{ rows: ProposalRow[] }> },
  proposalId: string,
): Promise<Proposal> {
  const result = await query.query(`${PROPOSAL_SELECT} where pr.id = $1`, [proposalId]);
  const row = result.rows[0];
  if (!row) throw new Error('a proposal that was just written could not be read back');

  return toProposal(row);
}

/**
 * Applies an edit (Task 6).
 *
 * The caller has already checked the guards; this only writes.
 */
export async function editProposal(
  proposalId: string,
  patch: ProposalPatchInput,
): Promise<Proposal> {
  return withTransaction(async (client) => {
    const sets: string[] = [];
    const values: unknown[] = [proposalId];

    const assign = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (patch.title !== undefined) assign('title', patch.title);
    if (patch.notes !== undefined) assign('notes', patch.notes ?? null);
    if (patch.link !== undefined) assign('link', patch.link ?? null);
    if (patch.start_utc !== undefined) assign('start_utc', patch.start_utc ?? null);
    if (patch.end_utc !== undefined) assign('end_utc', patch.end_utc ?? null);

    const updated = await client.query<{ id: string }>(
      `update proposal set ${sets.join(', ')} where id = $1 returning id`,
      values,
    );

    const id = updated.rows[0]?.id;
    if (!id) throw new Error('proposal update matched no row');

    return readProposal(client, id);
  });
}

/**
 * Withdraws a proposal — a status change, never a delete (PRD-02 E4).
 *
 * Idempotent: withdrawing an already-withdrawn proposal is a no-op that still
 * answers with the row, because a double tap is a user, not an error.
 */
export async function withdrawProposal(proposalId: string): Promise<Proposal> {
  return withTransaction(async (client) => {
    await client.query(`update proposal set status = 'WITHDRAWN' where id = $1`, [proposalId]);
    return readProposal(client, proposalId);
  });
}

/** The event's proposals, in creation order (FR-2.4). */
export async function listProposals(eventId: string): Promise<Proposal[]> {
  const result = await scopedQueryable().query<ProposalRow>(
    `${PROPOSAL_SELECT}
     where pr.event_id = $1
     order by pr.created_at asc, pr.id asc
     limit 200`,
    [eventId],
  );

  return result.rows.map(toProposal);
}

/** The hint key for a proposal in `CONFIRMED` state — the edit lock. */
export const CONFIRMED_LOCK_KEY = VALIDATION.lockedConfirmed;
