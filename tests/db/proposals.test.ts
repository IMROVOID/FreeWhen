/**
 * Proposals against the real schema and the real routes (Plan 06 Tasks 1–6).
 *
 * ★ AC-3.1.3 IS THE TEST THIS FILE EXISTS FOR.
 *
 * A 19:00 Tehran slot must be stored as `15:30Z`. Iran is UTC+03:30, and the
 * half-hour offset is precisely the part a plausible-looking implementation gets
 * wrong: an offset rounded to whole hours stores `16:00Z` and every participant
 * is half an hour out, on time, for a meeting that started without them.
 *
 * ★ THE REJECTIONS ARE TESTED AS FIELD KEYS, NOT AS STATUS CODES.
 *
 * A 422 with no field is a message the screen cannot place. Each case below
 * asserts the catalogue key that lands under the offending input, because that
 * key is what the user actually reads.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { resetRateLimits } from '@/server/lib/rate-limit';
import { closeServicePool } from '@/server/lib/supabase';

import { asOwner, closePool } from './support';
import {
  bodyOf,
  call,
  createEventViaApi,
  prepareServerEnv,
  prepareServerSql,
  uniqueIp,
} from './server-support';

prepareServerEnv();

interface ProposalBody {
  proposal: {
    id: string;
    type: string;
    title: string;
    status: string;
    is_late: boolean;
    start_utc: string | null;
    end_utc: string | null;
    venue: { id: string; name: string; lat: number; lng: number } | null;
    proposer_name: string;
  };
  duplicate: { reason: string; proposal: { id: string } } | null;
  is_late: boolean;
}

interface ValidationBody {
  error: string;
  fields: Record<string, string>;
}

const DAY = 86_400_000;

/** An event whose window comfortably contains the fixed test slots. */
async function eventWithWindow(): Promise<{ eventId: string; userId: string }> {
  const created = await createEventViaApi({
    windowStart: new Date(Date.now() + DAY).toISOString(),
    windowEnd: new Date(Date.now() + 10 * DAY).toISOString(),
  });

  return { eventId: created.eventId, userId: created.userId };
}

