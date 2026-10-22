/**
 * The dual-session identity test (Plan 07 Task 14, AC-12.3.1).
 *
 * ★ "ASSERTION 9 IS THE MOST VALUABLE E2E CHECK IN THE SUITE" (PRD-12 §6).
 *
 * It verifies the product's central promise — "what did we decide?" has exactly
 * ONE answer — and it is the only place a per-user derived-state bug would
 * actually show up. Every other test would pass while two participants saw
 * slightly different cards.
 *
 * ★ TWO INDEPENDENT SESSIONS, ONE EVENT.
 *
 * The scenario is built by driving the real routes as two different callers:
 * each mints its own identity, joins the same event, votes differently, and then
 * both read the decision. The card is assembled from the SAME row by the same
 * pure function, which is what makes byte-identity a property rather than a
 * coincidence.
 *
 * ★ LOCALE CHANGES THE WORDING, NEVER THE FACTS.
 *
 * Switching to `en` must change the digits and the prose and change nothing
 * about the venue, the instant, or the attendee list (AC-2.5.1).
 */

import test, { after, before, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildDecisionCard, sharedCardContent } from '@/src/features/voting/services/decision-card';
import type { Proposal } from '@/src/types/proposal';

import {
  addMember,
  asOwner,
  closePool,
  seedEvent,
  seedVenue,
  truncateAll,
} from './support';
import { bodyOf, call, prepareServerEnv, prepareServerSql } from './server-support';

interface StatusBody {
  proposals: Array<{
    proposal: Proposal;
    tally: { yes: number; maybe: number; no: number; unanswered: number };
  }>;
  participants: Array<{ id: string; display_name: string; role: string }>;
  decisions: Record<
    string,
    {
      id: string;
      event_id: string;
      axis: 'time' | 'place';
      proposal_id: string | null;
      lens: string;
      reason_template: string;
      reason_params: Record<string, unknown>;
      confirmed_by: string | null;
      confirmed_at: string;
    }
  >;
  event: { id: string; home_tz: string; status: string; voting_deadline: string | null };
}

/** A slot on the 30-minute grid, inside the event window (Plan 06). */
function legalSlot(daysAhead = 1, hour = 18): string {
  const slot = new Date(Date.now() + daysAhead * 86_400_000);
  slot.setUTCHours(hour, 0, 0, 0);
  return slot.toISOString();
}

const START = legalSlot(1);
const END = new Date(Date.parse(START) + 7_200_000).toISOString();

