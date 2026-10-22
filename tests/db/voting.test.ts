/**
 * Voting, the tally, confirmation and the activity log (Plan 07 Tasks 1, 2, 8, 11).
 *
 * ★ THESE TESTS DRIVE THE REAL ROUTES.
 *
 * `call()` reaches `handleRequest`, so the routing, the Zod validation, the SQL
 * and the error envelopes exercised here are the ones that ship. A hand-written
 * client against a mock would pass while the server was broken.
 *
 * ★ THE TALLY ASSERTIONS ARE THE POINT OF THE FILE.
 *
 * AC-2.1.2 — "unanswered is not a no" — is the single most likely logic bug in
 * the product (PRD-02 §13.2), because it is silent: three votes from five people
 * read as unanimous rejection and the group drops an option nobody opposed.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  addMember,
  asOwner,
  closePool,
  seedEvent,
  seedVenue,
  truncateAll,
} from './support';
import { call, bodyOf, prepareServerEnv, prepareServerSql } from './server-support';

interface ProposalBody {
  proposal: { id: string; title: string; status: string };
}

interface StatusBody {
  event: { id: string; status: string; voting_deadline: string | null };
  proposals: Array<{
    proposal: { id: string; status: string; title: string };
    tally: {
      yes: number;
      maybe: number;
      no: number;
      unanswered: number;
      total: number;
      voters: { yes: string[]; maybe: string[]; no: string[] };
      outstanding: string[];
    };
  }>;
  participants: Array<{ id: string; display_name: string }>;
  myVotes: Record<string, 'yes' | 'maybe' | 'no'>;
  me: { id: string; display_name: string };
  decisions: Record<string, unknown>;
}

interface ConfirmBody {
  decision: {
    id: string;
    axis: string;
    proposal_id: string | null;
    lens: string;
    reason_template: string;
    reason_params: Record<string, unknown>;
  } | null;
  outstanding: string[];
  already_confirmed: boolean;
}

interface ActivityBody {
  activity: Array<{
    id: string;
    action: string;
    actor_name: string | null;
    detail: Record<string, unknown>;
  }>;
}

/**
 * A slot that passes the Phase 6 validator.
 *
 * `validateSlot` requires the start to sit on the 30-minute grid and inside the
 * event window (Plan 06). Rounding up to the next half hour from "tomorrow at
 * 18:00 Tehran" keeps every fixture legal without each test restating the rule.
 */
function legalSlot(daysAhead = 1, hour = 18): string {
  const slot = new Date(Date.now() + daysAhead * 86_400_000);
  slot.setUTCHours(hour, 0, 0, 0);
  return slot.toISOString();
}

/** Creates a time proposal through the API, as an organizer would. */
async function createTimeProposal(
  eventId: string,
  userId: string,
  title: string,
  startUtc: string,
): Promise<string> {
  const response = await call(`/api/events/${eventId}/proposals`, {
    method: 'POST',
    userId,
    body: {
      type: 'TIME',
      title,
      start_utc: startUtc,
      end_utc: new Date(Date.parse(startUtc) + 7_200_000).toISOString(),
    },
  });

  assert.equal(response.status, 201, 'proposal creation was refused');

  const body = await bodyOf<ProposalBody>(response);
  return body.proposal.id;
}

/** Casts a vote and asserts it was accepted. */
async function vote(
  proposalId: string,
  userId: string,
  value: 'yes' | 'maybe' | 'no',
): Promise<Response> {
  return call(`/api/proposals/${proposalId}/vote`, {
    method: 'PUT',
    userId,
    body: { value },
  });
}

async function statusOf(eventId: string, userId: string): Promise<StatusBody> {
  const response = await call(`/api/events/${eventId}/decision-status`, { userId });
  assert.equal(response.status, 200, 'decision status was refused');
  return bodyOf<StatusBody>(response);
}

function tallyFor(body: StatusBody, proposalId: string) {
  const entry = body.proposals.find((item) => item.proposal.id === proposalId);
  assert.ok(entry, 'the proposal is missing from the decision status payload');
  return entry;
}

before(async () => {
  prepareServerEnv();
  await prepareServerSql();
  await truncateAll();
});

beforeEach(async () => {
  await truncateAll();
});

