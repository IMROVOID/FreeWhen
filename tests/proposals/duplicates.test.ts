/**
 * Duplicate place detection (PRD-02 FR-2.7, AC-2.2.1).
 *
 * ★ THE ASSERTION THAT MATTERS MOST IS THE ONE THAT PROVES NOTHING IS BLOCKED.
 *
 * Every other test here checks that the hint fires correctly. The last block
 * checks the property that makes the feature safe: whatever the hint says, the
 * caller is holding data and not a refusal, so creation proceeds.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DUPLICATE_NAME_SIMILARITY,
  DUPLICATE_RADIUS_M,
  findDuplicatePlace,
  haversineMeters,
  nameSimilarity,
  normaliseName,
} from '../../src/features/proposals/services/duplicates';
import type { Proposal, ProposalStatus } from '../../src/types/proposal';

/** A place proposal, as the wire would return it. */
function place(
  options: {
    id?: string;
    name?: string;
    lat?: number;
    lng?: number;
    providerPlaceId?: string | null;
    status?: ProposalStatus;
  } = {},
): Proposal {
  return {
    id: options.id ?? 'p1',
    event_id: 'e1',
    type: 'PLACE',
    title: options.name ?? 'کافه دیدار',
    notes: null,
    link: null,
    status: options.status ?? 'OPEN',
    origin: 'manual',
    is_late: false,
    start_utc: null,
    end_utc: null,
    venue: {
      id: 'v1',
      name: options.name ?? 'کافه دیدار',
      lat: options.lat ?? 35.7,
      lng: options.lng ?? 51.4,
      address: null,
      provider_place_id: options.providerPlaceId ?? null,
      opening_hours: null,
    },
    proposer_id: 'u1',
    proposer_name: 'سارا',
    created_at: '2026-07-01T00:00:00.000Z',
  };
}

describe('AC-2.2.1 — a duplicate is offered, never blocked', () => {
  test('the same provider place id matches regardless of the title', () => {
    // Arrange — same Neshan id, two people typed completely different names.
    const existing = [place({ providerPlaceId: 'neshan-9f2', name: 'کافه دیدار' })];
    const candidate = { name: 'Cafe Didar', lat: 35.7, lng: 51.4, providerPlaceId: 'neshan-9f2' };

    // Act
    const hint = findDuplicatePlace(candidate, existing);

    // Assert — the provider's identifier is authoritative, and no distance was
    // even needed to decide.
    assert.ok(hint);
    assert.equal(hint.reason, 'same_provider_place');
    assert.equal(hint.metres, null);
    assert.equal(hint.proposal.id, 'p1');
  });

  test('a different provider place id does NOT short-circuit', () => {
    // Arrange — two genuinely different Neshan records at the same building.
    const existing = [
      place({ providerPlaceId: 'neshan-aaa', name: 'رستوران شب', lat: 35.7, lng: 51.4 }),
    ];
    const candidate = {
      name: 'کافه دیدار',
      lat: 35.7,
      lng: 51.4,
      providerPlaceId: 'neshan-bbb',
    };

    // Act
    const hint = findDuplicatePlace(candidate, existing);

    // Assert — the ids differ, and the names are not alike, so this is a
    // different venue that merely shares an address.
    assert.equal(hint, null);
  });

  test('a near and similarly named place is a hint', () => {
    // Arrange — ~30 m apart, one name a spelling variant of the other.
    const existing = [place({ name: 'کافه دیدار', lat: 35.7, lng: 51.4 })];
    const candidate = { name: 'کافه‌ی دیدار', lat: 35.7003, lng: 51.4 };

    // Act
    const hint = findDuplicatePlace(candidate, existing);

    // Assert
    assert.ok(hint);
    assert.equal(hint.reason, 'near_and_similar');
    assert.ok((hint.metres ?? 0) < DUPLICATE_RADIUS_M);
  });

  test('a near but differently named place is NOT a hint', () => {
    // Arrange — same coordinates, unrelated names: two shops in one building.
    const existing = [place({ name: 'کافه دیدار', lat: 35.7, lng: 51.4 })];
    const candidate = { name: 'نانوایی سنگک', lat: 35.7, lng: 51.4 };

    // Act
    assert.equal(findDuplicatePlace(candidate, existing), null);
  });

  test('the same name far away is NOT a hint', () => {
    // Arrange — a chain, same name, ~2 km apart.
    const existing = [place({ name: 'کافه دیدار', lat: 35.7, lng: 51.4 })];
    const candidate = { name: 'کافه دیدار', lat: 35.72, lng: 51.4 };

    // Act
    assert.equal(findDuplicatePlace(candidate, existing), null);
  });

  test('a withdrawn proposal is not offered', () => {
    // Arrange — the only match has been withdrawn.
    const existing = [
      place({ name: 'کافه دیدار', lat: 35.7, lng: 51.4, status: 'WITHDRAWN' }),
    ];
    const candidate = { name: 'کافه دیدار', lat: 35.7, lng: 51.4 };

    // Act — there is nothing left to vote on, so there is nothing to offer.
    assert.equal(findDuplicatePlace(candidate, existing), null);
  });

  test('a time proposal is never a place duplicate', () => {
    // Arrange — a TIME proposal has no venue to compare against.
    const existing: Proposal[] = [
      { ...place(), type: 'TIME', venue: null, start_utc: '2026-08-03T15:30:00.000Z' },
    ];
    const candidate = { name: 'کافه دیدار', lat: 35.7, lng: 51.4 };

    // Act
    assert.equal(findDuplicatePlace(candidate, existing), null);
  });

  test('the hint carries data only — creation is always still possible', () => {
    // Arrange
    const existing = [place({ providerPlaceId: 'neshan-9f2' })];
    const candidate = { name: 'کافه دیدار', lat: 35.7, lng: 51.4, providerPlaceId: 'neshan-9f2' };

    // Act
    const hint = findDuplicatePlace(candidate, existing);

    // Assert — the contract the "create anyway" button depends on: the return
    // is a value, not an error, and it does not mutate or consume anything.
    assert.ok(hint);
    assert.ok(!(hint instanceof Error));
    assert.equal(typeof hint.proposal.id, 'string');
    // The existing list is untouched, so a caller may proceed to insert.
    assert.equal(existing.length, 1);
  });
});

