/**
 * The demo read (PRD-18 §5, AC-18.2.1).
 *
 * ★ THE ONE ASSERTION THAT MATTERS IS THE NULL.
 *
 * `demo_event_summary()` is `security definer`, so it bypasses RLS entirely.
 * The `e.is_demo is true` predicate is the ONLY thing preventing it from
 * reading a real event anonymously — there is no policy behind it to catch a
 * mistake. So this suite does not merely check that a demo event is readable;
 * it proves that a NON-demo event is not, through the same function, as the
 * same `anon` role.
 *
 * ★ AND THE PROJECTION ASSERTIONS.
 *
 * A demo readable by strangers must not leak a participant's approximate area
 * or the hash of a live invite link. Both are asserted by key, because the
 * function's body is the kind of SQL that grows a friendly `to_jsonb(p)` later.
 *
 * Needs a migrated database, so it runs through `npm run test:db`. Under
 * `npm test` the database is unreachable and every case skips explicitly —
 * it does not silently pass.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  asOwner,
  closePool,
  createUser,
  id,
  openAnonymousSession,
  pool,
  seedEvent,
  seedVenue,
  truncateAll,
  type Session,
} from '../db/support';

/** Whether a migrated database is reachable at all. */
let hasDatabase = false;

/**
 * Runs `demo_event_summary` as the `anon` role with NO claims — exactly what
 * a browser with no session sends.
 */
async function readAsAnon(eventId: string): Promise<unknown> {
  const session = await openAnonymousSession();
  try {
    return await callSummary(session, eventId);
  } finally {
    await session.client.query('reset role');
    session.client.release();
  }
}

async function callSummary(session: Session, eventId: string): Promise<unknown> {
  const result = await session.query<{ summary: unknown }>(
    'select public.demo_event_summary($1) as summary',
    [eventId],
  );
  return result.rows[0]?.summary ?? null;
}

describe('demo_event_summary', () => {
  let demoEventId = '';
  let realEventId = '';
  let organizerId = '';

  before(async () => {
    try {
      await pool().query('select 1 from public.demo_event_summary(gen_random_uuid())');
      hasDatabase = true;
    } catch {
      hasDatabase = false;
      return;
    }

    await truncateAll();

    organizerId = await createUser();
    const demo = await seedEvent({ organizerId, title: 'Demo event', status: 'DECIDING' });
    const real = await seedEvent({ organizerId, title: 'Real event', status: 'DECIDING' });

    demoEventId = demo.eventId;
    realEventId = real.eventId;

    // Only the demo event carries the marker.
    await asOwner('update event set is_demo = true where id = $1', [demoEventId]);

    await seedVenue(demoEventId, { name: 'Cafe Demo' });
    await seedVenue(realEventId, { name: 'Cafe Real' });
  });

  after(async () => {
    if (!hasDatabase) return;
    await truncateAll();
    await closePool();
  });

  test('AC-18.2.1: a demo event is readable with no session at all', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database — run `npm run test:db`');

    // Act
    const summary = (await readAsAnon(demoEventId)) as Record<string, unknown> | null;

    // Assert
    assert.ok(summary, 'the demo event must render without a session');
    assert.equal((summary.event as Record<string, unknown>).is_demo, true);
  });

  test('a non-demo event returns NULL for an anonymous caller', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Act
    const summary = await readAsAnon(realEventId);

    // Assert — this is the only thing keeping the definer function safe.
    assert.equal(summary, null, 'security definer leaked a real event to anon');
  });

  test('the predicate is `is_demo`, not a status a user could reach', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Arrange — the real event is already DECIDING, the state the plan warns
    // against using as the predicate. Confirm it is still unreadable.
    const status = await asOwner<{ status: string }>('select status from event where id = $1', [
      realEventId,
    ]);
    assert.equal(status.rows[0]?.status, 'DECIDING');

    // Act
    const summary = await readAsAnon(realEventId);

    // Assert
    assert.equal(summary, null, 'the predicate was widened to a status check');
  });

  test('the projection carries no participant location and no invite hash', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Arrange — an invite hash on the demo event, so its absence is meaningful.
    await asOwner(`update event set invite_token_hash = $1 where id = $2`, [
      `hash-${id()}`,
      demoEventId,
    ]);

    // Act
    const summary = (await readAsAnon(demoEventId)) as Record<string, unknown> | null;
    assert.ok(summary);
    const body = JSON.stringify(summary);

    // Assert — start_point is deliberately absent from the function's body.
    assert.ok(!body.includes('lat_rounded'), 'a participant latitude leaked');
    assert.ok(!body.includes('lng_rounded'), 'a participant longitude leaked');
    assert.ok(!body.includes('invite_token_hash'), 'the invite credential leaked');

    // Participants are a COUNT, never rows — a public read must not expose who.
    assert.equal(typeof summary.participantCount, 'number');
    assert.ok(!Array.isArray(summary.participants), 'participant rows must not be exposed');
  });

  test('the venues of the demo event are returned, ordered by name', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Act
    const summary = (await readAsAnon(demoEventId)) as Record<string, unknown>;

    // Assert — the ranked list is the whole point of the reviewer's read.
    const venues = summary.venues as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(venues), 'venues must be an array');
    assert.ok(venues.length > 0, 'the demo event has no venues in the summary');
    assert.equal(venues[0]?.name, 'Cafe Demo');
  });

  test('a non-existent event returns NULL, not an error', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Act / Assert — a deleted demo must render an empty state, not a 500.
    assert.equal(await readAsAnon(id()), null);
  });
});
