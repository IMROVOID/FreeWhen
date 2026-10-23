/**
 * Dealbreakers (Plan 14 Task 4, PRD-02 FR-2.17, OQ-2.2, §4.3).
 *
 * ★ THE BAR, IN TWO ASSERTIONS.
 *
 * 1. Marking a dealbreaker EXCLUDES the venue — through the real engine filter,
 *    not a reimplementation of it.
 * 2. Removing it RESTORES the venue. A veto that cannot be taken back turns one
 *    hasty tap into a permanent, invisible elimination.
 *
 * ★ AND THE ONE THAT IS EASY TO GET WRONG: THE VENUE NEVER DISAPPEARS.
 *
 * An excluded venue stays in the list, muted, with a reason naming the person
 * (P08 rule). The obvious implementation — filter the array and render it —
 * satisfies test 1 and silently violates the rule, so the invariant asserted
 * here is that `resolveDealbreakers` returns exactly as many proposals as it was
 * given.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyHardFilters, suggestionsFor } from '../../src/engine/filters';
import type { ParticipantContext, VenueContext } from '../../src/engine/types';
import {
  dealbreakersByParticipant,
  hasVetoed,
  keptFrom,
  mutedFrom,
  resolveDealbreakers,
  vetoVoteValue,
} from '../../src/features/voting/services/dealbreakers';
import type { Proposal } from '../../src/types/proposal';
import type { VoteValue } from '../../src/types/vote';

const SARA = { id: 'p-sara', name: 'سارا' } as const;
const DARYA = { id: 'p-darya', name: 'دریا' } as const;

function venue(id: string, name: string): VenueContext {
  return {
    id,
    name,
    lat: 35.7,
    lng: 51.4,
    openingHours: null,
    priceLevel: 2,
    venueType: 'cafe',
    accessibility: {
      stepFreeEntrance: 'unknown',
      accessibleRestroom: 'unknown',
      limitedWalkingSuitable: 'unknown',
      source: 'none',
    },
    rating: null,
  };
}

function participant(id: string, name: string): ParticipantContext {
  return {
    id,
    name,
    modes: ['walk'],
    maxTravelMinutes: null,
    walkLimitMinutes: null,
    accessibility: {
      stepFree: 'unknown',
      maxWalkMinutes: null,
      noWalkAloneAfter: null,
    },
  } as unknown as ParticipantContext;
}

/** A proposal carrying a venue, for the resolve tests. */
function proposal(id: string, title: string): Proposal {
  return {
    id,
    event_id: 'e-1',
    type: 'TIME_AND_PLACE',
    title,
    notes: null,
    link: null,
    status: 'OPEN',
    origin: 'manual',
    is_late: false,
    start_utc: '2026-08-05T15:30:00Z',
    end_utc: '2026-08-05T17:30:00Z',
    venue: {
      id: `v-${id}`,
      name: title,
      lat: 35.7,
      lng: 51.4,
      address: null,
      provider_place_id: null,
      opening_hours: null,
    },
    proposer_id: SARA.id,
    proposer_name: SARA.name,
    created_at: '2026-08-01T10:00:00Z',
  };
}

/** A lookup that reports zero travel, so only the dealbreaker can exclude. */
const noTravel = () => ({ minutes: 1, confidence: 'high', source: 'straight_line' }) as never;

describe('the filter excludes a dealbroken venue and names the person', () => {
  test('a dealbreaker hard-excludes the venue with reason dealbreaker', () => {
    const venues = [venue('v-1', 'کافه دیدار'), venue('v-2', 'رستوران مرکزی')];
    const people = [participant(SARA.id, SARA.name), participant(DARYA.id, DARYA.name)];

    const outcome = applyHardFilters(venues, people, noTravel, 19, {
      [SARA.id]: ['v-1'],
    });

    assert.deepEqual(
      outcome.kept.map((entry) => entry.id),
      ['v-2'],
    );

    const exclusion = outcome.excluded.find((entry) => entry.venue.id === 'v-1');
    assert.ok(exclusion, 'the vetoed venue appears in excluded');
    assert.equal(exclusion.reason, 'dealbreaker');
    assert.equal(exclusion.participantId, SARA.id, 'the reason names the person');
  });

  test('a casual no does NOT exclude anything (OQ-2.2)', () => {
    const venues = [venue('v-1', 'کافه دیدار')];
    const people = [participant(SARA.id, SARA.name)];

    // Sara voted `no` but did not veto. The venue survives.
    const casual = dealbreakersByParticipant([
      { proposal_id: 'v-1', participant_id: SARA.id, value: 'no', is_dealbreaker: false },
    ]);

    assert.deepEqual(casual, {}, 'a plain no produces no filter input');

    const outcome = applyHardFilters(venues, people, noTravel, 19, casual);
    assert.deepEqual(
      outcome.kept.map((entry) => entry.id),
      ['v-1'],
    );
  });

  test('the stale flag on a yes vote does not veto', () => {
    // Two separate columns can disagree. The vote is what the participant means.
    const derived = dealbreakersByParticipant([
      { proposal_id: 'v-1', participant_id: SARA.id, value: 'yes', is_dealbreaker: true },
    ]);

    assert.deepEqual(derived, {});
  });

  test('removing the dealbreaker restores the venue', () => {
    const venues = [venue('v-1', 'کافه دیدار')];
    const people = [participant(SARA.id, SARA.name)];

    // Arrange — vetoed.
    const vetoed = dealbreakersByParticipant([
      { proposal_id: 'v-1', participant_id: SARA.id, value: 'no', is_dealbreaker: true },
    ]);
    const blocked = applyHardFilters(venues, people, noTravel, 19, vetoed);
    assert.equal(blocked.kept.length, 0, 'precondition: the venue is excluded');

    // Act — the same vote, flag cleared.
    const cleared = dealbreakersByParticipant([
      { proposal_id: 'v-1', participant_id: SARA.id, value: 'no', is_dealbreaker: false },
    ]);
    const restored = applyHardFilters(venues, people, noTravel, 19, cleared);

    // Assert
    assert.deepEqual(
      restored.kept.map((entry) => entry.id),
      ['v-1'],
      'clearing the veto restores the venue',
    );
    assert.equal(restored.excluded.length, 0);
  });

  test('the engine suggests removing the dealbreaker when everything is vetoed', () => {
    const venues = [venue('v-1', 'کافه دیدار'), venue('v-2', 'رستوران مرکزی')];
    const people = [participant(SARA.id, SARA.name)];

    const outcome = applyHardFilters(venues, people, noTravel, 19, {
      [SARA.id]: ['v-1', 'v-2'],
    });

    assert.equal(outcome.kept.length, 0);
    assert.ok(
      suggestionsFor(outcome.excluded).includes('remove_dealbreaker'),
      'the advice matches the cause',
    );
  });
});