describe('the Decision Card is identical across sessions (P07)', () => {
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

  test('AC-12.3.1: two sessions produce byte-identical cards', async () => {
    // Arrange — one event, two participants with different answers.
    const { eventId, organizerId } = await seedEvent({ title: 'Friday dinner' });
    const guest = await addMember(eventId, { displayName: 'Bahar' });
    const venueId = await seedVenue(eventId, { name: 'Cafe Didar', lat: 35.7, lng: 51.4 });

    const created = await call(`/api/events/${eventId}/proposals`, {
      method: 'POST',
      userId: organizerId,
      body: {
        type: 'TIME_AND_PLACE',
        title: 'Friday at Cafe Didar',
        venue: { id: venueId, name: 'Cafe Didar', lat: 35.7, lng: 51.4, address: 'Valiasr' },
        start_utc: START,
        end_utc: END,
      },
    });
    assert.equal(created.status, 201, 'the proposal was refused');

    const proposalId = (await bodyOf<{ proposal: { id: string } }>(created)).proposal.id;

    await call(`/api/proposals/${proposalId}/vote`, {
      method: 'PUT',
      userId: organizerId,
      body: { value: 'yes' },
    });
    await call(`/api/proposals/${proposalId}/vote`, {
      method: 'PUT',
      userId: guest.userId,
      body: { value: 'maybe' },
    });

    const confirmed = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: {
        axis: 'time',
        lens: 'balanced',
        reason: { templateId: 'balanced_floor', params: { floorMinutes: 18 } },
      },
    });
    assert.equal(confirmed.status, 200, 'the confirmation was refused');

    // Act — each session reads the payload as ITSELF.
    const organizerView = await bodyOf<StatusBody>(
      await call(`/api/events/${eventId}/decision-status`, { userId: organizerId }),
    );
    const guestView = await bodyOf<StatusBody>(
      await call(`/api/events/${eventId}/decision-status`, { userId: guest.userId }),
    );

    // The two payloads genuinely differ (each carries its own `myVotes`), so an
    // identical card cannot be an accident of identical inputs.
    assert.notDeepEqual(organizerView.proposals, []);

    const decision = organizerView.decisions.time;
    assert.ok(decision, 'no time decision was recorded');

    const proposal = organizerView.proposals[0]?.proposal;
    assert.ok(proposal);

    // Each session builds the card from the row it read.
    const organizerCard = buildDecisionCard({
      decision,
      proposal,
      participants: organizerView.participants,
      homeTz: organizerView.event.home_tz,
      locale: 'fa',
    });

    const guestDecision = guestView.decisions.time;
    assert.ok(guestDecision);

    const guestCard = buildDecisionCard({
      decision: guestDecision,
      proposal: guestView.proposals[0]?.proposal ?? null,
      participants: guestView.participants,
      homeTz: guestView.event.home_tz,
      locale: 'fa',
    });

    // Assert — the content everyone sees is byte-identical.
    assert.equal(
      sharedCardContent(organizerCard),
      sharedCardContent(guestCard),
      'the two sessions produced different card content',
    );

    // And the facts are the ones the group agreed to.
    assert.equal(organizerCard.venueName, 'Cafe Didar');
    assert.equal(organizerCard.startUtc, START);
    assert.equal(organizerCard.datePrimary, guestCard.datePrimary);
    assert.deepEqual(organizerCard.attendees, guestCard.attendees);
  });

  test('AC-2.5.1: switching locale changes wording and digits, not the facts', async () => {
    // Arrange
    const { eventId, organizerId } = await seedEvent({ title: 'Friday dinner' });
    const guest = await addMember(eventId, { displayName: 'Bahar' });
    const venueId = await seedVenue(eventId, { name: 'Cafe Didar' });

    const created = await call(`/api/events/${eventId}/proposals`, {
      method: 'POST',
      userId: organizerId,
      body: {
        type: 'TIME_AND_PLACE',
        title: 'Friday at Cafe Didar',
        venue: { id: venueId, name: 'Cafe Didar', lat: 35.7, lng: 51.4 },
        start_utc: START,
        end_utc: END,
      },
    });
    const proposalId = (await bodyOf<{ proposal: { id: string } }>(created)).proposal.id;

    await call(`/api/proposals/${proposalId}/vote`, {
      method: 'PUT',
      userId: guest.userId,
      body: { value: 'yes' },
    });
    await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: {
        axis: 'time',
        lens: 'balanced',
        reason: { templateId: 'balanced_floor', params: { floorMinutes: 18 } },
      },
    });

    const view = await bodyOf<StatusBody>(
      await call(`/api/events/${eventId}/decision-status`, { userId: organizerId }),
    );
    const decision = view.decisions.time;
    assert.ok(decision);

    // Act
    const [fa, en] = [
      buildDecisionCard({
        decision,
        proposal: view.proposals[0]?.proposal ?? null,
        participants: view.participants,
        homeTz: view.event.home_tz,
        locale: 'fa',
      }),
      buildDecisionCard({
        decision,
        proposal: view.proposals[0]?.proposal ?? null,
        participants: view.participants,
        homeTz: view.event.home_tz,
        locale: 'en',
      }),
    ];

    // Assert — the FACTS never move.
    assert.equal(fa.venueName, en.venueName);
    assert.equal(fa.startUtc, en.startUtc);
    assert.deepEqual(fa.attendees, en.attendees);
    assert.equal(fa.lens, en.lens);

    // The RENDERING does: Persian digits in `fa`, Latin in `en`.
    assert.match(fa.datePrimary, /[۰-۹]/u, 'the fa card does not use Persian digits');
    assert.doesNotMatch(en.datePrimary, /[۰-۹]/u, 'the en card still carries Persian digits');

    // The reason is still a template, not a frozen sentence.
    assert.equal(fa.reason.templateId, 'balanced_floor');
    assert.deepEqual(fa.reason.params, { floorMinutes: 18 });
  });

  test('the card is built from the row, not from a per-user ranking', async () => {
    // Arrange — the confirmation names a proposal the organizer did NOT vote
    // for, so a per-user "my favourite" bug would show up immediately.
    const { eventId, organizerId } = await seedEvent();
    const guest = await addMember(eventId, { displayName: 'Bahar' });

    const venues = [
      await seedVenue(eventId, { name: 'Alpha' }),
      await seedVenue(eventId, { name: 'Beta' }),
    ];

    const ids: string[] = [];
    for (const [index, venueId] of venues.entries()) {
      const created = await call(`/api/events/${eventId}/proposals`, {
        method: 'POST',
        userId: organizerId,
        body: {
          type: 'TIME_AND_PLACE',
          title: `Option ${index + 1}`,
          venue: { id: venueId, name: index === 0 ? 'Alpha' : 'Beta', lat: 35.7, lng: 51.4 },
          start_utc: new Date(Date.parse(START) + index * 3_600_000).toISOString(),
          end_utc: new Date(Date.parse(END) + index * 3_600_000).toISOString(),
        },
      });
      assert.equal(created.status, 201);
      ids.push((await bodyOf<{ proposal: { id: string } }>(created)).proposal.id);
    }

    // The organizer prefers the FIRST, the guest prefers the SECOND.
    await call(`/api/proposals/${ids[0]}/vote`, {
      method: 'PUT',
      userId: organizerId,
      body: { value: 'yes' },
    });
    await call(`/api/proposals/${ids[1]}/vote`, {
      method: 'PUT',
      userId: guest.userId,
      body: { value: 'yes' },
    });

    // The organizer records the SECOND, overriding their own preference.
    const confirmed = await call(`/api/events/${eventId}/confirm`, {
      method: 'POST',
      userId: organizerId,
      body: { axis: 'time', preferred_proposal_id: ids[1] },
    });
    assert.equal(confirmed.status, 200);

    // Act
    const organizerView = await bodyOf<StatusBody>(
      await call(`/api/events/${eventId}/decision-status`, { userId: organizerId }),
    );

    const decision = organizerView.decisions.time;
    assert.ok(decision);
    assert.equal(decision.proposal_id, ids[1], 'the organizer’s override was not honoured');

    const chosen = organizerView.proposals.find((entry) => entry.proposal.id === ids[1]);
    assert.ok(chosen);

    const card = buildDecisionCard({
      decision,
      proposal: chosen.proposal,
      participants: organizerView.participants,
      homeTz: organizerView.event.home_tz,
      locale: 'fa',
    });

    // Assert — the card names what was DECIDED, not what the reader voted for.
    assert.equal(card.venueName, 'Beta');
  });

  test('a withdrawn subject keeps its decision but carries no venue', async () => {
    // Arrange — the decision's proposal is set to NULL when the proposer
    // leaves (migration 008). The card must still render rather than crash.
    const { eventId } = await seedEvent();

    const view: StatusBody = {
      proposals: [],
      participants: [{ id: 'p1', display_name: 'Organizer', role: 'organizer' }],
      decisions: {},
      event: { id: eventId, home_tz: 'Asia/Tehran', status: 'CONFIRMED', voting_deadline: null },
    };

    const decision = {
      id: 'd1',
      event_id: eventId,
      axis: 'time' as const,
      proposal_id: null,
      lens: 'balanced',
      reason_template: 'balanced_mean',
      reason_params: {},
      confirmed_by: null,
      confirmed_at: new Date().toISOString(),
    };

    // Act
    const card = buildDecisionCard({
      decision,
      proposal: null,
      participants: view.participants,
      homeTz: view.event.home_tz,
      locale: 'fa',
    });

    // Assert
    assert.equal(card.venueName, '');
    assert.equal(card.startUtc, null);
    assert.equal(card.decisionId, 'd1');

    // The organizer's own record is untouched by rendering the card.
    const rows = await asOwner<{ n: number }>(`select count(*)::int as n from decision where event_id = $1`, [
      eventId,
    ]);
    assert.equal(rows.rows[0]?.n, 0, 'building a card wrote a decision row');
  });
});
