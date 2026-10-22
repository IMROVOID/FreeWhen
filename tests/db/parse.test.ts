/**
 * The parse endpoint's no-write guarantee (Plan 14 Task 3, PRD-07 G1, AC-7.1.1).
 *
 * ★ THE ASSERTION IS A ROW COUNT, NOT AN IMPORT LIST.
 *
 * `tests/parser/deterministic.test.ts` proves the parser modules have no write
 * path by reading them. This test proves the same thing from the other side: it
 * calls the real route against a real database, confirms candidates came back,
 * and checks that the proposal table is exactly as empty as it was before.
 *
 * The two together are what make AC-7.1.1 structural rather than a claim — a
 * future change that added an insert would fail one of them whichever layer it
 * appeared in.
 *
 * ★ AC-7.2.1 IS THE OTHER HALF.
 *
 * Confirming candidates creates proposals, and confirming two of three creates
 * exactly two. That is achieved by the sheet calling the ordinary create path
 * once per selected candidate, so the assertion here is that N calls produce N
 * rows and no more.
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { asOwner, closePool, seedEvent, truncateAll } from './support';
import { bodyOf, call, prepareServerEnv, prepareServerSql } from './server-support';

interface ParseBody {
  candidates: Array<{
    id: string;
    type: string;
    title: string;
    placeQuery: string | null;
    startUtc: string | null;
    confidence: number;
  }>;
  recognised: boolean;
  limits: { maxChars: number };
}

async function proposalCount(eventId: string): Promise<number> {
  const result = await asOwner<{ count: string }>(
    `select count(*)::text as count from proposal where event_id = $1`,
    [eventId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

/** An event whose window is a few days ahead, so timed candidates are future. */
async function seedOpenEvent() {
  const day = 86_400_000;
  return seedEvent({
    windowStart: new Date(Date.now() + day).toISOString(),
    windowEnd: new Date(Date.now() + 6 * day).toISOString(),
  });
}

describe('AC-7.1.1 — the parse endpoint writes nothing', () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  beforeEach(truncateAll);
  after(closePool);

  test('pasting text yields candidates and creates zero proposals', async () => {
    // Arrange
    const { eventId, organizerId } = await seedOpenEvent();
    const before_ = await proposalCount(eventId);

    // Act
    const response = await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: { text: 'فردا شب ساعت 20 کافه دیدار\nرستوران مرکزی' },
      userId: organizerId,
    });

    // Assert
    assert.equal(response.status, 200);

    const body = await bodyOf<ParseBody>(response);
    assert.ok(body.candidates.length >= 1, 'text produced candidates');
    assert.equal(await proposalCount(eventId), before_, 'no proposal row exists');
    assert.equal(before_, 0);
  });

  test('a second identical parse is still a no-op on the database', async () => {
    const { eventId, organizerId } = await seedOpenEvent();

    await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: { text: 'فردا شب کافه دیدار' },
      userId: organizerId,
    });
    await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: { text: 'فردا شب کافه دیدار' },
      userId: organizerId,
    });

    assert.equal(await proposalCount(eventId), 0);
  });

  test('an oversized paste is refused with the field key, and writes nothing', async () => {
    const { eventId, organizerId } = await seedOpenEvent();

    const response = await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: { text: 'x'.repeat(4001) },
      userId: organizerId,
    });

    assert.equal(response.status, 422);

    const body = await bodyOf<{ fields: Record<string, string> }>(response);
    assert.equal(body.fields.text, 'parser.validation.textTooLong');
    assert.equal(await proposalCount(eventId), 0);
  });

  test('a parse that recognises nothing is a 200 with an empty list (FR-7.9)', async () => {
    const { eventId, organizerId } = await seedOpenEvent();

    const response = await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: { text: 'باشه حتما' },
      userId: organizerId,
    });

    assert.equal(response.status, 200);

    const body = await bodyOf<ParseBody>(response);
    assert.equal(body.candidates.length, 0);
    assert.equal(body.recognised, false, 'a normal outcome, not an error');
  });

  test('a non-participant cannot parse', async () => {
    const { eventId } = await seedOpenEvent();

    const response = await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: { text: 'کافه دیدار' },
      userId: null,
    });

    assert.equal(response.status, 403);
  });

  test('a missing text field is a validation failure, not a crash', async () => {
    const { eventId, organizerId } = await seedOpenEvent();

    const response = await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: {},
      userId: organizerId,
    });

    assert.equal(response.status, 422);
  });
});

describe('AC-7.2.1 — confirming two of three candidates creates exactly two', () => {
  before(() => {
    prepareServerEnv();
  });
  before(prepareServerSql);
  beforeEach(truncateAll);
  after(closePool);

  test('the create path is the only write, and it writes once per confirmation', async () => {
    // Arrange
    //
    // ★ THE WINDOW STARTS AT MIDNIGHT, NOT "24 HOURS FROM NOW".
    //
    // The create path compares INSTANTS against `date_window_start`, so a window
    // beginning at 18:42 rejects an 20:00 slot on the day it opens — correct
    // behaviour, and a distraction from the criterion under test.
    const midnightUtc = (offsetDays: number): string => {
      const at = new Date(Date.now() + offsetDays * 86_400_000);
      at.setUTCHours(0, 0, 0, 0);
      return at.toISOString();
    };

    const windowStart = midnightUtc(1);
    const windowEnd = midnightUtc(6);

    const { eventId, organizerId } = await seedEvent({ windowStart, windowEnd });

    const parsed = await call(`/api/events/${eventId}/parse`, {
      method: 'POST',
      body: { text: 'فردا شب ساعت 20 کافه دیدار\nفردا شب ساعت 21 رستوران مرکزی\nپارک لاله' },
      userId: organizerId,
    });
    const { candidates } = await bodyOf<ParseBody>(parsed);
    assert.equal(candidates.length, 3);
    assert.equal(await proposalCount(eventId), 0, 'the parse itself wrote nothing');

    // The two timed candidates carry a slot; the third is place-only and would
    // need a venue, so confirming it is a different flow and not this criterion.
    const timed = candidates.filter((candidate) => candidate.startUtc !== null);
    const placeOnly = candidates.filter((candidate) => candidate.startUtc === null);
    assert.equal(timed.length, 2);
    assert.equal(placeOnly.length, 1);

    // Act — confirm two of the three.
    //
    // The timed candidates carry a place phrase too, so they are stored as `TIME`
    // here: a `TIME_AND_PLACE` row needs a resolved venue id, and resolving the
    // phrase is the search flow rather than the criterion under test. The end is
    // clamped to the window so a late-evening slot is not rejected for overrunning
    // it — a rule the create path applies and this criterion does not test.
    for (const candidate of timed) {
      const startMs = Date.parse(candidate.startUtc ?? '');
      const endMs = Math.min(startMs + 2 * 60 * 60 * 1000, Date.parse(windowEnd));

      const created = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        body: {
          type: 'TIME',
          title: candidate.title,
          notes: null,
          link: null,
          start_utc: new Date(startMs).toISOString(),
          end_utc: new Date(endMs).toISOString(),
          venue: null,
        },
        userId: organizerId,
      });

      assert.equal(created.status, 201, await created.clone().text());
    }

    // Assert — exactly two, not "at most".
    assert.equal(await proposalCount(eventId), 2);
  });
});
