/**
 * A live proof that the realtime bridge works end to end.
 *
 * The chain this proves: a database write → the `LISTEN/NOTIFY` trigger →
 * the bridge → the per-subscriber fetch (as the subscriber) → the
 * WebSocket frame. Every step is the real one — a real database, a real
 * `pg_notify`, a real socket.
 *
 * Two clients, two events, and the assertion that matters: **client B,
 * subscribed to a different event, receives nothing.**
 *
 * Run manually:
 *   npm run server:realtime
 *   LOCAL_REALTIME_URL=ws://127.0.0.1:8788/realtime/v1 npm run test -- realtime/live
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { after, before, describe, test } from 'node:test';

import { WebSocket } from 'ws';

import { createPool, loadDotEnv } from '../../scripts/db/client';
import { votesChannel } from '../../server/realtime/channels';
import { signToken } from '../../server/auth/tokens';

const REALTIME_URL = process.env.LOCAL_REALTIME_URL ?? 'ws://127.0.0.1:8788/realtime/v1';
const SECRET = process.env.JWT_SECRET ?? 'local-dev-jwt-secret-long-enough-for-postgrest';

/**
 * The database the BRIDGE is listening to.
 *
 * ★ IT MUST BE THE BRIDGE'S DATABASE, NOT THE SHARED TEST ONE.
 *
 * The bridge delivers a notification for a row it sees in ITS database.
 * A test that wrote its fixture into a different database would insert a
 * row the bridge never sees, and the test would fail for a reason that
 * has nothing to do with the bridge.
 *
 * It is also the reason the fixture rows must not be truncated by
 * another suite: the unit runner executes test FILES concurrently, and
 * the `test:db` suites truncate the shared database. So the live test
 * points at the bridge's own database, which nothing else touches.
 */
const BRIDGE_DATABASE_URL =
  process.env.LOCAL_PG_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:local-dev-password-not-a-real-secret@127.0.0.1:5434/freewhen';

/** Whether the bridge is running. */
async function bridgeIsUp(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const socket = new WebSocket(REALTIME_URL);
      const done = (up: boolean): void => {
        socket.removeAllListeners();
        try {
          socket.close();
        } catch {
          // A socket that never opened cannot be closed.
        }
        resolve(up);
      };
      socket.once('open', () => done(true));
      socket.once('error', () => done(false));
      setTimeout(() => done(false), 2000);
    } catch {
      resolve(false);
    }
  });
}

/** A client that records the frames it receives. */
function connect(): Promise<{ socket: WebSocket; frames: unknown[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(REALTIME_URL);
    const frames: unknown[] = [];

    socket.on('message', (data) => {
      try {
        frames.push(JSON.parse(data.toString()));
      } catch {
        frames.push(data.toString());
      }
    });

    socket.once('open', () => resolve({ socket, frames }));
    socket.once('error', reject);
  });
}

/** Joins a channel and waits for the reply. */
async function join(
  socket: WebSocket,
  channel: string,
  token: string,
): Promise<unknown> {
  const ref = randomUUID();

  const reply = new Promise((resolve) => {
    const onMessage = (data: Buffer): void => {
      const parsed = JSON.parse(data.toString()) as { event: string; ref?: string };
      if (parsed.event === 'phx_reply' && parsed.ref === ref) {
        socket.off('message', onMessage);
        resolve(parsed);
      }
    };
    socket.on('message', onMessage);
  });

  socket.send(
    JSON.stringify({
      event: 'phx_join',
      payload: { channel, access_token: token },
      ref,
    }),
  );

  return reply;
}

