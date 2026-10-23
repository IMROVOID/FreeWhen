/**
 * The vote, decision-status and confirmation read/write layer
 * (Plan 07 Tasks 2, 8, 11).
 *
 * ★ THE VOTE WRITE IS A SINGLE UPSERT AND NOTHING ELSE (PRD-02 §13.3).
 *
 * `insert ... on conflict (proposal_id, participant_id) do update` compiles to
 * one statement, so two changes from the same participant cannot both read the
 * old value and both write: the second waits on the row lock and updates the
 * first's result. A read-then-write would let two concurrent changes race, and
 * the tally would then be wrong with no error anywhere — the worst kind of bug,
 * because it looks like a user who changed their mind.
 *
 * ★ `LEADING` IS NOT WRITTEN BY ANY STATEMENT IN THIS FILE.
 *
 * Only lifecycle states persist: `OPEN | CHOSEN | REOPENED | WITHDRAWN`. The
 * leader is derived per render from votes and the engine (§3.1).
 *
 * ★ THE CONFIRMATION STORES A REASON TEMPLATE, NEVER A SENTENCE.
 *
 * `reason_template` + `reason_params` are written so the Decision Card renders
 * in whichever language the reader chose (PRD-05 §11.1, PRD-10 D11A). A stored
 * sentence would freeze Persian prose and Persian digits at confirmation time
 * and the card could never be shown in English.
 */

import { leadingProposal, tally } from '@/src/features/voting/services/tally';
import type { Reason } from '@/src/engine/types';
import type {
  ActivityEntry,
  DecisionAxis,
  Tally,
  Vote,
  VoteValue,
} from '@/src/types/vote';
import type { Proposal } from '@/src/types/proposal';

import { PROPOSAL_COLUMNS, PROPOSAL_FROM, iso, toProposal, type ProposalRow } from './proposal-row';
import { servicePool, withTransaction, type Caller, type Queryable } from './supabase';

/** A participant in the event, as the tally needs them. */
export interface EventParticipant {
  id: string;
  display_name: string;
  role: string;
}

/** The event facts a vote or a confirmation needs. */
export interface EventContext {
  id: string;
  status: string;
  home_tz: string;
  date_window_start: Date;
  date_window_end: Date;
  voting_deadline: Date | null;
}

/**
 * The event, when the caller participates in it.
 *
 * One access check for every route in this phase, so no endpoint can answer a
 * different question than its siblings — and a stranger and a nonexistent event
 * are indistinguishable, which is what stops an id being enumerable.
 */
export async function eventForParticipant(
  caller: Caller,
  eventId: string,
): Promise<EventContext | null> {
  const result = await servicePool().query<EventContext>(
    `select e.id, e.status, e.home_tz, e.date_window_start, e.date_window_end, e.voting_deadline
     from event e
     join participant me on me.event_id = e.id and me.auth_user_id = $2
     where e.id = $1`,
    [eventId, caller.userId],
  );

  return result.rows[0] ?? null;
}

/** The caller's participant row in an event. */
export async function participantIn(
  eventId: string,
  caller: Caller,
  query: Queryable = servicePool(),
): Promise<EventParticipant | null> {
  const result = await query.query<EventParticipant>(
    `select id, display_name, role
     from participant
     where event_id = $1 and auth_user_id = $2`,
    [eventId, caller.userId],
  );

  return result.rows[0] ?? null;
}

/** Everyone eligible to vote in an event, in join order. */
export async function eventParticipants(eventId: string): Promise<EventParticipant[]> {
  const result = await servicePool().query<EventParticipant>(
    `select id, display_name, role
     from participant
     where event_id = $1
     order by joined_at asc, id asc`,
    [eventId],
  );

  return result.rows;
}

