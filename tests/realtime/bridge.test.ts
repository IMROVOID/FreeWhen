/**
 * The realtime bridge.
 *
 * ★★ THE SECURITY PROPERTY THIS SUITE EXISTS TO PROVE ★★
 *
 * A websocket that streams rows to whoever connects bypasses RLS entirely.
 * The bridge's whole design is that it does NOT do that: the NOTIFY
 * payload is a signal, and the row is fetched **as each subscriber**, so
 * the database's RLS policies decide what that subscriber may see.
 *
 * Two things are therefore tested here:
 *
 *  1. **Cross-event isolation** — a client subscribed to event A receives
 *     nothing when event B's vote changes.
 *  2. **Per-subscriber authorization** — a subscriber who may not read the
 *     row is told NOTHING, not even that a change occurred. A "something
 *     happened" notice is itself a disclosure.
 *
 * ★ THE CHANNELS ARE THE CONTRACT (PRD-02 §8, PRD-06 FR-6.7b).
 *
 * `event:{id}:votes`, `event:{id}:proposals`, `event:{id}:status`,
 * `event:{id}:chat` — the same names Supabase Realtime uses, so the client
 * is written once.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  RealtimeBridge,
  parseSignal,
  type BridgeMessage,
  type Subscriber,
} from '../../server/realtime/bridge';
import {
  CHANNEL_TABLE,
  EXCLUDED_TABLES,
  PUBLISHED_TABLES,
  ROW_KEY,
  channelEventId,
  channelFor,
  channelKind,
  channelTable,
  isPublishedTable,
  isValidChannel,
  votesChannel,
} from '../../server/realtime/channels';

const EVENT_A = '11111111-1111-1111-1111-111111111111';
const EVENT_B = '22222222-2222-2222-2222-222222222222';
const ROW_ID = '33333333-3333-3333-3333-333333333333';
const USER_A = '44444444-4444-4444-4444-444444444444';
const USER_B = '55555555-5555-5555-5555-555555555555';

/** A subscriber that records what it was sent. */
function fakeSubscriber(
  id: string,
  claims: { sub: string; role?: 'authenticated'; is_anonymous?: boolean } = {
    sub: USER_A,
  },
): Subscriber & { sent: BridgeMessage[] } {
  const sent: BridgeMessage[] = [];

  return {
    id,
    channels: new Set<string>(),
    claims: {
      sub: claims.sub,
      role: claims.role ?? 'authenticated',
      is_anonymous: claims.is_anonymous ?? true,
    },
    send(message) {
      sent.push(message);
    },
    sent,
  };
}

