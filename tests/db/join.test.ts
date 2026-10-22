/**
 * Guest join (Plan 05, Task 5).
 *
 * The three properties this file exists to prove:
 *
 *  - **A name collision never fails the join** (FR-1.19, AC-1.2.4). Blocking
 *    there blocks the path to voting, which is the entire funnel.
 *  - **The cap is a database guarantee under concurrency** (FR-1.21, PRD-01 E1).
 *    A count followed by an insert admits an eleventh participant; a row lock
 *    does not.
 *  - **Joining needs no location** (FR-1.22, AC-1.2.1). There is no permission
 *    anywhere on this path, and this suite joins without one.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { resetRateLimits } from '@/server/lib/rate-limit';
import { closeServicePool } from '@/server/lib/supabase';

import { asOwner, closePool, closeSession, openSession, truncateAll } from './support';
import {
  bodyOf,
  call,
  createEventViaApi,
  prepareServerEnv,
  prepareServerSql,
} from './server-support';

prepareServerEnv();

interface JoinBody {
  created: boolean;
  participant: { id: string; display_name: string; role: string; has_start_point: boolean };
  event: { event_id: string; participant_count: number };
}

describe('guest join', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    await truncateAll();
    resetRateLimits();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('AC-1.2.1 — a guest joins with no location and becomes a participant', async () => {
    const created = await createEventViaApi();

    const response = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Bahar' },
    });

    assert.equal(response.status, 200);

    const body = await bodyOf<JoinBody>(response);
    assert.equal(body.created, true);
    assert.equal(body.participant.display_name, 'Bahar');
    assert.equal(body.participant.role, 'member');
    // No location was sent, and none was asked for.
    assert.equal(body.participant.has_start_point, false);
    assert.equal(body.event.participant_count, 2);

    const rows = await asOwner<{ n: string }>(
      `select count(*)::text as n from participant where event_id = $1`,
      [created.eventId],
    );
    assert.equal(rows.rows[0]?.n, '2');
  });

  test('the join returns an identity the client can keep', async () => {
    const created = await createEventViaApi();

    const response = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Cyrus' },
    });

    const userId = response.headers.get('x-user-id');
    assert.ok(userId && userId.length === 36);

    // Re-joining with that identity is the same person, not a second row.
    const again = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      userId,
      body: { display_name: 'Cyrus' },
    });

    assert.equal(again.status, 200);
    const body = await bodyOf<JoinBody>(again);
    assert.equal(body.created, false);
    assert.equal(body.event.participant_count, 2);
  });

  test('AC-1.2.4 — a duplicate name joins as "Ali (2)" and the first is unaffected', async () => {
    const created = await createEventViaApi();

    const first = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Ali' },
    });
    const firstBody = await bodyOf<JoinBody>(first);

    const second = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Ali' },
    });
    const secondBody = await bodyOf<JoinBody>(second);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.participant.display_name, 'Ali');
    assert.equal(secondBody.participant.display_name, 'Ali (2)');
    assert.notEqual(firstBody.participant.id, secondBody.participant.id);
  });

  test('a third "Ali" becomes "Ali (3)", and a 30-character name still fits after renaming', async () => {
    const created = await createEventViaApi();

    await call(`/api/invite/${created.token}/join`, { method: 'POST', body: { display_name: 'Ali' } });
    await call(`/api/invite/${created.token}/join`, { method: 'POST', body: { display_name: 'Ali' } });
    const third = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Ali' },
    });

    assert.equal((await bodyOf<JoinBody>(third)).participant.display_name, 'Ali (3)');

    // A full-length name plus a disambiguator would exceed the column's 30
    // characters; the suffix must win over the tail of the name.
    const long = 'ب'.repeat(30);
    await call(`/api/invite/${created.token}/join`, { method: 'POST', body: { display_name: long } });
    const longSecond = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: long },
    });

    const renamed = (await bodyOf<JoinBody>(longSecond)).participant.display_name;
    assert.ok(renamed.endsWith(' (2)'), `expected a suffix, got "${renamed}"`);
    assert.ok(renamed.length <= 30, `expected <= 30 characters, got ${renamed.length}`);
  });

  test('AC-1.2.5 — the eleventh participant gets EVENT_FULL, not INVITE_INVALID', async () => {
    resetRateLimits();
    const created = await createEventViaApi();

    // Organizer + 9 = the cap of 10.
    for (let index = 0; index < 9; index++) {
      const response = await call(`/api/invite/${created.token}/join`, {
        method: 'POST',
        body: { display_name: `Member ${index + 1}` },
      });
      assert.equal(response.status, 200, `member ${index + 1} should join`);
    }

    const eleventh = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Eleventh' },
    });

    assert.equal(eleventh.status, 409);
    assert.equal((await bodyOf<{ error: string }>(eleventh)).error, 'EVENT_FULL');

    const rows = await asOwner<{ n: string }>(
      `select count(*)::text as n from participant where event_id = $1`,
      [created.eventId],
    );
    assert.equal(rows.rows[0]?.n, '10');
  });

  test('the cap race admits exactly the cap, never one more', async () => {
    resetRateLimits();
    const created = await createEventViaApi();

    // Nine existing participants, so the cap is one away.
    for (let index = 0; index < 8; index++) {
      await call(`/api/invite/${created.token}/join`, {
        method: 'POST',
        body: { display_name: `Racer ${index + 1}` },
      });
    }

    const before = await asOwner<{ n: string }>(
      `select count(*)::text as n from participant where event_id = $1`,
      [created.eventId],
    );
    assert.equal(before.rows[0]?.n, '9');

    // Ten simultaneous joins at nine. Without `select ... for update` on the
    // event row, several of these read 9 and all insert.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        call(`/api/invite/${created.token}/join`, {
          method: 'POST',
          body: { display_name: `Concurrent ${index + 1}` },
        }),
      ),
    );

    const succeeded = attempts.filter((response) => response.status === 200);
    const rejected = attempts.filter((response) => response.status === 409);

    assert.equal(succeeded.length, 1, 'exactly one join should slip under the cap');
    assert.equal(rejected.length, 9);

    const afterRows = await asOwner<{ n: string }>(
      `select count(*)::text as n from participant where event_id = $1`,
      [created.eventId],
    );
    assert.equal(afterRows.rows[0]?.n, '10');
  });

  test('an empty display name is rejected at the boundary', async () => {
    const created = await createEventViaApi();

    const response = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: '   ' },
    });

    assert.equal(response.status, 422);
    const body = await bodyOf<{ error: string; fields: Record<string, string> }>(response);
    assert.equal(body.error, 'VALIDATION_FAILED');
    assert.equal(body.fields.display_name, 'events.validation.nameRequired');
  });

  test('a non-string display name is rejected rather than coerced', async () => {
    const created = await createEventViaApi();

    const response = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 123 },
    });

    assert.equal(response.status, 422);
  });

  test('joining a thrown-away link is the generic error', async () => {
    const created = await createEventViaApi();
    await call(`/api/events/${created.eventId}/invite`, {
      method: 'DELETE',
      userId: created.userId,
    });

    const response = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Late' },
    });

    assert.equal(response.status, 404);
    assert.equal((await bodyOf<{ error: string }>(response)).error, 'INVITE_INVALID');
  });

  test('a join survives a dropped response — the retry does not create a second participant', async () => {
    // ★ THE RELIABILITY PROPERTY (PRD-01 FR "Reliability").
    //
    // A guest on a flaky connection taps Join, the request reaches the server,
    // and the RESPONSE is lost. The guest taps Join again. The second attempt
    // must find the existing participant row rather than create a second one —
    // a duplicate would make their vote count twice and their name appear
    // twice in the tally.
    //
    // The identity is what makes this work: the device kept the id from the
    // first attempt, so the retry is the same person (FR-1.20).
    const created = await createEventViaApi();

    const first = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Flaky' },
    });
    assert.equal(first.status, 200);

    const userId = first.headers.get('x-user-id') ?? '';
    assert.ok(userId);

    // The retry, with the identity the device kept.
    const second = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      userId,
      body: { display_name: 'Flaky' },
    });

    assert.equal(second.status, 200);

    const body = await bodyOf<JoinBody>(second);
    assert.equal(body.created, false, 'the retry must find the existing participant');

    // And the event still has exactly one guest.
    const participants = await asOwner<{ n: string }>(
      `select count(*)::text as n from participant where event_id = $1`,
      [created.eventId],
    );
    assert.equal(participants.rows[0]?.n, '2', 'the organizer and one guest');
  });

  test('the event still loads by a plain fetch after the join', async () => {
    // The "Reliability" property's other half: a joined participant can reopen
    // the event by an ordinary read, not only through the join response.
    const created = await createEventViaApi();

    const joined = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Reader' },
    });
    const userId = joined.headers.get('x-user-id') ?? '';

    const fetched = await call(`/api/events/${created.eventId}`, { userId });

    assert.equal(fetched.status, 200);
    const body = await bodyOf<{ event: { participant_count: number } }>(fetched);
    assert.equal(body.event.participant_count, 2);
  });
});

/**
 * ★ THE IDENTITY-BINDING REGRESSIONS.
 *
 * These exist because the first implementation of `join_event` took the
 * CALLER'S IDENTITY AS A PARAMETER and was executable by `anon`. That is an
 * impersonation oracle: any caller could join an event as any user, including
 * an organizer, and the definer's rights made the forged row legitimate.
 *
 * The function now reads `auth.uid()` and execute is granted to
 * `service_role` only. These cases prove both halves, and they would have
 * caught the original implementation.
 */