describe('the realtime bridge, live', () => {
  const state = { up: false };
  let pool: ReturnType<typeof createPool>;

  before(async () => {
    loadDotEnv();
    state.up = await bridgeIsUp();
    pool = createPool(BRIDGE_DATABASE_URL);

    if (!state.up) {
      console.log(
        `# realtime/live: skipped — no bridge at ${REALTIME_URL}. ` +
          'Start it with: npm run server:realtime',
      );
    }
  });

  after(async () => {
    await pool.end();
  });
  /**
   * Waits for a frame carrying a given vote id.
   *
   * ★ THE POLL IS NOT FIXED, THE CONDITION IS.
   *
   * A fixed wait is a race: on a loaded machine the notification has not
   * arrived yet, and the test fails for a reason that has nothing to do
   * with the bridge. So the wait is for the CONDITION — this vote's frame
   * — with a deadline, and the deadline is generous enough that a slow
   * machine is not mistaken for a broken one.
   */
  async function waitForVote(
    frames: unknown[],
    voteId: string,
    timeoutMs = 5000,
  ): Promise<unknown[]> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const matches = frames.filter(
        (frame) =>
          (frame as { event?: string }).event === 'postgres_changes' &&
          (frame as { payload: { new?: { id?: string } } }).payload?.new?.id === voteId,
      );

      if (matches.length > 0) return matches;
      if (Date.now() > deadline) return [];

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  test('a client can join a channel with a valid token', async (t) => {
    if (!state.up) {
      t.skip('no bridge running');
      return;
    }

    const { token } = signToken(
      { sub: randomUUID(), is_anonymous: true },
      SECRET,
    );

    const { socket } = await connect();
    try {
      const reply = (await join(socket, votesChannel(randomUUID()), token)) as {
        payload: { status: string };
      };

      assert.equal(reply.payload.status, 'ok');
    } finally {
      socket.close();
    }
  });

  test('a client without a token is refused', async (t) => {
    if (!state.up) {
      t.skip('no bridge running');
      return;
    }

    const { socket, frames } = await connect();
    try {
      socket.send(
        JSON.stringify({
          event: 'phx_join',
          payload: { channel: votesChannel(randomUUID()) },
          ref: randomUUID(),
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      const errors = frames.filter(
        (frame) => (frame as { event?: string }).event === 'phx_reply',
      );
      assert.ok(errors.length > 0, 'the join must be refused');
    } finally {
      socket.close();
    }
  });

  test('a client with an invalid token is refused', async (t) => {
    if (!state.up) {
      t.skip('no bridge running');
      return;
    }

    const { socket } = await connect();
    try {
      const { token } = signToken(
        { sub: randomUUID(), is_anonymous: true },
        'a-different-secret-that-is-long-enough-x',
      );

      const reply = (await join(socket, votesChannel(randomUUID()), token)) as {
        payload: { status: string };
      };

      assert.equal(reply.payload.status, 'error');
    } finally {
      socket.close();
    }
  });

  test('a vote change reaches a participant and not a stranger', async (t) => {
    if (!state.up) {
      t.skip('no bridge running');
      return;
    }

    // Arrange — a real event, a real participant, a real vote.
    const userId = randomUUID();
    const eventId = randomUUID();
    const participantId = randomUUID();
    const proposalId = randomUUID();
    const venueId = randomUUID();
    const strangerId = randomUUID();

    await pool.query(
      `insert into auth.users (id, is_anonymous) values ($1, true), ($2, true)`,
      [userId, strangerId],
    );
    await pool.query(
      `insert into event (id, title, activity_type, date_window_start, date_window_end, home_tz, created_by)
       values ($1, 'Live', 'dinner', now(), now() + interval '2 days', 'Asia/Tehran', $2)`,
      [eventId, userId],
    );
    await pool.query(
      `insert into participant (id, event_id, auth_user_id, display_name, role)
       values ($1, $2, $3, 'Live', 'organizer')`,
      [participantId, eventId, userId],
    );
    await pool.query(
      `insert into venue (id, event_id, name, lat, lng) values ($1, $2, 'Live', 35.70, 51.40)`,
      [venueId, eventId],
    );
    await pool.query(
      `insert into proposal (id, event_id, created_by, type, title, venue_id)
       values ($1, $2, $3, 'PLACE', 'Live', $4)`,
      [proposalId, eventId, participantId, venueId],
    );

    // The participant's token, and a stranger's.
    const { token: participantToken } = signToken(
      { sub: userId, is_anonymous: true },
      SECRET,
    );
    const { token: strangerToken } = signToken(
      { sub: strangerId, is_anonymous: true },
      SECRET,
    );

    const participant = await connect();
    const stranger = await connect();

    try {
      await join(participant.socket, votesChannel(eventId), participantToken);
      await join(stranger.socket, votesChannel(eventId), strangerToken);

      // Act — a real INSERT, which fires the real trigger.
      const voteId = randomUUID();
      await pool.query(
        `insert into vote (id, proposal_id, participant_id, value) values ($1, $2, $3, 'yes')`,
        [voteId, proposalId, participantId],
      );

      // Wait for the frame to arrive.
      const mine = await waitForVote(participant.frames, voteId);

      const strangerChanges = stranger.frames.filter(
        (frame) => (frame as { event?: string }).event === 'postgres_changes',
      );

      assert.equal(mine.length, 1, 'the participant must receive this vote');
      assert.equal(
        strangerChanges.length,
        0,
        'the stranger must receive nothing at all',
      );

      const payload = (mine[0] as { payload: { table: string; new: { id: string } } })
        .payload;
      assert.equal(payload.table, 'vote');
      assert.equal(payload.new.id, voteId);
    } finally {
      participant.socket.close();
      stranger.socket.close();
    }
  });

  test('a client on another event receives nothing', async (t) => {
    if (!state.up) {
      t.skip('no bridge running');
      return;
    }

    const userId = randomUUID();
    const eventA = randomUUID();
    const eventB = randomUUID();
    const participantId = randomUUID();
    const proposalId = randomUUID();
    const venueId = randomUUID();

    await pool.query(
      `insert into auth.users (id, is_anonymous) values ($1, true)`,
      [userId],
    );
    await pool.query(
      `insert into event (id, title, activity_type, date_window_start, date_window_end, home_tz, created_by)
       values ($1, 'A', 'dinner', now(), now() + interval '2 days', 'Asia/Tehran', $2)`,
      [eventA, userId],
    );
    await pool.query(
      `insert into event (id, title, activity_type, date_window_start, date_window_end, home_tz, created_by)
       values ($1, 'B', 'dinner', now(), now() + interval '2 days', 'Asia/Tehran', $2)`,
      [eventB, userId],
    );
    await pool.query(
      `insert into participant (id, event_id, auth_user_id, display_name, role)
       values ($1, $2, $3, 'Live', 'organizer')`,
      [participantId, eventA, userId],
    );
    await pool.query(
      `insert into venue (id, event_id, name, lat, lng) values ($1, $2, 'Live', 35.70, 51.40)`,
      [venueId, eventA],
    );
    await pool.query(
      `insert into proposal (id, event_id, created_by, type, title, venue_id)
       values ($1, $2, $3, 'PLACE', 'Live', $4)`,
      [proposalId, eventA, participantId, venueId],
    );

    const { token } = signToken({ sub: userId, is_anonymous: true }, SECRET);

    const clientA = await connect();
    const clientB = await connect();

    try {
      await join(clientA.socket, votesChannel(eventA), token);
      await join(clientB.socket, votesChannel(eventB), token);

      const voteId = randomUUID();
      await pool.query(
        `insert into vote (id, proposal_id, participant_id, value) values ($1, $2, $3, 'yes')`,
        [voteId, proposalId, participantId],
      );

      const a = await waitForVote(clientA.frames, voteId);
      const b = clientB.frames.filter(
        (frame) => (frame as { event?: string }).event === 'postgres_changes',
      );

      assert.equal(a.length, 1, 'event A\'s client must receive this vote');
      assert.equal(b.length, 0, 'event B\'s client must hear nothing');
    } finally {
      clientA.socket.close();
      clientB.socket.close();
    }
  });
});