describe('geometry', () => {
  test('haversine is zero for an identical point', () => {
    assert.equal(haversineMeters({ lat: 35.7, lng: 51.4 }, { lat: 35.7, lng: 51.4 }), 0);
  });

  test('haversine measures a known short distance', () => {
    // Arrange — 0.0009° of latitude is ~100 m at any longitude.
    const metres = haversineMeters({ lat: 35.7, lng: 51.4 }, { lat: 35.7009, lng: 51.4 });

    // Assert — within a metre of the true value.
    assert.ok(Math.abs(metres - 100) < 1.5, `expected ~100 m, got ${metres}`);
  });

  test('haversine is symmetric', () => {
    const a = { lat: 35.7, lng: 51.4 };
    const b = { lat: 35.72, lng: 51.43 };

    assert.ok(Math.abs(haversineMeters(a, b) - haversineMeters(b, a)) < 1e-6);
  });
});

describe('name similarity', () => {
  test('identical names are 1, and case and spacing do not matter', () => {
    assert.equal(nameSimilarity('کافه دیدار', 'کافه دیدار'), 1);
    assert.equal(nameSimilarity('Cafe Didar', 'cafe  didar'), 1);
  });

  test('a ZWNJ variant is the same word', () => {
    // Persian types the same word with and without the zero-width joiner.
    assert.equal(normaliseName('کافه‌ی دیدار'), normaliseName('کافه ی دیدار'));
    assert.equal(nameSimilarity('کافه‌ی دیدار', 'کافه ی دیدار'), 1);
  });

  test('Arabic yeh and kaf fold to their Persian forms', () => {
    assert.equal(normaliseName('كافي'), normaliseName('کافی'));
  });

  test('unrelated names score below the threshold', () => {
    assert.ok(nameSimilarity('کافه دیدار', 'نانوایی سنگک') < DUPLICATE_NAME_SIMILARITY);
  });

  test('an empty name scores 0 against anything', () => {
    assert.equal(nameSimilarity('', 'کافه دیدار'), 0);
    assert.equal(nameSimilarity('کافه دیدار', ''), 0);
  });

  test('a near-identical name still clears the threshold', () => {
    const score = nameSimilarity('کافه دیدار', 'کافه دیار');
    assert.ok(score > DUPLICATE_NAME_SIMILARITY, `expected > ${DUPLICATE_NAME_SIMILARITY}, got ${score}`);
    assert.ok(score < 1);
  });
});