describe('an excluded venue stays visible and muted', () => {
  const proposals = [proposal('pr-1', 'کافه دیدار'), proposal('pr-2', 'رستوران مرکزی')];

  test('every proposal is returned — the count is invariant', () => {
    const resolved = resolveDealbreakers(proposals, [
      { proposalId: 'pr-1', participantId: SARA.id, displayName: SARA.name },
    ]);

    // ★ THE ASSERTION THE RULE RESTS ON.
    assert.equal(resolved.length, proposals.length, 'nothing is dropped');
    assert.deepEqual(
      resolved.map((entry) => entry.proposal.id),
      ['pr-1', 'pr-2'],
      'and the original order survives',
    );
  });

  test('the muted entry carries a reason naming the person', () => {
    const resolved = resolveDealbreakers(proposals, [
      { proposalId: 'pr-1', participantId: SARA.id, displayName: SARA.name },
    ]);

    const muted = mutedFrom(resolved);
    assert.equal(muted.length, 1);
    assert.equal(muted[0]!.proposal.id, 'pr-1');
    assert.equal(muted[0]!.exclusion?.reason, 'dealbreaker');
    assert.equal(muted[0]!.exclusion?.participantName, SARA.name);
    assert.equal(muted[0]!.exclusion?.participantId, SARA.id);
  });

  test('the kept entry has no exclusion', () => {
    const resolved = resolveDealbreakers(proposals, [
      { proposalId: 'pr-1', participantId: SARA.id, displayName: SARA.name },
    ]);

    const kept = keptFrom(resolved);
    assert.deepEqual(
      kept.map((entry) => entry.id),
      ['pr-2'],
    );
    const keptEntry = resolved.find((entry) => entry.proposal.id === 'pr-2');
    assert.equal(keptEntry?.excluded, false);
    assert.equal(keptEntry?.exclusion, null);
  });

  test('kept and muted together reconstruct the input', () => {
    const resolved = resolveDealbreakers(proposals, [
      { proposalId: 'pr-1', participantId: SARA.id, displayName: SARA.name },
    ]);

    const union = [...keptFrom(resolved), ...mutedFrom(resolved).map((entry) => entry.proposal)];
    assert.deepEqual(
      union.map((entry) => entry.id).sort(),
      proposals.map((entry) => entry.id).sort(),
    );
  });

  test('two vetoes on one proposal name the first, and still mute once', () => {
    const resolved = resolveDealbreakers(proposals, [
      { proposalId: 'pr-1', participantId: SARA.id, displayName: SARA.name },
      { proposalId: 'pr-1', participantId: DARYA.id, displayName: DARYA.name },
    ]);

    const muted = mutedFrom(resolved);
    assert.equal(muted.length, 1, 'one muted card, not two');
    assert.equal(muted[0]!.exclusion?.participantName, SARA.name);
  });

  test('with no vetoes every proposal is kept', () => {
    const resolved = resolveDealbreakers(proposals, []);

    assert.equal(keptFrom(resolved).length, 2);
    assert.equal(mutedFrom(resolved).length, 0);
  });
});

describe('the client-side helpers', () => {
  test('hasVetoed reads the list the payload carries', () => {
    assert.equal(hasVetoed(['pr-1'], 'pr-1'), true);
    assert.equal(hasVetoed(['pr-1'], 'pr-2'), false);
    assert.equal(hasVetoed([], 'pr-1'), false);
  });

  test('a veto always writes no', () => {
    // A veto without a `no` would make the tally and the filter disagree.
    assert.equal(vetoVoteValue(), 'no' satisfies VoteValue);
  });

  test('the derived map is keyed by participant, not by proposal', () => {
    const derived = dealbreakersByParticipant([
      { proposal_id: 'pr-1', participant_id: SARA.id, value: 'no', is_dealbreaker: true },
      { proposal_id: 'pr-2', participant_id: DARYA.id, value: 'no', is_dealbreaker: true },
    ]);

    // `applyHardFilters` reads `dealbreakers[member.id]`, so a map keyed by
    // proposal would silently exclude nobody.
    assert.deepEqual(Object.keys(derived).sort(), [DARYA.id, SARA.id].sort());
    assert.deepEqual(derived[SARA.id], ['pr-1']);
    assert.deepEqual(derived[DARYA.id], ['pr-2']);
  });
});
