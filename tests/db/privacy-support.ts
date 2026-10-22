/**
 * Fixtures the privacy suites share (Plan 09).
 *
 * ★ ONE PLACE THAT KNOWS HOW TO BUILD A FULLY-POPULATED EVENT.
 *
 * The cascade, retention and account-deletion tests all need "an event with
 * everything in it". Written once, a schema change that adds a table updates one
 * fixture instead of three tests that would otherwise keep passing while the new
 * table leaks rows.
 */

import { addMember, asOwner, createUser, id, seedEvent } from './support';
import { call } from './server-support';

export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface PopulatedEvent {
  eventId: string;
  organizerParticipantId: string;
  memberParticipantId: string;
  memberUserId: string;
  venueId: string;
  proposalId: string;
  decisionId: string;
}

/**
 * An event with a venue, a proposal, a confirmed decision, two participants
 * each holding a start point, a vote, an RSVP and a comment.
 */
export async function seedPopulatedEvent(
  options: {
    status?: string;
    windowStart?: string;
    windowEnd?: string;
  } = {},
): Promise<PopulatedEvent> {
  const { eventId, organizerParticipantId } = await seedEvent({
    status: options.status ?? 'CONFIRMED',
    windowStart: options.windowStart,
    windowEnd: options.windowEnd,
  });

  const member = await addMember(eventId);

  const venueId = id();
  await asOwner(
    `insert into venue (id, event_id, name, lat, lng) values ($1, $2, 'Venue', 35.7, 51.4)`,
    [venueId, eventId],
  );

  const proposalId = id();
  await asOwner(
    `insert into proposal (id, event_id, created_by, type, title, venue_id)
     values ($1, $2, $3, 'PLACE', 'A place', $4)`,
    [proposalId, eventId, organizerParticipantId, venueId],
  );

  const decisionId = id();
  await asOwner(
    `insert into decision (id, event_id, axis, proposal_id, reason_template, confirmed_by)
     values ($1, $2, 'place', $3, 'balanced_floor', $4)`,
    [decisionId, eventId, proposalId, organizerParticipantId],
  );

  for (const participantId of [organizerParticipantId, member.participantId]) {
    await asOwner(
      `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
       values ($1, 35.7, 51.4, 'gps_coarse')`,
      [participantId],
    );
    await asOwner(
      `insert into vote (proposal_id, participant_id, value) values ($1, $2, 'yes')`,
      [proposalId, participantId],
    );
    await asOwner(
      `insert into rsvp (participant_id, event_id, value) values ($1, $2, 'going')`,
      [participantId, eventId],
    );
    await asOwner(
      `insert into comment (proposal_id, participant_id, body) values ($1, $2, 'a note')`,
      [proposalId, participantId],
    );
  }

  await asOwner(
    `insert into activity_log (event_id, actor_id, action) values ($1, $2, 'voted')`,
    [eventId, organizerParticipantId],
  );

  return {
    eventId,
    organizerParticipantId,
    memberParticipantId: member.participantId,
    memberUserId: member.userId,
    venueId,
    proposalId,
    decisionId,
  };
}

/** How many start points a participant holds. */
export async function startPointCount(participantId: string): Promise<number> {
  const result = await asOwner<{ n: number }>(
    `select count(*)::int as n from start_point where participant_id = $1`,
    [participantId],
  );
  return result.rows[0]?.n ?? 0;
}

/** Adds a start point through the API, as a client does. */
export async function addStartPoint(userId: string, eventId: string): Promise<Response> {
  return call('/api/participants/me/start-point', {
    method: 'PUT',
    userId,
    body: { event_id: eventId, lat: 35.7, lng: 51.4, accuracy_m: 1200, source: 'gps_coarse' },
  });
}

/** Sets the caller's visibility through the API. */
export async function setVisibility(
  userId: string,
  eventId: string,
  participantId: string,
  visibility: 'private' | 'event',
): Promise<Response> {
  return call(`/api/participants/${participantId}/visibility`, {
    method: 'PUT',
    userId,
    body: { event_id: eventId, visibility },
  });
}

/** Deletes the caller's start point through the API. */
export async function deleteStartPointViaApi(userId: string, eventId: string): Promise<Response> {
  return call(`/api/participants/me/start-point?event_id=${eventId}`, {
    method: 'DELETE',
    userId,
  });
}

/** The organiser's auth user id for a seeded event. */
export async function organizerUserId(participantId: string): Promise<string | null> {
  const result = await asOwner<{ auth_user_id: string }>(
    `select auth_user_id from participant where id = $1`,
    [participantId],
  );
  return result.rows[0]?.auth_user_id ?? null;
}

/**
 * Gives a participant a start point, as the API would store it.
 *
 * Used where the point of the test is the deletion or the cascade, not the
 * write path — `addStartPoint` exists for the latter.
 */
export async function giveStartPoint(participantId: string): Promise<void> {
  await asOwner(
    `insert into start_point (participant_id, lat_rounded, lng_rounded, source)
     values ($1, 35.7, 51.4, 'gps_coarse')`,
    [participantId],
  );
}

/** A second, unrelated account with its own live event — the control group. */
export async function seedSurvivorEvent(): Promise<{ userId: string; eventId: string }> {
  const userId = await createUser();
  const { eventId } = await seedEvent({ organizerId: userId });
  return { userId, eventId };
}

/** Counts for every child table of one event, for orphan assertions. */
export async function childRowCounts(event: {
  eventId: string;
  organizerParticipantId: string;
  memberParticipantId: string;
  proposalId: string;
}): Promise<Record<string, number>> {
  const result = await asOwner<Record<string, number>>(
    `select
       (select count(*)::int from start_point where participant_id in ($1, $2)) as start_point,
       (select count(*)::int from participant where event_id = $3) as participant,
       (select count(*)::int from venue where event_id = $3) as venue,
       (select count(*)::int from proposal where event_id = $3) as proposal,
       (select count(*)::int from vote where proposal_id = $4) as vote,
       (select count(*)::int from decision where event_id = $3) as decision,
       (select count(*)::int from comment where proposal_id = $4) as comment,
       (select count(*)::int from rsvp where event_id = $3) as rsvp,
       (select count(*)::int from activity_log where event_id = $3) as activity_log`,
    [event.organizerParticipantId, event.memberParticipantId, event.eventId, event.proposalId],
  );

  return result.rows[0] ?? {};
}