after(async () => {
  await closePool();
});

describe('voting (P07)', () => {
  test('AC-2.1.1: a participant with no location votes successfully', async () => {
    // Arrange — nobody has a start_point anywhere in this fixture.
    const { eventId, organizerId, organizerParticipantId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    // Act
    const response = await vote(proposalId, member.userId, 'yes');

    // Assert
    assert.equal(response.status, 200);

    const body = await statusOf(eventId, organizerId);
    const entry = tallyFor(body, proposalId);
    assert.equal(entry.tally.yes, 1);
    assert.deepEqual(entry.tally.voters.yes, ['Bahar']);

    // The row exists with no location data anywhere: the absence of a
    // `start_point` query is what makes this pass, not a conditional.
    const startPoints = await asOwner<{ n: number }>(
      `select count(*)::int as n from start_point where participant_id = $1`,
      [organizerParticipantId],
    );
    assert.equal(startPoints.rows[0]?.n, 0);
  });

  test('AC-2.1.2: unanswered participants are not counted as "no"', async () => {
    // Arrange — five participants, three votes.
    const { eventId, organizerId } = await seedEvent();
    const second = await addMember(eventId, { displayName: 'Bahar' });
    const third = await addMember(eventId, { displayName: 'Syrus' });
    const fourth = await addMember(eventId, { displayName: 'Darya' });
    const fifth = await addMember(eventId, { displayName: 'Ali' });

    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    await vote(proposalId, organizerId, 'yes');
    await vote(proposalId, second.userId, 'maybe');
    await vote(proposalId, third.userId, 'no');

    // Act
    const body = await statusOf(eventId, organizerId);
    const { tally } = tallyFor(body, proposalId);

    // Assert
    assert.equal(tally.yes + tally.maybe + tally.no, 3);
    assert.equal(tally.unanswered, 2);
    assert.equal(tally.total, 5);
    assert.deepEqual(tally.outstanding.sort(), ['Ali', 'Darya']);

    // ★ THE ASSERTION THIS PHASE EXISTS FOR.
    assert.notEqual(tally.no, tally.total, 'unanswered was folded into "no"');

    // A participant object for every member, used by the assertions above.
    for (const member of [fourth, fifth]) {
      assert.ok(
        body.participants.some((p) => p.id === member.participantId),
        'a non-voter is missing from the participant list',
      );
    }
  });

  test('a vote change updates one row and reports the transition', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    await vote(proposalId, member.userId, 'maybe');

    // Act
    const response = await vote(proposalId, member.userId, 'yes');

    // Assert
    assert.equal(response.status, 200);
    const body = await bodyOf<{ previous: string; is_change: boolean }>(response);
    assert.equal(body.previous, 'maybe');
    assert.equal(body.is_change, true);

    const rows = await asOwner<{ n: number; value: string }>(
      `select count(*)::int as n, max(value) as value from vote where proposal_id = $1`,
      [proposalId],
    );
    assert.equal(rows.rows[0]?.n, 1, 'a vote change created a second row');
    assert.equal(rows.rows[0]?.value, 'yes');

    const status = await statusOf(eventId, organizerId);
    const { tally } = tallyFor(status, proposalId);
    assert.equal(tally.yes, 1);
    assert.equal(tally.maybe, 0);
  });

  test('a concurrent double-write leaves exactly one row, last write wins', async () => {
    // Arrange — the unique (proposal_id, participant_id) constraint is what
    // makes the upsert safe; this asserts the route actually relies on it.
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    // Act — ten simultaneous writes from one participant.
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        vote(proposalId, member.userId, index % 2 === 0 ? 'yes' : 'no'),
      ),
    );

    // Assert
    for (const response of responses) {
      assert.equal(response.status, 200, 'a concurrent vote was refused');
    }

    const rows = await asOwner<{ n: number }>(
      `select count(*)::int as n from vote where proposal_id = $1 and participant_id = $2`,
      [proposalId, member.participantId],
    );
    assert.equal(rows.rows[0]?.n, 1, 'concurrent writes produced more than one vote row');

    const status = await statusOf(eventId, organizerId);
    const { tally } = tallyFor(status, proposalId);
    assert.equal(tally.yes + tally.maybe + tally.no, 1);
  });

  test('a vote on a withdrawn proposal is rejected (E7)', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    const withdrawn = await call(`/api/proposals/${proposalId}`, {
      method: 'DELETE',
      userId: organizerId,
    });
    assert.equal(withdrawn.status, 200);

    // Act
    const response = await vote(proposalId, member.userId, 'yes');

    // Assert
    assert.equal(response.status, 422);
    const body = await bodyOf<{ fields: Record<string, string> }>(response);
    assert.equal(body.fields.value, 'voting.validation.proposalWithdrawn');

    const rows = await asOwner<{ n: number }>(
      `select count(*)::int as n from vote where proposal_id = $1`,
      [proposalId],
    );
    assert.equal(rows.rows[0]?.n, 0, 'a rejected vote was still written');
  });

  test('a non-participant cannot vote, and learns nothing about the event', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    const stranger = await seedEvent();

    // Act
    const response = await vote(proposalId, stranger.organizerId, 'yes');

    // Assert — the same answer a nonexistent proposal would give.
    assert.equal(response.status, 403);
    const body = await bodyOf<{ error: string }>(response);
    assert.equal(body.error, 'NOT_PARTICIPANT');
  });

  test('AC-2.3.1: confirmation succeeds with outstanding voters', async () => {
    // Arrange — five participants, two answers.
    const { eventId, organizerId } = await seedEvent();
    const second = await addMember(eventId, { displayName: 'Bahar' });
    await addMember(eventId, { displayName: 'Syrus' });
    await addMember(eventId, { displayName: 'Darya' });
    await addMember(eventId, { displayName: 'Ali' });

    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    await vote(proposalId, organizerId, 'yes');
    await vote(proposalId, second.userId, 'maybe');

    // Act
    const response = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: { axis: 'time', warned_outstanding: true },
    });

    // Assert
    assert.equal(response.status, 200);
    const body = await bodyOf<ConfirmBody>(response);
    assert.ok(body.decision, 'no decision was recorded');
    assert.equal(body.decision.proposal_id, proposalId);
    assert.equal(body.already_confirmed, false);
    assert.deepEqual(body.outstanding.sort(), ['Ali', 'Darya', 'Syrus']);

    const updated = await asOwner<{ status: string }>(
      `select status from proposal where id = $1`,
      [proposalId],
    );
    assert.equal(updated.rows[0]?.status, 'CHOSEN');
  });

  test('E1: a second confirmation returns the existing decision, not an error', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );
    await vote(proposalId, organizerId, 'yes');

    const first = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: { axis: 'time' },
    });
    assert.equal(first.status, 200);
    const firstBody = await bodyOf<ConfirmBody>(first);

    // Act
    const second = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: { axis: 'time' },
    });

    // Assert
    assert.equal(second.status, 200);
    const secondBody = await bodyOf<ConfirmBody>(second);
    assert.equal(secondBody.already_confirmed, true);
    assert.equal(secondBody.decision?.id, firstBody.decision?.id);

    const rows = await asOwner<{ n: number }>(
      `select count(*)::int as n from decision where event_id = $1 and axis = 'time'`,
      [eventId],
    );
    assert.equal(rows.rows[0]?.n, 1, 'a second confirm inserted a second decision');
  });

  test('only the organizer may confirm', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );
    await vote(proposalId, member.userId, 'yes');

    // Act
    const response = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: member.userId,
      body: { axis: 'time' },
    });

    // Assert
    assert.equal(response.status, 403);
    const body = await bodyOf<{ error: string }>(response);
    assert.equal(body.error, 'NOT_ORGANIZER');
  });

  test('AC-2.4.1: a tie resolves to the earlier proposal, stably', async () => {
    // Arrange — two proposals with identical vote counts.
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });

    const start = legalSlot(1);
    const earlier = await createTimeProposal(eventId, organizerId, 'Earlier', start);
    const later = await createTimeProposal(
      eventId,
      organizerId,
      'Later',
      new Date(Date.parse(start) + 3_600_000).toISOString(),
    );

    for (const proposalId of [earlier, later]) {
      await vote(proposalId, organizerId, 'yes');
      await vote(proposalId, member.userId, 'yes');
    }

    // Act — confirm five times: the answer must not wander.
    const chosen: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await call(`/api/events/${eventId}/confirm`, {
        method: 'POST',
        userId: organizerId,
        body: { axis: 'time' },
      });
      assert.equal(response.status, 200);
      const body = await bodyOf<ConfirmBody>(response);
      assert.ok(body.decision?.proposal_id);
      chosen.push(body.decision.proposal_id);
    }

    // Assert
    assert.equal(new Set(chosen).size, 1, 'the confirmed proposal changed between calls');
    assert.equal(chosen[0], earlier, 'the tie did not resolve to the earlier proposal');
  });

  test('the activity log records a vote change and no coordinates', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    await vote(proposalId, member.userId, 'maybe');
    await vote(proposalId, member.userId, 'yes');

    // Act
    const response = await call(`/api/events/${eventId}/activity`, { userId: organizerId });

    // Assert
    assert.equal(response.status, 200);
    const body = await bodyOf<ActivityBody>(response);

    const change = body.activity.find((entry) => entry.action === 'vote_changed');
    assert.ok(change, 'no vote_changed entry was written');
    assert.equal(change.detail.from, 'maybe');
    assert.equal(change.detail.to, 'yes');
    assert.equal(change.actor_name, 'Bahar');

    // ★ NO COORDINATES, AND NO PROSE.
    //
    // The log is participant-visible; a coordinate here is a leak with an audit
    // trail. A rendered sentence would be frozen in one language.
    const serialised = JSON.stringify(body.activity).toLowerCase();
    for (const forbidden of ['lat', 'lng', 'coord', 'accuracy']) {
      assert.ok(!serialised.includes(forbidden), `the activity log contains "${forbidden}"`);
    }

    const cast = body.activity.find((entry) => entry.action === 'vote_cast');
    assert.ok(cast, 'the first vote was not logged');
    assert.equal(cast.detail.to, 'maybe');
  });

  test('a re-tap of the same value is not logged as a change', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    await vote(proposalId, member.userId, 'yes');
    await vote(proposalId, member.userId, 'yes');

    // Act
    const response = await call(`/api/events/${eventId}/activity`, { userId: organizerId });
    const body = await bodyOf<ActivityBody>(response);

    // Assert — noise in an append-only trail buries the real changes.
    const changes = body.activity.filter((entry) => entry.action === 'vote_changed');
    assert.equal(changes.length, 0);
  });

  test('the event status is untouched while another axis is still open', async () => {
    // Arrange — a time proposal and a separate place proposal. Confirming the
    // time must not declare the place decided.
    //
    // ★ TWO PROPOSALS, NOT ONE `TIME_AND_PLACE`.
    //
    // A combined proposal answers both axes at once, so confirming it SHOULD
    // confirm the event. The bug worth catching is the one where the chosen
    // proposal turning `CHOSEN` makes "no open proposals" true and confirms the
    // event while a second axis is genuinely undecided.
    const { eventId, organizerId } = await seedEvent();
    const venueId = await seedVenue(eventId, { name: 'Cafe Didar' });

    const timeProposal = await createTimeProposal(eventId, organizerId, 'Friday dinner', legalSlot(1));

    const placeOnly = await call(`/api/events/${eventId}/proposals`, {
      method: 'POST',
      userId: organizerId,
      body: {
        type: 'PLACE',
        title: 'Cafe Didar',
        venue: { id: venueId, name: 'Cafe Didar', lat: 35.7, lng: 51.4 },
      },
    });
    assert.equal(placeOnly.status, 201, 'the place proposal was refused');

    await vote(timeProposal, organizerId, 'yes');
    await vote((await bodyOf<ProposalBody>(placeOnly)).proposal.id, organizerId, 'yes');

    // Act
    const response = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: { axis: 'time' },
    });

    // Assert
    assert.equal(response.status, 200);

    const event = await asOwner<{ status: string }>(`select status from event where id = $1`, [
      eventId,
    ]);
    assert.notEqual(
      event.rows[0]?.status,
      'CONFIRMED',
      'the event was confirmed while the place axis had no decision',
    );
  });

  test('the event is confirmed once every axis has a decision', async () => {
    // Arrange — the mirror of the test above, so the rule is pinned from both
    // sides: the axis check must not leave a fully-decided event stuck OPEN.
    const { eventId, organizerId } = await seedEvent();
    const start = legalSlot(1);
    const venueId = await seedVenue(eventId, { name: 'Cafe Didar' });

    const combined = await call(`/api/events/${eventId}/proposals`, {
      method: 'POST',
      userId: organizerId,
      body: {
        type: 'TIME_AND_PLACE',
        title: 'Friday at Cafe Didar',
        venue: { id: venueId, name: 'Cafe Didar', lat: 35.7, lng: 51.4 },
        start_utc: start,
        end_utc: new Date(Date.parse(start) + 7_200_000).toISOString(),
      },
    });
    assert.equal(combined.status, 201, 'the combined proposal was refused');

    const proposalId = (await bodyOf<ProposalBody>(combined)).proposal.id;
    await vote(proposalId, organizerId, 'yes');

    // Act — confirm both axes, as the Decision Card requires.
    for (const axis of ['time', 'place'] as const) {
      const response = await call(`/api/events/${eventId}/confirm`, {
        method: 'POST',
        userId: organizerId,
        body: { axis },
      });
      assert.equal(response.status, 200, `confirming ${axis} was refused`);
    }

    // Assert
    const event = await asOwner<{ status: string }>(`select status from event where id = $1`, [
      eventId,
    ]);
    assert.equal(event.rows[0]?.status, 'CONFIRMED');
  });

  test('confirming with no proposal is a state, not an error', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();

    // Act
    const response = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: { axis: 'time' },
    });

    // Assert
    assert.equal(response.status, 200);
    const body = await bodyOf<ConfirmBody>(response);
    assert.equal(body.decision, null);
  });

  test('the reason is stored as a template and params, never a sentence', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );
    await vote(proposalId, organizerId, 'yes');

    // Act
    const response = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: {
        axis: 'time',
        lens: 'balanced',
        reason: { templateId: 'balanced_floor', params: { floorMinutes: 18 } },
      },
    });

    // Assert
    const body = await bodyOf<ConfirmBody>(response);
    assert.equal(body.decision?.reason_template, 'balanced_floor');
    assert.deepEqual(body.decision?.reason_params, { floorMinutes: 18 });
    assert.equal(body.decision?.lens, 'balanced');

    // The stored row must hold a number, not "۱۸" — digits are the client's.
    const stored = await asOwner<{ reason_params: { floorMinutes: number } }>(
      `select reason_params from decision where id = $1`,
      [body.decision?.id],
    );
    assert.equal(stored.rows[0]?.reason_params.floorMinutes, 18);
  });

  test('voting is closed once the event is confirmed', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const first = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );
    const second = await createTimeProposal(
      eventId,
      organizerId,
      'Saturday dinner',
      legalSlot(2),
    );

    await vote(first, organizerId, 'yes');

    const confirmed = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: { axis: 'time' },
    });
    assert.equal(confirmed.status, 200);

    const status = await asOwner<{ status: string }>(`select status from event where id = $1`, [
      eventId,
    ]);

    // Only assert the lock when the event actually reached CONFIRMED — the
    // second proposal is still OPEN, so it stays DECIDING by design.
    if (status.rows[0]?.status !== 'CONFIRMED') {
      await asOwner(`update event set status = 'CONFIRMED' where id = $1`, [eventId]);
    }

    // Act
    const response = await vote(second, member.userId, 'yes');

    // Assert
    assert.equal(response.status, 422);
    const body = await bodyOf<{ fields: Record<string, string> }>(response);
    assert.equal(body.fields.value, 'voting.validation.eventConfirmed');
  });

  test('the caller sees their own vote, and only their own', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent();
    const member = await addMember(eventId, { displayName: 'Bahar' });
    const proposalId = await createTimeProposal(
      eventId,
      organizerId,
      'Friday dinner',
      legalSlot(1),
    );

    await vote(proposalId, organizerId, 'yes');
    await vote(proposalId, member.userId, 'no');

    // Act
    const mine = await statusOf(eventId, member.userId);

    // Assert
    assert.equal(mine.myVotes[proposalId], 'no');
    assert.equal(mine.me.display_name, 'Bahar');

    const theirs = await statusOf(eventId, organizerId);
    assert.equal(theirs.myVotes[proposalId], 'yes');
  });
});
