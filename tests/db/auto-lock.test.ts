/**
 * Auto-lock at the deadline (Plan 14 Task 10, PRD-02 OQ-2.4, E6).
 *
 * ★ THE FIRST SUITE IS THE ONE THE PLAN ASKS FOR: OFF BY DEFAULT.
 *
 * PRD-02 OQ-2.4 is emphatic — "auto-confirming a decision nobody engaged with is
 * a worse outcome than no decision". So the default path must do NOTHING, and
 * "nothing" has to be asserted rather than assumed: the test runs the job with
 * no switch set, against an event whose deadline has passed, and checks that no
 * decision row exists afterwards.
 *
 * ★ AND THE SECOND SUITE PROVES IT CAN WORK, ELSE THE FIRST PASSES ON A JOB THAT
 * NEVER WORKS AT ALL.
 *
 * With the switch on and a leader present, the event confirms and the outcome is
 * reported as `confirmed`. Without a leader, nothing happens and the job says
 * `no_leader` rather than picking arbitrarily (E6).
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import {
  AUTO_LOCK_ENV,
  AUTO_LOCK_MESSAGE_KEY,
  isAutoLockEnabled,
  runAutoLockJob,
} from '../../server/jobs/auto-lock';
import { asOwner, closePool, seedEvent, seedVenue, truncateAll } from './support';
import { prepareServerEnv, prepareServerSql } from './server-support';

/**
 * An environment with the switch absent.
 *
 * Spelled out rather than `{}` because `ProcessEnv` requires `NODE_ENV` in the
 * project's types, and because the point of the value is WHAT IT LACKS.
 */
function emptyEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[AUTO_LOCK_ENV];
  return env;
}

/** Seeds a proposal, so there is something that could lead. */
async function seedProposal(  eventId: string,
  proposerId: string,
  title: string,
  startOffset = "interval '2 days'",
): Promise<string> {
  const venueId = await seedVenue(eventId, { name: `venue-${title}` });

  const row = await asOwner<{ id: string }>(
    `insert into proposal (event_id, created_by, type, title, venue_id, start_utc, end_utc)
     values ($1, $2, 'TIME_AND_PLACE', $3, $4, now() + ${startOffset},
             now() + ${startOffset} + interval '2 hours')
     returning id`,
    [eventId, proposerId, title, venueId],
  );

  return row.rows[0]!.id;
}

/** A vote, so the leader is not chosen from an empty tally. */
async function seedVote(
  proposalId: string,
  participantId: string,
  value: 'yes' | 'maybe' | 'no',
): Promise<void> {
  await asOwner(
    `insert into vote (proposal_id, participant_id, value)
     values ($1, $2, $3)`,
    [proposalId, participantId, value],
  );
}

/** Puts the event into DECIDING with a deadline in the past. */
async function makeDue(eventId: string): Promise<void> {
  await asOwner(
    `update event
        set status = 'DECIDING', voting_deadline = now() - interval '1 hour'
      where id = $1`,
    [eventId],
  );
}

async function decisionCount(eventId: string): Promise<number> {
  const row = await asOwner<{ count: string }>(
    `select count(*)::text as count from decision where event_id = $1`,
    [eventId],
  );

  return Number(row.rows[0]!.count);
}