describe('the join function\'s identity binding', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    await truncateAll();
    resetRateLimits();
  });

  after(async () => {
    await closePool();
    await closeServicePool();
  });

  test('the anon role cannot call the join function at all', async () => {
    // The grant is the defence: an unauthenticated caller has no `auth.uid()`,
    // and a function that creates a participant row must not be reachable
    // without a session.
    //
    // The ACL is read directly rather than through
    // `information_schema.routine_privileges`, because that view reports the
    // privilege as the role would EXERCISE it — including the privileges
    // `PUBLIC` holds — and the question here is which role was granted
    // EXECUTE explicitly.
    const grants = await asOwner<{ grantee: string }>(
      `select a.grantee::regrole::text as grantee
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
        where n.nspname = 'public'
          and p.proname = 'join_event'
          and a.privilege_type = 'EXECUTE'
          and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role')`,
    );

    const grantees = grants.rows.map((row) => row.grantee).sort();

    assert.equal(grantees.includes('anon'), false, 'anon must not be able to join');
    assert.equal(
      grantees.includes('authenticated'),
      false,
      'authenticated must not be able to join directly — that would bypass the rate limiter',
    );
    assert.equal(grantees.includes('service_role'), true);
  });

  test('the old identity-taking signature no longer exists', async () => {
    // `create or replace` only replaces a same-arity function, so the
    // four-argument version would have SURVIVED the rewrite as a second,
    // still-callable function with the impersonation hole intact.
    const rows = await asOwner<{ n: string }>(
      `select count(*)::text as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'join_event'`,
    );

    assert.equal(rows.rows[0]?.n, '1', 'exactly one join_event must exist');
  });

  test('a caller cannot join as somebody else', async () => {
    const created = await createEventViaApi();

    // Two identities. The second one tries to join while presenting the
    // first one's id.
    const first = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Owner' },
    });
    const ownerId = first.headers.get('x-user-id') ?? '';
    assert.ok(ownerId);

    const second = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      userId: ownerId,
      body: { display_name: 'Impostor' },
    });

    // The presented identity is the one that joins, so the second call is the
    // SAME person returning — not a new participant named "Impostor".
    const body = await bodyOf<JoinBody>(second);
    assert.equal(body.created, false, 'the presented identity must be the one that joins');
    assert.equal(body.participant.display_name, 'Owner');
  });

  test('the participant row records the session identity, not a submitted one', async () => {
    const created = await createEventViaApi();

    const response = await call(`/api/invite/${created.token}/join`, {
      method: 'POST',
      body: { display_name: 'Real Person', auth_user_id: '11111111-1111-1111-1111-111111111111' },
    });

    assert.equal(response.status, 200);

    const body = await bodyOf<JoinBody>(response);

    const rows = await asOwner<{ auth_user_id: string; display_name: string }>(
      `select auth_user_id::text, display_name from participant where id = $1`,
      [body.participant.id],
    );

    // The forged id in the body was ignored; the row belongs to the session
    // the server established.
    assert.notEqual(rows.rows[0]?.auth_user_id, '11111111-1111-1111-1111-111111111111');
    assert.equal(rows.rows[0]?.display_name, 'Real Person');
  });

  test('a forged temp event table cannot make an expired invite join', async () => {
    // ★ THE SAME ATTACK CLASS AS `redeem_invite`, DEFENDED THE SAME WAY.
    //
    // `join_event` is `security definer`, and its body is re-parsed on every
    // call — so an unqualified table name could resolve to a caller's temp
    // table. A forged `event` row with a live `invite_token_hash` would make
    // an EXPIRED token join successfully, breaking FR-1.13 in the direction
    // that leaks whether an event exists.
    //
    // The defence is `set search_path = public, extensions, pg_temp` — the
    // real schema first, `pg_temp` last — plus schema-qualifying `public.`
    // on every table reference in the body.
    const created = await createEventViaApi();

    // Expire the real invite.
    await asOwner(
      `update event set invite_expires_at = now() - interval '1 hour' where id = $1`,
      [created.eventId],
    );

    // Forge a temp `event` table carrying a live hash for the same token.
    const forged = await asOwner<{ hash: string }>(
      `select invite_token_hash as hash from event where id = $1`,
      [created.eventId],
    );

    // ★ THE SESSION RUNS AS `service_role`, EXACTLY AS THE SERVER DOES.
    //
    // `join_event`'s execute is granted to `service_role` only, so an
    // `authenticated` session is refused — which is the point, and is
    // asserted separately above. The server sets the CALLER's claims on a
    // service-role connection, so the session here must do the same: the
    // claims carry the identity, and the role carries the permission.
    const session = await openSession(created.userId, { role: 'service' });
    try {
      await session.query(
        `create temp table event (
           id uuid, title text, status text, invite_token_hash text,
           invite_expires_at timestamptz, date_window_start timestamptz,
           date_window_end timestamptz, home_tz text, description text,
           activity_type text, voting_deadline timestamptz, created_by uuid,
           created_at timestamptz, updated_at timestamptz
         )`,
      );
      await session.query(
        `insert into event values (
           $1, 'Forged', 'OPEN', $2, now() + interval '7 days',
           now(), now() + interval '7 days', 'Asia/Tehran', null, 'dinner',
           null, $3, now(), now()
         )`,
        [created.eventId, forged.rows[0]?.hash, created.userId],
      );

      const result = await session.query<{ join_event: { error?: string } }>(
        `select join_event($1, 'Sneaky') as join_event`,
        [created.token],
      );

      // The forged table was NOT consulted: the real invite is expired, so the
      // answer is the generic invalid-link error.
      assert.equal(result.rows[0]?.join_event.error, 'INVITE_INVALID');

      // ★ The temp table is DROPPED. It shadows the real one for the rest of
      // the connection, and leaving it would make every later query in this
      // session fail against a table with the wrong columns.
      await session.query(`drop table event`);
    } finally {
      await closeSession(session);
    }

    // And no participant was created by the attempt.
    const participants = await asOwner<{ n: string }>(
      `select count(*)::text as n from participant where event_id = $1`,
      [created.eventId],
    );
    assert.equal(participants.rows[0]?.n, '1', 'only the organizer should exist');
  });
});
