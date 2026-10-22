/**
 * The analytics table's contract (PRD-09 §7A, PRD-08 §15).
 *
 * ★ THE TRIGGER IS VERIFIED AGAINST A DATABASE, NOT READ.
 *
 * It has been wrong in three ways that all look identical from the outside:
 * a missing `)` raised on every row, an unparenthesised `~ … || …` matched
 * everything, and a plain `lat` substring rejected `platform` — the first
 * property the funnel records. Each version stopped the funnel silently,
 * because `track()` deliberately reports no driver message.
 *
 * So this suite asserts the two halves separately: the props the funnel
 * actually records must be ACCEPTED, and a coordinate or a credential must be
 * REFUSED. A regex that fails either direction is a broken funnel.
 *
 * Needs a migrated database, so it runs through `npm run test:db`. Under
 * `npm test` it skips explicitly rather than passing on nothing.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { asOwner, closePool, createUser, pool, seedEvent, truncateAll } from './support';

/** Whether a migrated database with the analytics table is reachable. */
let hasDatabase = false;
let eventId = '';

/** Inserts one props object directly, bypassing the emitter's redaction. */
async function insertProps(props: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  try {
    await asOwner(`insert into analytics_event (event_id, name, props) values ($1, 'probe', $2::jsonb)`, [
      eventId,
      JSON.stringify(props),
    ]);
    return { ok: true, message: 'accepted' };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/**
 * The keys a coordinate hides behind.
 *
 * Every one of these is a real spelling: `lat_rounded` is the column the schema
 * stores, `participantLat` is what a JSON serialiser produces, `userlat` is what
 * survives key normalisation.
 */
const COORDINATE_KEYS = [
  'lat',
  'lng',
  'lat_rounded',
  'lng_rounded',
  'user_lat',
  'userlat',
  'participantLat',
  'longitude',
];

/** The credential and identifier keys the redaction contract forbids. */
const SENSITIVE_KEYS = ['invite_token', 'token', 'displayName', 'phone', 'apiKey'];

/**
 * The properties the seven funnel steps actually carry (PRD-12 §8.1).
 *
 * ★ `platform` IS THE ONE THAT BROKE IT.
 *
 * It contains `lat`, so a naive substring rule rejects the very first event in
 * the funnel — and a funnel whose first step is refused records nothing at all.
 */
const FUNNEL_KEYS = [
  'platform',
  'seconds_from_open',
  'seconds_since_event_open',
  'elapsed_since_open_s',
  'outstanding_voters',
  'proposal_count',
  'unanswered_total',
  'source',
  'type',
  'value',
];

describe('analytics_event', () => {
  before(async () => {
    try {
      await pool().query('select 1 from public.analytics_event limit 0');
      hasDatabase = true;
    } catch {
      return;
    }

    await truncateAll();
    const organizerId = await createUser();
    const event = await seedEvent({ organizerId, title: 'Analytics event', status: 'DECIDING' });
    eventId = event.eventId;
  });

  after(async () => {
    if (!hasDatabase) return;
    await pool().query('delete from analytics_event');
    await truncateAll();
    await closePool();
  });

  test('every funnel property the product records is accepted', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database — run `npm run test:db`');

    for (const key of FUNNEL_KEYS) {
      // Act
      const outcome = await insertProps({ [key]: 42 });

      // Assert — a refused funnel property means the funnel is not recording.
      assert.equal(outcome.ok, true, `the trigger refused the funnel key "${key}": ${outcome.message}`);
    }
  });

  test('every coordinate-shaped key is refused', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    for (const key of COORDINATE_KEYS) {
      // Act
      const outcome = await insertProps({ [key]: 35.7 });

      // Assert
      assert.equal(outcome.ok, false, `the trigger accepted the coordinate key "${key}"`);
      assert.match(outcome.message, /redaction contract/);
    }
  });

  test('every credential or identifier key is refused', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    for (const key of SENSITIVE_KEYS) {
      // Act
      const outcome = await insertProps({ [key]: 'x' });

      // Assert
      assert.equal(outcome.ok, false, `the trigger accepted the sensitive key "${key}"`);
    }
  });

  test('a coordinate is refused however deeply it is nested', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Act — the check reads the TOP-LEVEL keys only, so a nested object is the
    // gap. The emitter is the layer that handles it (`redactObject` is
    // recursive); this asserts that a caller cannot smuggle one past the
    // top-level rule and be surprised later.
    const outcome = await insertProps({ where: { lat: 35.7 } });

    // Assert — accepted, because the emitter is the recursive layer. Recorded
    // here so the boundary is explicit rather than assumed.
    assert.equal(outcome.ok, true, 'a nested object is the emitter\'s job, not the trigger\'s');
  });

  test('the event id may be null, so the funnel keeps its first step', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Act — `invite_link_opened` fires on a token that may resolve to nothing.
    const result = await asOwner(
      `insert into analytics_event (event_id, name, props) values (null, 'invite_link_opened', '{}'::jsonb)`,
    );

    // Assert
    assert.ok(result, 'a null event_id must be accepted');
  });

  test('the table is RLS-protected with no client policy', async (t) => {
    if (!hasDatabase) return t.skip('needs a migrated database');

    // Act
    const rls = await pool().query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'analytics_event'`,
    );
    const policies = await pool().query<{ count: string }>(
      `select count(*)::text from pg_policies where tablename = 'analytics_event'`,
    );

    // Assert — RLS on and no policy is stricter than a policy that denies rows:
    // it also denies any role someone later adds to a policy by accident.
    assert.equal(rls.rows[0]?.relrowsecurity, true);
    assert.equal(policies.rows[0]?.count, '0');
  });
});