describe('auto-lock', { concurrency: false }, () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  beforeEach(truncateAll);
  // ★ NO TRAILING TRUNCATE.
  //
  // A second `truncateAll` at the end looks tidy and is harmful: the next file
  // is already running, and wiping the tables underneath it makes an unrelated
  // suite fail on rows that vanished. `beforeEach` gives this suite a clean
  // start, which is all it needs; the next suite does the same for itself.
  after(closePool);


  test('the switch reads off when it is not set', () => {
    assert.equal(isAutoLockEnabled({}), false);
    assert.equal(isAutoLockEnabled({ [AUTO_LOCK_ENV]: undefined }), false);
  });

  test('only an explicit affirmative turns it on', () => {
    for (const value of ['1', 'true', 'yes', 'on', ' TRUE ', 'Yes']) {
      assert.equal(isAutoLockEnabled({ [AUTO_LOCK_ENV]: value }), true, `${value} enables it`);
    }

    for (const value of ['', '0', 'false', 'no', 'off', 'maybe', 'ture']) {
      assert.equal(isAutoLockEnabled({ [AUTO_LOCK_ENV]: value }), false, `${value} leaves it off`);
    }
  });

  test('★ with the switch off, a due event is NOT confirmed', async () => {
    // Arrange — a past deadline and a clear leader: everything needed to
    // auto-confirm, if the job were willing.
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');
    await seedVote(proposalId, organizerParticipantId, 'yes');
    await makeDue(eventId);

    // Act — no switch set.
    const result = await runAutoLockJob(emptyEnv());

    // Assert — ★ THE ASSERTION THE PLAN ASKS FOR.
    assert.equal(result.enabled, false);
    assert.equal(result.events.length, 0, 'the job did not even read the events');
    assert.equal(await decisionCount(eventId), 0, 'no decision was written');

    const event = await asOwner<{ status: string }>(`select status from event where id = $1`, [
      eventId,
    ]);
    assert.equal(event.rows[0]?.status, 'DECIDING', 'the event is untouched');
  });

  test('★ a full run with the default environment writes nothing', async () => {
    // The same case, but through the default `process.env` path rather than an
    // explicit empty object — this is what a scheduled invocation does.
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'رستوران مرکزی');
    await seedVote(proposalId, organizerParticipantId, 'yes');
    await makeDue(eventId);

    const previous = process.env[AUTO_LOCK_ENV];
    delete process.env[AUTO_LOCK_ENV];

    try {
      const result = await runAutoLockJob();

      assert.equal(result.enabled, false);
      assert.equal(await decisionCount(eventId), 0);
    } finally {
      if (previous !== undefined) process.env[AUTO_LOCK_ENV] = previous;
    }
  });
  
  const ON = { [AUTO_LOCK_ENV]: '1' } as unknown as NodeJS.ProcessEnv;

  test('a due event with a leader confirms, and is reported as confirmed', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');
    await seedVote(proposalId, organizerParticipantId, 'yes');
    await makeDue(eventId);

    // Act
    const result = await runAutoLockJob(ON);

    // Assert
    assert.equal(result.enabled, true);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.outcome, 'confirmed');
    assert.equal(await decisionCount(eventId), 1, 'exactly one decision');

    // ★ THE SAME PATH A HUMAN TAKES, so the row is the same shape: the leader
    // became CHOSEN and the decision points at it.
    const chosen = await asOwner<{ status: string }>(
      `select status from proposal where id = $1`,
      [proposalId],
    );
    assert.equal(chosen.rows[0]?.status, 'CHOSEN');

    const decision = await asOwner<{ proposal_id: string; reason_template: string }>(
      `select proposal_id, reason_template from decision where event_id = $1`,
      [eventId],
    );
    assert.equal(decision.rows[0]?.proposal_id, proposalId);
    // A template + params, never a rendered sentence (PRD-05 §11.1).
    assert.equal(typeof decision.rows[0]?.reason_template, 'string');
  });

  test('E6 — no leading option means nothing happens, and it says so', async () => {
    // Arrange — a due event with NO proposals at all.
    const { eventId } = await seedEvent();
    await makeDue(eventId);

    // Act
    const result = await runAutoLockJob(ON);

    // Assert
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.outcome, 'no_leader', 'it does not invent a leader');
    assert.equal(await decisionCount(eventId), 0);
  });

  test('a deadline still ahead is left alone', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');
    await seedVote(proposalId, organizerParticipantId, 'yes');

    await asOwner(
      `update event set status = 'DECIDING', voting_deadline = now() + interval '2 hours'
        where id = $1`,
      [eventId],
    );

    const result = await runAutoLockJob(ON);

    assert.equal(result.events.length, 0, 'not due yet');
    assert.equal(await decisionCount(eventId), 0);
  });

  test('a second run is idempotent: one confirmation, not two', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');
    await seedVote(proposalId, organizerParticipantId, 'yes');
    await makeDue(eventId);

    await runAutoLockJob(ON);

    // ★ THE SECOND RUN MUST NOT FIND THE EVENT AGAIN. It is CONFIRMED with a
    // live decision, so the `dueEvents` predicate excludes it — and if it did
    // not, `confirmDecision` is idempotent anyway. Two layers, both asserted.
    const second = await runAutoLockJob(ON);

    assert.equal(second.events.length, 0, 'the event is no longer due');
    assert.equal(await decisionCount(eventId), 1);
  });

  test('an event with a live decision is skipped', async () => {
    const { eventId, organizerParticipantId } = await seedEvent();
    const proposalId = await seedProposal(eventId, organizerParticipantId, 'کافه دیدار');
    await seedVote(proposalId, organizerParticipantId, 'yes');
    await makeDue(eventId);

    await asOwner(
      `insert into decision (event_id, axis, proposal_id, reason_template, confirmed_by)
       values ($1, 'time', $2, 'balanced_mean', $3)`,
      [eventId, proposalId, organizerParticipantId],
    );

    const result = await runAutoLockJob(ON);

    // The predicate excludes it, so it is not even looked at.
    assert.equal(result.events.length, 0);
    assert.equal(await decisionCount(eventId), 1, 'the human decision stands');
  });

  test('the copy exists in both catalogues, so the card can say it was automatic', async () => {
    const fa: unknown = (await import('../../src/i18n/fa.json')).default;
    const en: unknown = (await import('../../src/i18n/en.json')).default;

    const read = (catalogue: unknown): unknown =>
      AUTO_LOCK_MESSAGE_KEY.split('.').reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? (node as Record<string, unknown>)[part]
            : undefined,
        catalogue,
      );

    assert.equal(typeof read(fa), 'string');
    assert.equal(typeof read(en), 'string');
  });
});