/** Every vote in an event, across all of its proposals. */
async function eventVotes(eventId: string): Promise<Vote[]> {
  const result = await servicePool().query<{
    proposal_id: string;
    participant_id: string;
    display_name: string;
    value: VoteValue;
    is_dealbreaker: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `select v.proposal_id, v.participant_id, p.display_name, v.value,
            v.is_dealbreaker, v.created_at, v.updated_at
     from vote v
     join proposal pr on pr.id = v.proposal_id
     join participant p on p.id = v.participant_id
     where pr.event_id = $1
     order by p.joined_at asc, v.created_at asc`,
    [eventId],
  );

  return result.rows.map((row) => ({
    proposal_id: row.proposal_id,
    participant_id: row.participant_id,
    display_name: row.display_name,
    value: row.value,
    is_dealbreaker: row.is_dealbreaker,
    created_at: iso(row.created_at) ?? '',
    updated_at: iso(row.updated_at) ?? '',
  }));
}

/** The result of a vote write, for the route's response and its analytics. */
export interface CastVoteResult {
  vote: Vote;
  /** The value before this write, or `null` for a first vote. */
  previous: VoteValue | null;
  /** Whether this write changed an existing vote. */
  isChange: boolean;
}

/**
 * Records or changes one participant's vote (Task 2).
 *
 * ★ ONE STATEMENT. NEVER READ-THEN-WRITE.
 *
 * The `previous` value is read INSIDE the same transaction, after the upsert
 * has taken the row lock, so the activity log's `from`/`to` pair is the true
 * transition rather than whatever was there when the request arrived. This is
 * why the read is not a separate function the route could forget to call.
 */
export async function castVote(
  caller: Caller,
  proposalId: string,
  value: VoteValue,
  isDealbreaker = false,
): Promise<CastVoteResult | null> {
  return withTransaction(async (client) => {
    const proposal = await client.query<{ event_id: string; status: string; event_status: string }>(
      `select pr.event_id, pr.status, e.status as event_status
       from proposal pr
       join event e on e.id = pr.event_id
       where pr.id = $1`,
      [proposalId],
    );

    const found = proposal.rows[0];
    if (!found) return null;

    const voter = await participantIn(found.event_id, caller, client);
    if (!voter) return null;

    const previousResult = await client.query<{ value: VoteValue }>(
      `select value from vote where proposal_id = $1 and participant_id = $2`,
      [proposalId, voter.id],
    );
    const previous = previousResult.rows[0]?.value ?? null;

    const written = await client.query<{ updated_at: Date }>(
      `insert into vote (proposal_id, participant_id, value, is_dealbreaker)
       values ($1, $2, $3, $4)
       on conflict (proposal_id, participant_id)
       do update set value = excluded.value,
                     is_dealbreaker = excluded.is_dealbreaker,
                     updated_at = now()
       returning updated_at`,
      [proposalId, voter.id, value, isDealbreaker],
    );

    const vote: Vote = {
      proposal_id: proposalId,
      participant_id: voter.id,
      display_name: voter.display_name,
      value,
      is_dealbreaker: isDealbreaker,
      created_at: iso(written.rows[0]?.updated_at ?? new Date()) ?? '',
      updated_at: iso(written.rows[0]?.updated_at ?? new Date()) ?? '',
    };

    const isChange = previous !== null && previous !== value;

    // ★ THE LOG RECORDS A CHANGE, NOT A REPEAT.
    //
    // Re-tapping the value already selected is a no-op the user does not need
    // to see in the history, and logging it would bury the real changes under
    // a stream of taps. A first vote IS logged — it is the fact that matters
    // most ("who has answered"). Only NO COORDINATES, only enum tokens.
    if (previous === null) {
      await appendActivity(client, {
        eventId: found.event_id,
        actorId: voter.id,
        action: 'vote_cast',
        subjectType: 'proposal',
        subjectId: proposalId,
        detail: { to: value },
      });
    } else if (isChange) {
      await appendActivity(client, {
        eventId: found.event_id,
        actorId: voter.id,
        action: 'vote_changed',
        subjectType: 'proposal',
        subjectId: proposalId,
        detail: { from: previous, to: value },
      });
    }

    return { vote, previous, isChange };
  });
}

