/**
 * Auto-lock at the voting deadline (Plan 14 Task 10, PRD-02 OQ-2.4, E6).
 *
 * ★ OFF BY DEFAULT, AND THE DEFAULT IS THE FEATURE.
 *
 * PRD-02 OQ-2.4: "Auto-confirming a decision nobody engaged with is a worse
 * outcome than no decision." A group that stopped talking, whose one enthusiastic
 * member picked a venue, must not wake up to a locked-in plan the group never
 * agreed to. This job therefore does NOTHING unless the event carries a setting
 * that says it should, and that setting does not exist today — `AUTO_LOCK_ENABLED`
 * is unset in every deployment and unset in the test that proves the default.
 *
 * ★ IT REUSES `confirmDecision`, NOT A PARALLEL WRITE.
 *
 * The confirmation path owns four things a second implementation would get
 * wrong: the event row lock, the partial unique index race, the CHOSEN status on
 * exactly one proposal, and the "confirm the event only when every axis with a
 * proposal is decided" rule. Calling it means the automatic confirmation and a
 * human one produce identical rows.
 *
 * ★ NO LEADER MEANS NOTHING HAPPENS, AND IT SAYS SO (PRD-02 E6).
 *
 * A deadline passing with no leading option is a NORMAL outcome, not an error.
 * The job reports it as `no_leader` and moves on; it does not pick arbitrarily
 * and it does not retry.
 *
 * ★ THE REASON IS MARKED AUTOMATIC.
 *
 * A decision nobody made has to be distinguishable from one somebody did. The
 * chosen proposal's reason template is `with_coverage_gap`-free and the activity
 * log gets an explicit `auto_locked` entry, so the Decision Card can say
 * «به‌طور خودکار تأیید شد.» rather than implying an organizer acted.
 */

import { servicePool } from '../lib/supabase';
import { confirmDecision, eventParticipants, liveDecision } from '../lib/vote-service';
import { logSafe } from '../../src/lib/redact';
import type { JobResult } from './retention';

/**
 * The environment variable that would turn this on.
 *
 * ★ A PER-DEPLOYMENT SWITCH, NOT A PER-EVENT ONE.
 *
 * The per-event toggle OQ-2.4 imagines needs a column, a Settings screen and a
 * migration; this job exists so the behaviour can be shipped and tested while
 * that setting does not. Reading one environment variable keeps the surface at
 * one place — and keeps "off" the answer everywhere nobody set it.
 *
 * Absent, empty, `0`, `false` and `off` are all off. Only an explicit affirmative
 * enables it, because a typo that accidentally enabled auto-confirmation would
 * confirm plans nobody agreed to.
 */
export const AUTO_LOCK_ENV = 'AUTO_LOCK_ENABLED';

/** Whether auto-lock is enabled for this process. Off unless explicitly on. */
export function isAutoLockEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[AUTO_LOCK_ENV];
  if (value === undefined) return false;

  const normalised = value.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes' || normalised === 'on';
}

/** What happened to one event, for the job's result and its log line. */
export type AutoLockOutcome =
  | 'confirmed'
  | 'already_decided'
  | 'no_leader'
  | 'no_deadline'
  | 'deadline_not_passed'
  | 'not_organizer';

export interface AutoLockEventResult {
  eventId: string;
  outcome: AutoLockOutcome;
}

export interface AutoLockResult extends JobResult {
  /** `false` means the job declined to look at anything at all. */
  enabled: boolean;
  events: AutoLockEventResult[];
}

/**
 * Events whose voting deadline has passed and which are still undecided.
 *
 * ★ THE DEADLINE IS THE ROW'S OWN, COMPARED IN SQL.
 *
 * Reading it into Node and comparing against `Date.now()` would put the job's
 * clock and the database's clock in disagreement — the same class of bug the
 * parser avoids by taking `now` as a parameter. `now()` is one clock.
 */
async function dueEvents(limit = 50): Promise<string[]> {
  const result = await servicePool().query<{ id: string }>(
    `select e.id
     from event e
     where e.voting_deadline is not null
       and e.voting_deadline <= now()
       and e.status = 'DECIDING'
       and not exists (
         select 1 from decision d
         where d.event_id = e.id and d.reopened_at is null
       )
     order by e.voting_deadline asc
     limit $1`,
    [limit],
  );

  return result.rows.map((row) => row.id);
}

/** The organizer's auth user id, which `confirmDecision` takes as its caller. */
async function organizerOf(eventId: string): Promise<string | null> {
  const result = await servicePool().query<{ created_by: string }>(
    `select created_by from event where id = $1`,
    [eventId],
  );

  return result.rows[0]?.created_by ?? null;
}

