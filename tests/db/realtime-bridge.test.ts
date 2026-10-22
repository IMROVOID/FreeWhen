/**
 * The realtime bridge against a live database.
 *
 * ★ WHY THIS FILE EXISTS ALONGSIDE `tests/realtime/bridge.test.ts`.
 *
 * The unit suite proves the bridge's LOGIC with a fake fetcher. This file
 * proves the part that cannot be faked: that the fetcher really runs as
 * the subscriber, and that the database's RLS policies really deny a
 * non-participant.
 *
 * ★ A FAKE FETCHER WOULD PROVE NOTHING ABOUT THE SECURITY PROPERTY.
 *
 * The whole claim is "the row is fetched AS the subscriber, so RLS
 * applies". A fake fetcher returns whatever the test tells it to, so a
 * test with one proves only that the bridge calls a function. This file
 * runs the real fetcher, against the real policies, and asserts that a
 * non-participant's fetch returns NOTHING.
 *
 * ★ EVERY ASSERTION RUNS AGAINST THE REAL SCHEMA.
 *
 * The fixtures are the same ones `tests/db/support.ts` provides, and the
 * policies are the ones migration 011 creates.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { Pool } from 'pg';

import { RealtimeBridge, createSubscriberFetcher, type Subscriber } from '../../server/realtime/bridge';
import { votesChannel, chatChannel, statusChannel } from '../../server/realtime/channels';
import { createPool, databaseUrl, loadDotEnv } from '../../scripts/db/client';
import {
  addMember,
  asOwner,
  closePool,
  createUser,
  seedEvent,
  seedProposal,
  seedVenue,
  truncateAll,
} from './support';

/** A subscriber that records what it was sent. */
function fakeSubscriber(id: string, sub: string): Subscriber & { sent: unknown[] } {
  const sent: unknown[] = [];

  return {
    id,
    channels: new Set<string>(),
    claims: { sub, role: 'authenticated', is_anonymous: true },
    send(message) {
      sent.push(message);
    },
    sent,
  };
}