describe('the realtime channels', () => {
  // ───────────────────────────────────────────────────────────
  // The published tables
  // ───────────────────────────────────────────────────────────
  describe('the published tables', () => {
    test('there are exactly five, and they are the documented ones', () => {
      assert.deepEqual([...PUBLISHED_TABLES].sort(), [
        'event',
        'event_message',
        'proposal',
        'rsvp',
        'vote',
      ]);
    });

    test('the excluded tables are excluded', () => {
      // ★ A location leak is the worst possible outcome here, and the
      // travel cache would flood the channel besides.
      for (const table of Object.keys(EXCLUDED_TABLES)) {
        assert.equal(
          isPublishedTable(table),
          false,
          `${table} must never be streamed`,
        );
      }
    });

    test('an unknown table is not published', () => {
      for (const table of ['start_point', 'travel_measurement', 'activity_log', 'comment', '']) {
        assert.equal(isPublishedTable(table), false);
      }
    });

    test('the rsvp row key is the participant id, not an id column', () => {
      // ★ rsvp's primary key IS participant_id — one participant has one
      // RSVP, and a second one is a primary-key violation rather than a
      // silent overwrite. A trigger or fetch that read `id` would find
      // nothing.
      assert.equal(ROW_KEY.rsvp, 'participant_id');

      for (const table of ['event', 'proposal', 'vote', 'event_message'] as const) {
        assert.equal(ROW_KEY[table], 'id');
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // The channel names
  // ───────────────────────────────────────────────────────────
  describe('the channel names', () => {
    test('they match the PRD names exactly', () => {
      assert.equal(votesChannel(EVENT_A), `event:${EVENT_A}:votes`);
      assert.equal(channelFor('proposal', EVENT_A), `event:${EVENT_A}:proposals`);
      assert.equal(channelFor('event', EVENT_A), `event:${EVENT_A}:status`);
      assert.equal(channelFor('event_message', EVENT_A), `event:${EVENT_A}:chat`);
    });

    test('the channel kind names the table it carries', () => {
      assert.equal(channelTable(votesChannel(EVENT_A)), 'vote');
      assert.equal(channelTable(`event:${EVENT_A}:proposals`), 'proposal');
      assert.equal(channelTable(`event:${EVENT_A}:status`), 'event');
      assert.equal(channelTable(`event:${EVENT_A}:chat`), 'event_message');
    });

    test('the event id is recovered from the channel name', () => {
      assert.equal(channelEventId(votesChannel(EVENT_A)), EVENT_A);
      assert.equal(channelEventId(votesChannel('not-a-uuid')), undefined);
    });

    test('a channel with an unknown kind is invalid', () => {
      assert.equal(channelKind(`event:${EVENT_A}:secrets`), undefined);
      assert.equal(isValidChannel(`event:${EVENT_A}:secrets`), false);
    });

    test('a channel with a malformed id is invalid', () => {
      assert.equal(isValidChannel('event:not-a-uuid:votes'), false);
      assert.equal(isValidChannel('votes'), false);
      assert.equal(isValidChannel(''), false);
    });

    test('the rsvp table rides the status channel', () => {
      // The PRDs name no channel for rsvp, and it is event STATE — so it
      // rides the same channel the event's own status changes ride.
      assert.equal(channelFor('rsvp', EVENT_A), `event:${EVENT_A}:status`);
    });

    test('every channel kind maps to a table', () => {
      for (const kind of Object.keys(CHANNEL_TABLE)) {
        const table = CHANNEL_TABLE[kind as keyof typeof CHANNEL_TABLE];
        assert.ok(table, `${kind} must map to a table`);
      }
    });
  });

  // ───────────────────────────────────────────────────────────
  // The notification payload
  // ───────────────────────────────────────────────────────────
  describe('the notification payload', () => {
    test('a well-formed signal parses', () => {
      const signal = parseSignal(
        JSON.stringify({ table: 'vote', id: ROW_ID, op: 'UPDATE', event_id: EVENT_A }),
      );

      assert.equal(signal?.table, 'vote');
      assert.equal(signal?.id, ROW_ID);
      assert.equal(signal?.op, 'UPDATE');
      assert.equal(signal?.event_id, EVENT_A);
    });

    test('a payload for an unpublished table is dropped', () => {
      // ★ A `pg_notify` from ANY session on the database reaches this
      // listener, so the payload is not fully trusted.
      for (const table of ['start_point', 'travel_measurement', 'activity_log']) {
        const signal = parseSignal(JSON.stringify({ table, id: ROW_ID, op: 'INSERT' }));
        assert.equal(signal, undefined, `${table} must not be streamed`);
      }
    });

    test('a malformed payload is dropped, not thrown', () => {
      for (const payload of ['', 'not json', '[]', 'null', '"a string"']) {
        assert.equal(parseSignal(payload), undefined);
      }
    });

    test('a payload with a missing field is dropped', () => {
      assert.equal(parseSignal(JSON.stringify({ id: ROW_ID, op: 'INSERT' })), undefined);
      assert.equal(parseSignal(JSON.stringify({ table: 'vote', op: 'INSERT' })), undefined);
      assert.equal(parseSignal(JSON.stringify({ table: 'vote', id: ROW_ID })), undefined);
    });

    test('an unknown operation is dropped', () => {
      assert.equal(
        parseSignal(JSON.stringify({ table: 'vote', id: ROW_ID, op: 'TRUNCATE' })),
        undefined,
      );
    });

    test('the payload never carries row data', () => {
      // ★ THE 8000-BYTE LIMIT, AS A PROPERTY.
      //
      // The payload is a signal, so it cannot exceed the limit — and a
      // payload that carried row data would bypass RLS.
      const signal = parseSignal(
        JSON.stringify({
          table: 'vote',
          id: ROW_ID,
          op: 'INSERT',
          event_id: EVENT_A,
          row: { value: 'yes', participant_id: USER_A },
        }),
      );

      assert.equal(signal?.table, 'vote');
      // The row is not carried — the bridge fetches it as the subscriber.
      assert.equal('row' in (signal ?? {}), false);
    });
  });

  // ───────────────────────────────────────────────────────────
  // ★ THE SECURITY PROPERTIES
  // ───────────────────────────────────────────────────────────
  describe('the fan-out enforces authorization per subscriber', () => {
    test('a subscriber who may not read the row is told nothing', async () => {
      // ★ THE SINGLE MOST IMPORTANT TEST IN THIS FILE.
      //
      // The fetch returns nothing — RLS denied it — so the subscriber is
      // sent NO MESSAGE. Not a message with an empty body, and not a
      // "something happened" notice: a notice that a change occurred is
      // itself a disclosure.
      const subscriber = fakeSubscriber('s1');
      const bridge = new RealtimeBridge({
        fetchRow: async () => undefined,
      });

      bridge.addSubscriber(subscriber, [votesChannel(EVENT_A)]);

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 0);
      assert.equal(subscriber.sent.length, 0, 'a denied subscriber must receive nothing');
    });

    test('a subscriber who may read the row receives it', async () => {
      const subscriber = fakeSubscriber('s1');
      const bridge = new RealtimeBridge({
        fetchRow: async () => ({ id: ROW_ID, value: 'yes' }),
      });

      bridge.addSubscriber(subscriber, [votesChannel(EVENT_A)]);

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 1);
      assert.equal(subscriber.sent.length, 1);

      const message = subscriber.sent[0] as Extract<BridgeMessage, { type: 'change' }>;
      assert.equal(message.type, 'change');
      assert.equal(message.channel, votesChannel(EVENT_A));
      assert.equal(message.table, 'vote');
      assert.equal(message.op, 'UPDATE');
      assert.deepEqual(message.row, { id: ROW_ID, value: 'yes' });
    });

    test('the fetch is made with THAT subscriber’s claims', async () => {
      // ★ The fetch is the security boundary, so the claims it is made
      // with are the boundary's substance.
      const seen: string[] = [];

      const subscriber = fakeSubscriber('s1', { sub: USER_A });
      const bridge = new RealtimeBridge({
        fetchRow: async ({ subscriber: who }) => {
          seen.push(who.claims.sub);
          return { id: ROW_ID };
        },
      });

      bridge.addSubscriber(subscriber, [votesChannel(EVENT_A)]);

      await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.deepEqual(seen, [USER_A]);
    });

    test('two subscribers are fetched separately, and one can be denied', async () => {
      // ★ THE PROOF THAT THE FETCH IS PER-SUBSCRIBER, NOT PER-EVENT.
      //
      // Subscriber A can read the row; subscriber B cannot. A bridge that
      // fetched once and fanned the result out would give B the row too.
      const allowed = fakeSubscriber('allowed', { sub: USER_A });
      const denied = fakeSubscriber('denied', { sub: USER_B });

      const bridge = new RealtimeBridge({
        fetchRow: async ({ subscriber }) =>
          subscriber.claims.sub === USER_A ? { id: ROW_ID, value: 'yes' } : undefined,
      });

      bridge.addSubscriber(allowed, [votesChannel(EVENT_A)]);
      bridge.addSubscriber(denied, [votesChannel(EVENT_A)]);

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 1);
      assert.equal(allowed.sent.length, 1);
      assert.equal(denied.sent.length, 0, 'the denied subscriber must receive nothing');
    });
  });

  // ───────────────────────────────────────────────────────────
  // ★ CROSS-EVENT ISOLATION
  // ───────────────────────────────────────────────────────────
  describe('cross-event isolation', () => {
    test('a client on event B receives nothing when event A’s vote changes', async () => {
      // ★ THE PLAN'S VALIDATION COMMAND, AS A TEST.
      const clientA = fakeSubscriber('a', { sub: USER_A });
      const clientB = fakeSubscriber('b', { sub: USER_B });

      const bridge = new RealtimeBridge({
        fetchRow: async () => ({ id: ROW_ID, value: 'yes' }),
      });

      bridge.addSubscriber(clientA, [votesChannel(EVENT_A)]);
      bridge.addSubscriber(clientB, [votesChannel(EVENT_B)]);

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 1);
      assert.equal(clientA.sent.length, 1);
      assert.equal(clientB.sent.length, 0, 'event B must hear nothing about event A');
    });

    test('a change with no event id is delivered to nobody', async () => {
      // A signal whose event could not be resolved cannot be routed, and
      // a change that cannot be routed must not be guessed at.
      const subscriber = fakeSubscriber('s1');

      const bridge = new RealtimeBridge({
        fetchRow: async () => ({ id: ROW_ID }),
      });

      bridge.addSubscriber(subscriber, [votesChannel(EVENT_A)]);

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
      });

      assert.equal(delivered, 0);
      assert.equal(subscriber.sent.length, 0);
    });

    test('a vote change is not delivered on the proposals channel', async () => {
      // The channel is per-table AND per-event: a vote is not a proposal.
      const subscriber = fakeSubscriber('s1');

      const bridge = new RealtimeBridge({
        fetchRow: async () => ({ id: ROW_ID }),
      });

      bridge.addSubscriber(subscriber, [`event:${EVENT_A}:proposals`]);

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 0);
      assert.equal(subscriber.sent.length, 0);
    });

    test('a subscriber to several channels gets the one that matches', async () => {
      const subscriber = fakeSubscriber('s1');

      const bridge = new RealtimeBridge({
        fetchRow: async () => ({ id: ROW_ID }),
      });

      bridge.addSubscriber(subscriber, [
        votesChannel(EVENT_A),
        `event:${EVENT_A}:proposals`,
      ]);

      await bridge.handleSignal({
        table: 'proposal',
        id: ROW_ID,
        op: 'INSERT',
        event_id: EVENT_A,
      });

      assert.equal(subscriber.sent.length, 1);
      const message = subscriber.sent[0] as Extract<BridgeMessage, { type: 'change' }>;
      assert.equal(message.channel, `event:${EVENT_A}:proposals`);
    });
  });

  // ───────────────────────────────────────────────────────────
  // The subscription itself
  // ───────────────────────────────────────────────────────────
  describe('subscriptions', () => {
    test('an invalid channel is refused', async () => {
      // ★ A channel name carries the event id, so accepting an arbitrary
      // name would let a client subscribe to an event it has no business
      // naming.
      const subscriber = fakeSubscriber('s1');

      const bridge = new RealtimeBridge({ fetchRow: async () => ({ id: ROW_ID }) });

      const accepted = bridge.addSubscriber(subscriber, [
        'event:not-a-uuid:votes',
        'event:anything',
        'votes',
        '',
      ]);

      assert.deepEqual(accepted, []);
      assert.equal(bridge.channelsOf('s1').length, 0);
    });

    test('a valid channel is accepted', () => {
      const subscriber = fakeSubscriber('s1');
      const bridge = new RealtimeBridge({ fetchRow: async () => undefined });

      const accepted = bridge.addSubscriber(subscriber, [votesChannel(EVENT_A)]);

      assert.deepEqual(accepted, [votesChannel(EVENT_A)]);
      assert.deepEqual(bridge.channelsOf('s1'), [votesChannel(EVENT_A)]);
    });

    test('a removed subscriber receives nothing', async () => {
      const subscriber = fakeSubscriber('s1');
      const bridge = new RealtimeBridge({ fetchRow: async () => ({ id: ROW_ID }) });

      bridge.addSubscriber(subscriber, [votesChannel(EVENT_A)]);
      bridge.removeSubscriber('s1');

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 0);
      assert.equal(subscriber.sent.length, 0);
      assert.equal(bridge.size, 0);
    });

    test('leaving one channel leaves the others subscribed', async () => {
      // ★ A SUBSCRIBER IS ONE SOCKET AND MAY HOLD SEVERAL CHANNELS.
      //
      // Leaving `:chat` must not stop the client receiving `:votes` — a
      // client that left one channel would otherwise look like the bridge
      // had dropped its connection.
      const subscriber = fakeSubscriber('s1');
      const bridge = new RealtimeBridge({ fetchRow: async () => ({ id: ROW_ID }) });

      bridge.addSubscriber(subscriber, [votesChannel(EVENT_A), `event:${EVENT_A}:chat`]);

      bridge.leaveChannel('s1', `event:${EVENT_A}:chat`);

      assert.deepEqual(bridge.channelsOf('s1'), [votesChannel(EVENT_A)]);

      // A vote still arrives.
      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 1);
      assert.equal(subscriber.sent.length, 1);
    });

    test('a subscriber with no channels left is dropped', async () => {
      const subscriber = fakeSubscriber('s1');
      const bridge = new RealtimeBridge({ fetchRow: async () => ({ id: ROW_ID }) });

      bridge.addSubscriber(subscriber, [votesChannel(EVENT_A)]);
      bridge.leaveChannel('s1', votesChannel(EVENT_A));

      assert.equal(bridge.size, 0, 'a subscriber with no channels is not a subscriber');
    });

    test('a subscriber with no channels receives nothing', async () => {
      const subscriber = fakeSubscriber('s1');
      const bridge = new RealtimeBridge({ fetchRow: async () => ({ id: ROW_ID }) });

      bridge.addSubscriber(subscriber, []);

      const delivered = await bridge.handleSignal({
        table: 'vote',
        id: ROW_ID,
        op: 'UPDATE',
        event_id: EVENT_A,
      });

      assert.equal(delivered, 0);
    });
  });
});