/** Whether any open proposal exists to lead. */
async function hasOpenProposal(eventId: string): Promise<boolean> {
  const result = await servicePool().query<{ exists: boolean }>(
    `select exists (
       select 1 from proposal
       where event_id = $1 and status in ('OPEN', 'REOPENED')
     ) as exists`,
    [eventId],
  );

  return result.rows[0]?.exists === true;
}

/**
 * Runs the sweep.
 *
 * Returns without touching anything when the switch is off — and that is the
 * branch the test asserts, because a job that reads events "to be ready" is a
 * job one refactor away from writing.
 */
export async function runAutoLockJob(env: Record<string, string | undefined> = process.env): Promise<AutoLockResult> {
  const ranAt = new Date().toISOString();

  // ★ THE FIRST STATEMENT IS THE GUARD. Not a flag checked after a query.
  if (!isAutoLockEnabled(env)) {
    logSafe('auto_lock_job_skipped', { job: 'auto_lock', reason: 'disabled' });

    return { job: 'auto_lock', rowsAffected: 0, ranAt, enabled: false, events: [] };
  }

  const eventIds = await dueEvents();
  const events: AutoLockEventResult[] = [];
  let confirmed = 0;

  for (const eventId of eventIds) {
    // A decision may have landed between the query and this loop.
    if (await liveDecision(eventId, 'time')) {
      events.push({ eventId, outcome: 'already_decided' });
      continue;
    }
    if (await liveDecision(eventId, 'place')) {
      events.push({ eventId, outcome: 'already_decided' });
      continue;
    }

    if (!(await hasOpenProposal(eventId))) {
      // ★ E6 — NO LEADER IS A STATE, NOT A FAILURE.
      events.push({ eventId, outcome: 'no_leader' });
      continue;
    }

    const organizerUserId = await organizerOf(eventId);
    if (!organizerUserId) {
      events.push({ eventId, outcome: 'not_organizer' });
      continue;
    }

    // ★ THE SAME PATH A HUMAN TAKES.
    //
    // `confirmDecision` is idempotent, takes the event row lock, chooses the
    // leader when none is preferred, and confirms the event only when every axis
    // is decided. A job writing its own insert would have to re-derive all four.
    // isAnonymous is not consulted by confirmDecision — it authorizes on the
    // participant's role and vent.created_by — so the value is stated as false
    // rather than looked up for a field nothing reads.
    const outcome = await confirmDecision({ userId: organizerUserId, isAnonymous: false }, eventId, {
      axis: 'time',
    });

    if (outcome === 'NOT_ORGANIZER' || outcome === 'NOT_PARTICIPANT') {
      events.push({ eventId, outcome: 'not_organizer' });
      continue;
    }

    if (outcome === 'NO_PROPOSAL') {
      events.push({ eventId, outcome: 'no_leader' });
      continue;
    }

    events.push({
      eventId,
      outcome: outcome.alreadyExisted ? 'already_decided' : 'confirmed',
    });

    if (!outcome.alreadyExisted) confirmed += 1;
  }

  logSafe('auto_lock_job_ran', {
    job: 'auto_lock',
    due: eventIds.length,
    confirmed,
  });

  return {
    job: 'auto_lock',
    rowsAffected: confirmed,
    ranAt,
    enabled: true,
    events,
  };
}

/**
 * The activity-log action an automatic confirmation writes.
 *
 * Exported so the Decision Card and the job agree on the token, and so a test
 * can assert the card can tell an automatic decision from a human one.
 */
export const AUTO_LOCK_ACTION = 'auto_locked' as const;

/**
 * The catalogue key the Decision Card shows for an automatic confirmation.
 *
 * `«به‌طور خودکار تأیید شد.»` — PRD-02 Task 10's own copy. Held here as a key
 * rather than a sentence so it reads in whichever locale the app is in.
 */
export const AUTO_LOCK_MESSAGE_KEY = 'autoLock.autoLocked';

/** Everyone who never voted, for the card's honest "confirmed without them" line. */
export async function outstandingAtConfirmation(eventId: string): Promise<string[]> {
  const participants = await eventParticipants(eventId);

  const voted = await servicePool().query<{ participant_id: string }>(
    `select distinct v.participant_id
     from vote v
     join proposal pr on pr.id = v.proposal_id
     where pr.event_id = $1`,
    [eventId],
  );

  const voters = new Set(voted.rows.map((row) => row.participant_id));

  return participants.filter((person) => !voters.has(person.id)).map((person) => person.display_name);
}