/** The proposal's status and event, for the vote route's guards. */
export async function proposalGuard(
  proposalId: string,
): Promise<{ eventId: string; status: string; eventStatus: string } | null> {
  const result = await servicePool().query<{
    event_id: string;
    status: string;
    event_status: string;
  }>(
    `select pr.event_id, pr.status, e.status as event_status
     from proposal pr
     join event e on e.id = pr.event_id
     where pr.id = $1`,
    [proposalId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return { eventId: row.event_id, status: row.status, eventStatus: row.event_status };
}

/**
 * Appends one activity row.
 *
 * ★ APPEND-ONLY, AND THE `detail` HOLDS TOKENS AND NUMBERS (§13, FR-8.44).
 *
 * A coordinate here would be a leak with an audit trail, and a rendered
 * sentence would be permanently in one language. Callers pass
 * `{"from":"maybe","to":"yes"}`, never prose.
 */
export async function appendActivity(
  query: Queryable,
  entry: {
    eventId: string;
    actorId: string | null;
    action: ActivityEntry['action'];
    subjectType: string | null;
    subjectId: string | null;
    detail: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await query.query(
    `insert into activity_log (event_id, actor_id, action, subject_type, subject_id, detail)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      entry.eventId,
      entry.actorId,
      entry.action,
      entry.subjectType,
      entry.subjectId,
      JSON.stringify(entry.detail),
    ],
  );
}

/** The event's activity, newest first. */
export async function listActivity(eventId: string, limit = 100): Promise<ActivityEntry[]> {
  const result = await servicePool().query<{
    id: string;
    action: ActivityEntry['action'];
    actor_name: string | null;
    subject_type: string | null;
    subject_id: string | null;
    detail: Record<string, string | number | boolean | null> | null;
    created_at: Date;
  }>(
    `select a.id::text as id, a.action, p.display_name as actor_name,
            a.subject_type, a.subject_id, a.detail, a.created_at
     from activity_log a
     left join participant p on p.id = a.actor_id
     where a.event_id = $1
     order by a.created_at desc, a.id desc
     limit $2`,
    [eventId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor_name: row.actor_name,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    detail: row.detail ?? {},
    created_at: iso(row.created_at) ?? '',
  }));
}

/** The caller's own votes in an event, keyed by proposal id. */
async function myVotes(eventId: string, participantId: string): Promise<Record<string, VoteValue>> {
  const result = await servicePool().query<{ proposal_id: string; value: VoteValue }>(
    `select v.proposal_id, v.value
     from vote v
     join proposal pr on pr.id = v.proposal_id
     where pr.event_id = $1 and v.participant_id = $2`,
    [eventId, participantId],
  );

  const out: Record<string, VoteValue> = {};
  for (const row of result.rows) out[row.proposal_id] = row.value;
  return out;
}

/**
 * The proposal ids the caller has vetoed, in an event (PRD-02 FR-2.17).
 *
 * ★ A SUBSET OF `myVotes`, NOT A REPLACEMENT FOR IT.
 *
 * The dealbreaker flag rides alongside the vote value rather than replacing the
 * `myVotes` shape, because the two answer different questions: which button is
 * filled in, and whether that button carries a veto. A client that only had the
 * veto list could not draw the selected vote, and one that only had `myVotes`
 * could not draw the veto — so both travel.
 *
 * Only `no` votes can be dealbreakers. The database does not enforce that
 * pairing (a value change and a stale flag are two columns), so it is read back
 * as-is and the UI is the thing that keeps them consistent.
 */
async function myDealbreakers(eventId: string, participantId: string): Promise<string[]> {
  const result = await servicePool().query<{ proposal_id: string }>(
    `select v.proposal_id
     from vote v
     join proposal pr on pr.id = v.proposal_id
     where pr.event_id = $1 and v.participant_id = $2 and v.is_dealbreaker
     order by pr.created_at asc, pr.id asc`,
    [eventId, participantId],
  );

  return result.rows.map((row) => row.proposal_id);
}

/** The live decision row for an axis, or `null`. */
export interface DecisionRow {
  id: string;
  event_id: string;
  axis: DecisionAxis;
  proposal_id: string | null;
  lens: string;
  reason_template: string;
  reason_params: Record<string, unknown>;
  confirmed_by: string | null;
  confirmed_at: Date;
}

export async function liveDecision(
  eventId: string,
  axis: DecisionAxis,
): Promise<DecisionRow | null> {
  const result = await servicePool().query<DecisionRow>(
    `select id, event_id, axis, proposal_id, lens, reason_template, reason_params,
            confirmed_by, confirmed_at
     from decision
     where event_id = $1 and axis = $2 and reopened_at is null
     limit 1`,
    [eventId, axis],
  );

  return result.rows[0] ?? null;
}

/** The event's proposals, in creation order (FR-2.4). */
export async function eventProposals(eventId: string): Promise<Proposal[]> {
  const result = await servicePool().query<ProposalRow>(
    `select ${PROPOSAL_COLUMNS}
     ${PROPOSAL_FROM}
     where pr.event_id = $1
     order by pr.created_at asc, pr.id asc
     limit 200`,
    [eventId],
  );

  return result.rows.map(toProposal);
}

/** One proposal, or `null`. */
export async function proposalById(proposalId: string): Promise<Proposal | null> {
  const result = await servicePool().query<ProposalRow>(
    `select ${PROPOSAL_COLUMNS} ${PROPOSAL_FROM} where pr.id = $1`,
    [proposalId],
  );

  const row = result.rows[0];
  return row ? toProposal(row) : null;
}

/**
 * The tallies for every open proposal in an event, plus the caller's votes.
 *
 * The Decision Status area needs all of this in one payload: a screen that
 * fetched the tally per card would issue one request per proposal on every
 * 10-second poll.
 */
export interface DecisionStatusPayload {
  proposals: Array<{
    proposal: Proposal;
    tally: Tally;
  }>;
  /** All participants, so the outstanding list can name people on a card. */
  participants: EventParticipant[];
  /** The caller's votes, keyed by proposal id. */
  myVotes: Record<string, VoteValue>;
  /**
   * The proposal ids the caller has vetoed (FR-2.17).
   *
   * A dealbreaker is a hard `no`, so this is always a subset of the ids in
   * `myVotes`. It is a list rather than a flag per entry so the client can ask
   * "have I vetoed this?" without walking the vote map.
   */
  myDealbreakers: string[];
  /** The caller's participant row. */
  me: EventParticipant;
  /** The live decisions, keyed by axis. */
  decisions: Partial<Record<DecisionAxis, DecisionRow>>;
  event: {
    id: string;
    status: string;
    home_tz: string;
    voting_deadline: string | null;
  };
}

export async function loadDecisionStatus(
  caller: Caller,
  eventId: string,
): Promise<DecisionStatusPayload | null> {
  const event = await eventForParticipant(caller, eventId);
  if (!event) return null;

  const me = await participantIn(eventId, caller);
  if (!me) return null;

  const [participants, votes, proposals, myOwnVotes, myOwnDealbreakers] = await Promise.all([
    eventParticipants(eventId),
    eventVotes(eventId),
    eventProposals(eventId),
    myVotes(eventId, me.id),
    myDealbreakers(eventId, me.id),
  ]);

  const [timeDecision, placeDecision] = await Promise.all([
    liveDecision(eventId, 'time'),
    liveDecision(eventId, 'place'),
  ]);

  const decisions: Partial<Record<DecisionAxis, DecisionRow>> = {};
  if (timeDecision) decisions.time = timeDecision;
  if (placeDecision) decisions.place = placeDecision;

  return {
    proposals: proposals.map((proposal) => ({
      proposal,
      tally: tally(
        votes.filter((vote) => vote.proposal_id === proposal.id),
        participants,
        proposal,
      ),
    })),
    participants,
    myVotes: myOwnVotes,
    myDealbreakers: myOwnDealbreakers,
    me,
    decisions,
    event: {
      id: event.id,
      status: event.status,
      home_tz: event.home_tz,
      voting_deadline: iso(event.voting_deadline),
    },
  };
}

/**
 * Confirms one axis of a decision (Task 8).
 *
 * ★ IDEMPOTENT (E1, §13.7).
 *
 * A second confirm returns the EXISTING decision rather than an error. Two taps
 * on a slow connection are one confirmation, and answering the second with a
 * conflict would show the organizer a failure for an action that succeeded.
 *
 * ★ THE REASON IS STORED AS A TEMPLATE + PARAMS.
 *
 * `reason_template` / `reason_params` are what the Decision Card renders per
 * locale. Storage of a rendered sentence would make the card permanently
 * single-language (PRD-05 §11.1).
 */
export interface ConfirmResult {
  decision: DecisionRow;
  /** True when this call returned an already-existing decision. */
  alreadyExisted: boolean;
  /** The participants who had not voted at confirmation time. */
  outstanding: string[];
  /** The number of votes cast on the chosen proposal at confirmation time. */
  votesTotal: number;
}

export async function confirmDecision(
  caller: Caller,
  eventId: string,
  input: {
    axis: DecisionAxis;
    preferredProposalId?: string | null;
    lens?: string;
    reason?: Reason | null;
  },
): Promise<ConfirmResult | 'NOT_ORGANIZER' | 'NO_PROPOSAL' | 'NOT_PARTICIPANT'> {
  return withTransaction(async (client) => {
    // The event row is locked for the length of the confirmation, so two
    // simultaneous confirms cannot both find no live decision and both insert.
    // The partial unique index is the guarantee; this is what turns a lost race
    // into a wait rather than a 23505 the organizer would see as a failure.
    const locked = await client.query<{ id: string; status: string; created_by: string }>(
      `select id, status, created_by from event where id = $1 for update`,
      [eventId],
    );

    const event = locked.rows[0];
    if (!event) return 'NOT_PARTICIPANT' as const;

    const me = await participantIn(eventId, caller, client);
    if (!me) return 'NOT_PARTICIPANT' as const;

    // Enforced by RLS as well (Phase 2 AC-9.4.1) and re-checked here: a route
    // that trusted only the policy would report a database error rather than
    // NOT_ORGANIZER, and the screen could not say which.
    if (me.role !== 'organizer' || event.created_by !== caller.userId) {
      return 'NOT_ORGANIZER' as const;
    }

    const existing = await client.query<DecisionRow>(
      `select id, event_id, axis, proposal_id, lens, reason_template, reason_params,
              confirmed_by, confirmed_at
       from decision
       where event_id = $1 and axis = $2 and reopened_at is null
       limit 1`,
      [eventId, input.axis],
    );

    const participants = await eventParticipants(eventId);
    const votes = await eventVotes(eventId);

    if (existing.rows[0]) {
      const decision = existing.rows[0];
      const chosenVotes = votes.filter((vote) => vote.proposal_id === decision.proposal_id);

      return {
        decision,
        alreadyExisted: true,
        outstanding: absentVoters(participants, votes, decision.proposal_id),
        votesTotal: chosenVotes.length,
      } satisfies ConfirmResult;
    }

    const proposals = await eventProposals(eventId);
    const open = proposals.filter((p) => p.status === 'OPEN' || p.status === 'REOPENED');
    if (open.length === 0) return 'NO_PROPOSAL' as const;

    // ★ THE ORGANIZER'S CHOICE WINS, AND ITS ABSENCE MEANS THE LEADER.
    //
    // Without a preferred proposal the confirmation must pick the same winner
    // every participant sees, which is the engine's ranking — hence the
    // creation-order tiebreak in `leadingProposal` (AC-2.4.1).
    const preferred = input.preferredProposalId
      ? (open.find((p) => p.id === input.preferredProposalId) ?? null)
      : null;

    const chosen =
      preferred ??
      leadingProposal(
        open,
        null,
        (proposal) => proposal.venue?.id ?? null,
      );

    if (!chosen) return 'NO_PROPOSAL' as const;

    const reason = input.reason ?? fallbackReason();

    const inserted = await client.query<DecisionRow>(
      `insert into decision (
         event_id, axis, proposal_id, lens, reason_template, reason_params, confirmed_by
       ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
       returning id, event_id, axis, proposal_id, lens, reason_template, reason_params,
                 confirmed_by, confirmed_at`,
      [
        eventId,
        input.axis,
        chosen.id,
        input.lens ?? 'balanced',
        reason.templateId,
        JSON.stringify(reason.params ?? {}),
        me.id,
      ],
    );

    const decision = inserted.rows[0];
    if (!decision) throw new Error('decision insert returned no row');

    // The chosen proposal becomes CHOSEN; the rest stay OPEN so a reopening
    // has something to reopen to.
    await client.query(`update proposal set status = 'CHOSEN' where id = $1`, [chosen.id]);

    // ★ THE EVENT IS CONFIRMED ONLY WHEN EVERY AXIS IT HAS A PROPOSAL FOR IS
    // DECIDED.
    //
    // Confirming the time must not declare the place decided. The check is
    // against the DECISION table, not against open proposals: setting the
    // chosen proposal to CHOSEN would otherwise make "no open proposals" true
    // immediately and confirm the event on the first of its two axes — the
    // exact bug this test exists to catch.
    await client.query(
      `update event e
          set status = 'CONFIRMED', updated_at = now()
        where e.id = $1
          and e.status <> 'CONFIRMED'
          and not exists (
            select 1
              from proposal p
             where p.event_id = e.id
               and p.status in ('OPEN','REOPENED')
               and not exists (
                 select 1 from decision d
                  where d.event_id = e.id
                    and d.proposal_id = p.id
                    and d.reopened_at is null
               )
          )`,
      [eventId],
    );

    const outstanding = absentVoters(participants, votes, chosen.id);

    await appendActivity(client, {
      eventId,
      actorId: me.id,
      action: 'confirmed',
      subjectType: 'proposal',
      subjectId: chosen.id,
      // The numbers the user test measures "time to decision" and "who
      // blocked convergence" with (PRD-02 §9).
      detail: {
        axis: input.axis,
        outstanding_voters: outstanding.length,
        votes_total: votes.filter((vote) => vote.proposal_id === chosen.id).length,
        warned_outstanding: input.lens !== undefined || outstanding.length > 0,
      },
    });

    return {
      decision,
      alreadyExisted: false,
      outstanding,
      votesTotal: votes.filter((vote) => vote.proposal_id === chosen.id).length,
    } satisfies ConfirmResult;
  });
}

/** The participants with no vote on the given proposal. NOT dissent. */
function absentVoters(
  participants: EventParticipant[],
  votes: Vote[],
  proposalId: string | null,
): string[] {
  if (!proposalId) return participants.map((p) => p.display_name);

  const voted = new Set(
    votes.filter((vote) => vote.proposal_id === proposalId).map((vote) => vote.participant_id),
  );

  return participants.filter((p) => !voted.has(p.id)).map((p) => p.display_name);
}

/**
 * The reason to store when the organizer confirms without the engine's output.
 *
 * ★ A TEMPLATE THAT CLAIMS NOTHING THE ENGINE DID NOT SAY.
 *
 * The engine's own reason is used when the ranking is available (the client
 * sends it). When it is not, the honest line is `balanced_mean`, which says the
 * group is close and nobody travels far — rather than inventing a floor number
 * nobody measured.
 */
function fallbackReason(): Reason {
  return { templateId: 'balanced_mean', params: {} };
}