describe('the realtime bridge against a live database', { concurrency: false }, () => {
  let pool: Pool;

  before(async () => {
    loadDotEnv();
    pool = createPool(databaseUrl());
    await truncateAll();
  });

  after(async () => {
    await pool.end();
    await closePool();
  });

  test('a participant’s fetch returns the row', async () => {
    // Arrange
    const { eventId, organizerParticipantId, organizerId } = await seedEvent();
    const venueId = await seedVenue(eventId);
    const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposalId, organizerParticipantId],
    );

    const vote = await asOwner<{ id: string }>(
      `select id from vote where proposal_id = $1`,
      [proposalId],
    );
    const voteId = vote.rows[0]!.id;

    // Act
    const fetcher = createSubscriberFetcher(pool);
    const subscriber = fakeSubscriber('participant', organizerId);

    const row = await fetcher({ table: 'vote', id: voteId, subscriber });

    // Assert
    assert.ok(row, 'a participant must be able to read the row');
    assert.equal((row as { id: string }).id, voteId);
  });

  test('a non-participant’s fetch returns nothing', async () => {
    // ★ THE SECURITY PROPERTY, AGAINST THE REAL POLICIES.
    //
    // The fetcher runs the query with the subscriber's claims in effect,
    // so the `vote` policy's `using` clause decides — and a stranger
    // matches no participant row, so the query returns zero rows.
    const { eventId, organizerParticipantId } = await seedEvent();
    const venueId = await seedVenue(eventId);
    const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposalId, organizerParticipantId],
    );

    const vote = await asOwner<{ id: string }>(
      `select id from vote where proposal_id = $1`,
      [proposalId],
    );
    const voteId = vote.rows[0]!.id;

    const strangerId = await createUser();

    // Act
    const fetcher = createSubscriberFetcher(pool);
    const stranger = fakeSubscriber('stranger', strangerId);

    const row = await fetcher({ table: 'vote', id: voteId, subscriber: stranger });

    // Assert
    assert.equal(row, undefined, 'a non-participant must not be able to read the row');
  });

  test('the bridge delivers a vote to the participant and not to the stranger', async () => {
    // ★ THE PLAN'S VALIDATION COMMAND, AGAINST THE REAL DATABASE.
    //
    // Two clients, one event, one vote change. The participant is told;
    // the stranger hears nothing at all — not even that a change
    // occurred.
    const { eventId, organizerParticipantId, organizerId } = await seedEvent();
    const venueId = await seedVenue(eventId);
    const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposalId, organizerParticipantId],
    );

    const vote = await asOwner<{ id: string }>(
      `select id from vote where proposal_id = $1`,
      [proposalId],
    );
    const voteId = vote.rows[0]!.id;

    const strangerId = await createUser();

    const participant = fakeSubscriber('participant', organizerId);
    const stranger = fakeSubscriber('stranger', strangerId);

    const bridge = new RealtimeBridge({ fetchRow: createSubscriberFetcher(pool) });

    bridge.addSubscriber(participant, [votesChannel(eventId)]);
    bridge.addSubscriber(stranger, [votesChannel(eventId)]);

    // Act
    const delivered = await bridge.handleSignal({
      table: 'vote',
      id: voteId,
      op: 'INSERT',
      event_id: eventId,
    });

    // Assert
    assert.equal(delivered, 1, 'exactly one subscriber may be told');
    assert.equal(participant.sent.length, 1);
    assert.equal(stranger.sent.length, 0, 'the stranger must receive nothing');
  });

  test('a client on another event receives nothing', async () => {
    // ★ CROSS-EVENT ISOLATION, AGAINST THE REAL DATABASE.
    const eventA = await seedEvent({ title: 'Event A' });
    const eventB = await seedEvent({ title: 'Event B' });

    const venueId = await seedVenue(eventA.eventId);
    const proposalId = await seedProposal(
      eventA.eventId,
      eventA.organizerParticipantId,
      { venueId },
    );

    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposalId, eventA.organizerParticipantId],
    );

    const vote = await asOwner<{ id: string }>(
      `select id from vote where proposal_id = $1`,
      [proposalId],
    );
    const voteId = vote.rows[0]!.id;

    const clientA = fakeSubscriber('a', eventA.organizerId);
    const clientB = fakeSubscriber('b', eventB.organizerId);

    const bridge = new RealtimeBridge({ fetchRow: createSubscriberFetcher(pool) });

    bridge.addSubscriber(clientA, [votesChannel(eventA.eventId)]);
    bridge.addSubscriber(clientB, [votesChannel(eventB.eventId)]);

    // Act
    const delivered = await bridge.handleSignal({
      table: 'vote',
      id: voteId,
      op: 'INSERT',
      event_id: eventA.eventId,
    });

    // Assert
    assert.equal(delivered, 1);
    assert.equal(clientA.sent.length, 1);
    assert.equal(clientB.sent.length, 0, 'event B must hear nothing about event A');
  });

  test('the fetcher does not leak the previous subscriber’s identity', async () => {
    // ★ THE POOLED-CONNECTION HAZARD.
    //
    // `request.jwt.claims` and `set role` are session-level, and a
    // pooled connection is reused. The fetcher must reset both, or the
    // NEXT borrower of that connection would answer with the previous
    // caller's identity — which is a data leak between users.
    const { eventId, organizerParticipantId, organizerId } = await seedEvent();
    const venueId = await seedVenue(eventId);
    const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposalId, organizerParticipantId],
    );

    const vote = await asOwner<{ id: string }>(
      `select id from vote where proposal_id = $1`,
      [proposalId],
    );
    const voteId = vote.rows[0]!.id;

    const strangerId = await createUser();

    const fetcher = createSubscriberFetcher(pool);

    // The participant reads first.
    const allowed = await fetcher({
      table: 'vote',
      id: voteId,
      subscriber: fakeSubscriber('participant', organizerId),
    });
    assert.ok(allowed, 'the participant must be able to read the row');

    // The stranger reads next — and must NOT inherit the participant's
    // identity from the reused connection.
    const denied = await fetcher({
      table: 'vote',
      id: voteId,
      subscriber: fakeSubscriber('stranger', strangerId),
    });
    assert.equal(denied, undefined, 'the stranger must not inherit the previous identity');
  });

  test('a chat message is only delivered to the event’s participants', async () => {
    const { eventId, organizerParticipantId, organizerId } = await seedEvent();

    await asOwner(
      `insert into event_message (id, event_id, participant_id, sender_name, body)
       values ($1, $2, $3, 'Organizer', 'hello')`,
      [crypto.randomUUID(), eventId, organizerParticipantId],
    );

    const message = await asOwner<{ id: string }>(
      `select id from event_message where event_id = $1 limit 1`,
      [eventId],
    );
    const messageId = message.rows[0]!.id;

    const strangerId = await createUser();

    const participant = fakeSubscriber('participant', organizerId);
    const stranger = fakeSubscriber('stranger', strangerId);

    const bridge = new RealtimeBridge({ fetchRow: createSubscriberFetcher(pool) });

    bridge.addSubscriber(participant, [chatChannel(eventId)]);
    bridge.addSubscriber(stranger, [chatChannel(eventId)]);

    const delivered = await bridge.handleSignal({
      table: 'event_message',
      id: messageId,
      op: 'INSERT',
      event_id: eventId,
    });

    assert.equal(delivered, 1);
    assert.equal(participant.sent.length, 1);
    assert.equal(stranger.sent.length, 0);
  });

  test('the status channel carries the event row', async () => {
    const { eventId, organizerId } = await seedEvent();

    const participant = fakeSubscriber('participant', organizerId);
    const bridge = new RealtimeBridge({ fetchRow: createSubscriberFetcher(pool) });

    bridge.addSubscriber(participant, [statusChannel(eventId)]);

    const delivered = await bridge.handleSignal({
      table: 'event',
      id: eventId,
      op: 'UPDATE',
      event_id: eventId,
    });

    assert.equal(delivered, 1);
  });

  test('a member of the same event also receives the change', async () => {
    // The policies are participant-scoped, not organizer-scoped: a plain
    // member is as entitled to the event's votes as its organizer.
    const { eventId, organizerParticipantId } = await seedEvent();
    const venueId = await seedVenue(eventId);
    const proposalId = await seedProposal(eventId, organizerParticipantId, { venueId });

    const { userId } = await addMember(eventId);

    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposalId, organizerParticipantId],
    );

    const vote = await asOwner<{ id: string }>(
      `select id from vote where proposal_id = $1`,
      [proposalId],
    );
    const voteId = vote.rows[0]!.id;

    const member = fakeSubscriber('member', userId);
    const bridge = new RealtimeBridge({ fetchRow: createSubscriberFetcher(pool) });

    bridge.addSubscriber(member, [votesChannel(eventId)]);

    const delivered = await bridge.handleSignal({
      table: 'vote',
      id: voteId,
      op: 'INSERT',
      event_id: eventId,
    });

    assert.equal(delivered, 1, 'a member of the event must receive the vote');
  });
});
