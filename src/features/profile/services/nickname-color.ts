/**
 * A nickname's colour, derived rather than stored (Plan 49 T9).
 *
 * ★ NO COLOUR COLUMN, AND THAT IS THE POINT.
 *
 * The request asks for "a random unique text color each user". Storing one would
 * need a second write path, could disagree between two devices reading an older
 * row, and would have to be re-derived on every rename. Hashing the name gives the
 * same colour on every device, in every event, with no schema and no drift — and
 * two people called "Sara" correctly share a colour, because on screen they are
 * most often the same "Sara" to the reader.
 *
 * ★ FNV-1a, NOT `hashCode()`.
 *
 * A simple polynomial hash clusters: names that differ in one late character land
 * on neighbouring buckets, so "Ali" and "Alia" would collide constantly. FNV-1a
 * avalanches, so a one-character difference moves the index across the palette.
 *
 * ★ THE PALETTE IS THE EXISTING `participantColors`.
 *
 * It is already contrast-checked against both themes (`tests/ui/a11y.test.tsx`
 * re-measures the token pairs), already used for participant marking elsewhere,
 * and using it means a nickname and a map pin for the same person agree.
 */

import { participantColors } from '@/src/theme/tokens';

/**
 * A 32-bit FNV-1a hash of the name, folded for the palette.
 *
 * Case- and space-insensitive so "Sara" and "sara " are the same person, which is
 * what a reader expects: the name is typed by a human and the colour should not
 * depend on how they capitalised it today.
 */
export function nicknameHash(nickname: string): number {
  const normalised = nickname.trim().toLowerCase();

  let hash = 0x811c9dc5;
  for (let index = 0; index < normalised.length; index++) {
    hash ^= normalised.charCodeAt(index);
    // `>>> 0` keeps the multiply in 32-bit unsigned space, which is what makes
    // this reproducible in JS's float arithmetic.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }

  return hash;
}

/** The text colour for a nickname. Deterministic across devices and runs. */
export function colorForNickname(nickname: string): string {
  const index = nicknameHash(nickname) % participantColors.length;
  return participantColors[index] ?? participantColors[0];
}