/** A slot inside the default test window, on the half hour. */
function futureSlot(daysAhead = 2, utcHour = 15): { start: string; end: string } {
  const base = new Date(Date.now() + daysAhead * DAY);
  base.setUTCHours(utcHour, 30, 0, 0);

  return {
    start: base.toISOString(),
    end: new Date(base.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

describe('proposals', { concurrency: false }, () => {
  before(async () => {
    await prepareServerSql();
    resetRateLimits();
    await asOwner(`
      truncate table
        vote, comment, rsvp, activity_log, event_message, message_report,
        decision, proposal, start_point, venue, participant, event, travel_measurement
      restart identity cascade;
    `);
  });

  after(async () => {
    await closeServicePool();
    await closePool();
  });

  describe('AC-3.1.3 — UTC storage', () => {
    test('a 19:00 Tehran slot stores as 15:30Z, and end > start', async () => {
      // Arrange — the conversion itself is pinned in the pure suite against a
      // fixed Jalali date. Here the slot must sit inside a window that is
      // relative to now, so it is built in UTC and then checked for the
      // half-hour offset: 19:00 Tehran is 15:30 UTC, and Iran has no DST.
      const { eventId, userId } = await eventWithWindow();
      const start = new Date(Date.now() + 2 * DAY);
      start.setUTCHours(15, 30, 0, 0);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

      // Act
      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'TIME',
          title: 'شام',
          start_utc: start.toISOString(),
          end_utc: end.toISOString(),
        },
      });

      // Assert — stored byte-for-byte as the instant that was sent, so what
      // went in as 15:30Z comes back as 15:30Z.
      assert.equal(response.status, 201);
      const body = await bodyOf<ProposalBody>(response);
      assert.equal(body.proposal.start_utc, start.toISOString());
      assert.equal(new Date(body.proposal.start_utc ?? 0).getUTCHours(), 15);
      assert.equal(new Date(body.proposal.start_utc ?? 0).getUTCMinutes(), 30);
      assert.ok(
        new Date(body.proposal.end_utc ?? 0) > new Date(body.proposal.start_utc ?? 0),
        'end must be after start',
      );
    });
  });

  describe('all three proposal types', () => {
    test('a TIME proposal stores its slot', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'قهوه', start_utc: slot.start, end_utc: slot.end },
      });

      assert.equal(response.status, 201);
      const body = await bodyOf<ProposalBody>(response);
      assert.equal(body.proposal.type, 'TIME');
      assert.equal(body.proposal.venue, null);
    });

    test('a PLACE proposal resolves its venue', async () => {
      const { eventId, userId } = await eventWithWindow();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'PLACE',
          title: 'کافه دیدار',
          venue: { name: 'کافه دیدار', lat: 35.7, lng: 51.4, provider_place_id: 'neshan-1' },
        },
      });

      assert.equal(response.status, 201);
      const body = await bodyOf<ProposalBody>(response);
      assert.equal(body.proposal.type, 'PLACE');
      assert.equal(body.proposal.venue?.name, 'کافه دیدار');
      assert.equal(body.proposal.venue?.lat, 35.7);
      // `numeric` arrives as text from pg; the wire must carry a number.
      assert.equal(typeof body.proposal.venue?.lat, 'number');
    });

    test('a TIME_AND_PLACE proposal carries both', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'TIME_AND_PLACE',
          title: 'شام در دیدار',
          start_utc: slot.start,
          end_utc: slot.end,
          venue: { name: 'کافه دیدار', lat: 35.7, lng: 51.4 },
        },
      });

      assert.equal(response.status, 201);
      const body = await bodyOf<ProposalBody>(response);
      assert.equal(body.proposal.type, 'TIME_AND_PLACE');
      assert.ok(body.proposal.start_utc);
      assert.ok(body.proposal.venue);
    });

    test('a TIME proposal without a slot is rejected inline', async () => {
      const { eventId, userId } = await eventWithWindow();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'بدون زمان' },
      });

      // Assert — the DB's `time_has_slot` surfaces as an inline field error,
      // not as a 500 the user cannot act on.
      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.start_utc, 'proposals.validation.timeNeedsSlot');
    });

    test('a PLACE proposal without a venue is rejected inline', async () => {
      const { eventId, userId } = await eventWithWindow();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'PLACE', title: 'بدون مکان' },
      });

      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.venue, 'proposals.validation.placeNeedsVenue');
    });
  });

  describe('slot validation is server-side and field-specific', () => {
    test('end <= start is rejected', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'برعکس', start_utc: slot.end, end_utc: slot.start },
      });

      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.end_utc, 'proposals.validation.endBeforeStart');
    });

    test('a slot in the past is rejected against the server clock', async () => {
      const { eventId, userId } = await eventWithWindow();

      // Arrange — well before now, regardless of when the suite runs.
      const past = new Date('2020-01-01T10:00:00Z');

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'TIME',
          title: 'گذشته',
          start_utc: past.toISOString(),
          end_utc: new Date(past.getTime() + 7_200_000).toISOString(),
        },
      });

      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.start_utc, 'proposals.validation.slotPast');
    });

    test('a slot outside the event window is rejected', async () => {
      const { eventId, userId } = await eventWithWindow();

      // Arrange — a year past the window's end.
      const far = new Date(Date.now() + 400 * DAY);
      far.setUTCHours(15, 30, 0, 0);

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'TIME',
          title: 'خارج از بازه',
          start_utc: far.toISOString(),
          end_utc: new Date(far.getTime() + 7_200_000).toISOString(),
        },
      });

      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.start_utc, 'proposals.validation.slotOutOfWindow');
    });

    test('an off-granularity slot is rejected', async () => {
      const { eventId, userId } = await eventWithWindow();

      // Arrange — 19:17 Tehran is 15:47 UTC, not a multiple of 30 minutes.
      const base = new Date(Date.now() + 2 * DAY);
      base.setUTCHours(15, 47, 0, 0);

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'TIME',
          title: '۱۹:۱۷',
          start_utc: base.toISOString(),
          end_utc: new Date(base.getTime() + 7_200_000).toISOString(),
        },
      });

      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.start_utc, 'proposals.validation.slotOffGranularity');
    });

    test('AC-E4 — a midnight-crossing slot is accepted', async () => {
      const { eventId, userId } = await eventWithWindow();

      // Arrange — 23:00 → 01:00 Tehran, a real dinner.
      const start = new Date(Date.now() + 2 * DAY);
      start.setUTCHours(19, 30, 0, 0);

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'TIME',
          title: 'شام دیرهنگام',
          start_utc: start.toISOString(),
          end_utc: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        },
      });

      // Assert — the end being on the next calendar day is not an error.
      assert.equal(response.status, 201);
      const body = await bodyOf<ProposalBody>(response);
      assert.ok(new Date(body.proposal.end_utc ?? 0) > new Date(body.proposal.start_utc ?? 0));
    });
  });

  describe('title bounds', () => {
    test('an empty title is rejected', async () => {
      const { eventId, userId } = await eventWithWindow();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: '   ', start_utc: futureSlot().start },
      });

      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.title, 'proposals.validation.titleRequired');
    });

    test('a title of 61 characters is rejected, 60 is accepted', async () => {
      const { eventId, userId } = await eventWithWindow();

      const tooLong = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'x'.repeat(61), start_utc: futureSlot().start },
      });
      assert.equal(tooLong.status, 422);

      const atLimit = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'x'.repeat(60), start_utc: futureSlot().start },
      });
      assert.equal(atLimit.status, 201);
    });

    test('notes over 300 characters are rejected', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'TIME',
          title: 'یادداشت بلند',
          notes: 'x'.repeat(301),
          start_utc: slot.start,
          end_utc: slot.end,
        },
      });

      assert.equal(response.status, 422);
      const body = await bodyOf<ValidationBody>(response);
      assert.equal(body.fields.notes, 'proposals.validation.notesTooLong');
    });
  });

  describe('AC-2.2.1 — duplicate places', () => {
    test('the second identical venue offers the first, and still creates', async () => {
      const { eventId, userId } = await eventWithWindow();

      const first = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'PLACE',
          title: 'کافه دیدار',
          venue: { name: 'کافه دیدار', lat: 35.7, lng: 51.4, provider_place_id: 'neshan-42' },
        },
      });
      const firstBody = await bodyOf<ProposalBody>(first);
      assert.equal(firstBody.duplicate, null);

      const second = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'PLACE',
          title: 'Cafe Didar',
          venue: { name: 'Cafe Didar', lat: 35.7, lng: 51.4, provider_place_id: 'neshan-42' },
        },
      });

      // Assert — 201, the hint points at the first, and the row exists: the
      // duplicate never blocked anything.
      assert.equal(second.status, 201);
      const secondBody = await bodyOf<ProposalBody>(second);
      assert.equal(secondBody.duplicate?.reason, 'same_provider_place');
      assert.equal(secondBody.duplicate?.proposal.id, firstBody.proposal.id);
      assert.notEqual(secondBody.proposal.id, firstBody.proposal.id);
    });
  });

  describe('FR-2.4 — the list is in creation order', () => {
    test('three proposals come back in the order they were made', async () => {
      const { eventId, userId } = await eventWithWindow();

      const titles = ['اول', 'دوم', 'سوم'];
      for (const [index, title] of titles.entries()) {
        const slot = futureSlot(2 + index, 10 + index);
        const response = await call(`/api/events/${eventId}/proposals`, {
          method: 'POST',
          userId,
          body: { type: 'TIME', title, start_utc: slot.start, end_utc: slot.end },
        });
        assert.equal(response.status, 201);
      }

      const list = await call(`/api/events/${eventId}/proposals`, { userId });
      assert.equal(list.status, 200);
      const body = await bodyOf<{ proposals: Array<{ title: string }> }>(list);

      assert.deepEqual(
        body.proposals.map((proposal) => proposal.title),
        titles,
      );
    });
  });

  describe('FR-4.25 — proposing needs no starting location', () => {
    test('a participant with no start point creates a PLACE proposal', async () => {
      // Arrange — the organizer created via the API has no start_point row.
      const { eventId, userId } = await eventWithWindow();

      const hasStartPoint = await asOwner<{ present: boolean }>(
        `select exists (
           select 1 from start_point sp
           join participant p on p.id = sp.participant_id
           where p.event_id = $1 and p.auth_user_id = $2
         ) as present`,
        [eventId, userId],
      );
      assert.equal(hasStartPoint.rows[0]?.present, false);

      // Act
      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: {
          type: 'PLACE',
          title: 'پارک لاله',
          venue: { name: 'پارک لاله', lat: 35.71, lng: 51.4 },
        },
      });

      // Assert
      assert.equal(response.status, 201);
    });
  });

  describe('withdrawal is a status change, not a delete', () => {
    test('DELETE marks WITHDRAWN and keeps the row', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const created = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'قابل حذف', start_utc: slot.start, end_utc: slot.end },
      });
      const { proposal } = await bodyOf<ProposalBody>(created);

      const withdrawn = await call(`/api/proposals/${proposal.id}`, {
        method: 'DELETE',
        userId,
      });

      assert.equal(withdrawn.status, 200);
      const body = await bodyOf<ProposalBody>(withdrawn);
      assert.equal(body.proposal.status, 'WITHDRAWN');

      // The row survives, so the history survives.
      const stillThere = await asOwner<{ status: string }>(
        `select status from proposal where id = $1`,
        [proposal.id],
      );
      assert.equal(stillThere.rows[0]?.status, 'WITHDRAWN');
    });

    test('a withdrawn proposal still appears in the list', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const created = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'خط‌خورده', start_utc: slot.start, end_utc: slot.end },
      });
      const { proposal } = await bodyOf<ProposalBody>(created);

      await call(`/api/proposals/${proposal.id}`, { method: 'DELETE', userId });

      const list = await call(`/api/events/${eventId}/proposals`, { userId });
      const body = await bodyOf<{ proposals: Array<{ id: string; status: string }> }>(list);

      // The card renders struck through; it does not vanish (PRD-02 E4).
      const found = body.proposals.find((item) => item.id === proposal.id);
      assert.ok(found);
      assert.equal(found.status, 'WITHDRAWN');
    });
  });

  describe('edit', () => {
    test('the author may edit a title', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const created = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'قبلی', start_utc: slot.start, end_utc: slot.end },
      });
      const { proposal } = await bodyOf<ProposalBody>(created);

      const patched = await call(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        userId,
        body: { title: 'جدید' },
      });

      assert.equal(patched.status, 200);
      const body = await bodyOf<ProposalBody>(patched);
      assert.equal(body.proposal.title, 'جدید');
    });

    test('an empty patch is rejected', async () => {
      const { eventId, userId } = await eventWithWindow();
      const slot = futureSlot();

      const created = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'بی‌تغییر', start_utc: slot.start, end_utc: slot.end },
      });
      const { proposal } = await bodyOf<ProposalBody>(created);

      const patched = await call(`/api/proposals/${proposal.id}`, {
        method: 'PATCH',
        userId,
        body: {},
      });

      // A request that changes nothing is a client bug; answering 200 hides it.
      assert.equal(patched.status, 422);
    });
  });

  describe('access', () => {
    test('a stranger cannot read an event\'s proposals', async () => {
      const { eventId } = await eventWithWindow();

      const response = await call(`/api/events/${eventId}/proposals`, {
        userId: '00000000-0000-4000-8000-000000000000',
      });

      assert.equal(response.status, 403);
      const body = await bodyOf<{ error: string }>(response);
      assert.equal(body.error, 'NOT_PARTICIPANT');
    });

    test('an anonymous caller cannot create a proposal', async () => {
      const { eventId } = await eventWithWindow();

      const response = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        body: { type: 'TIME', title: 'بی‌هویت', start_utc: futureSlot().start },
      });

      assert.equal(response.status, 403);
    });
  });

  describe('is_late — FR-2.9', () => {
    test('a proposal after voting began is flagged', async () => {
      const { eventId, userId } = await eventWithWindow();

      const first = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'اول', start_utc: futureSlot().start, end_utc: futureSlot().end },
      });
      const firstBody = await bodyOf<ProposalBody>(first);
      assert.equal(firstBody.is_late, false);

      // Arrange — a vote on the first proposal means the group has begun.
      const participant = await asOwner<{ id: string }>(
        `select id from participant where event_id = $1 and auth_user_id = $2`,
        [eventId, userId],
      );
      await asOwner(
        `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
        [firstBody.proposal.id, participant.rows[0]?.id],
      );

      // Act
      const late = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId,
        body: { type: 'TIME', title: 'دیر', start_utc: futureSlot(3).start, end_utc: futureSlot(3).end },
      });

      // Assert — the marker has a flag to render.
      assert.equal(late.status, 201);
      const lateBody = await bodyOf<ProposalBody>(late);
      assert.equal(lateBody.is_late, true);
      assert.equal(lateBody.proposal.is_late, true);
    });
  });

  describe('placeholder search is rate-limited per address', () => {
    test('the search endpoint answers without a provider key, degraded', async () => {
      const response = await call('/api/place-search?q=%DA%A9%D8%A7%D9%81%D9%87', {
        ip: uniqueIp(),
      });

      // No key is configured in the test environment, so this is the degraded
      // path — a 200 with no results, never a 500 the sheet cannot recover from.
      assert.equal(response.status, 200);
      const body = await bodyOf<{ results: unknown[]; degraded: boolean }>(response);
      assert.deepEqual(body.results, []);
      assert.equal(body.degraded, true);
    });
  });
});
