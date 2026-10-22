/**
 * Place-phrase extraction for the deterministic parser.
 *
 * ★ A PLACE NEEDS A PLACE WORD.
 *
 * Matching every capitalised word would turn «باشه» ("okay") into a venue. The
 * set below is the category nouns Iranian group chats actually use when naming a
 * meeting point, and the name is taken as the words following the noun until a
 * separator. That is deliberately conservative: a missed place costs one manual
 * entry, while an invented one puts a fake venue in front of the group.
 *
 * ★ FILLER WORDS TERMINATE A NAME, AND THAT IS MOST OF THE WORK.
 *
 * Persian chat attaches the opinion to the place: «کافه دیدار خوبه؟» is a café
 * called «دیدار» plus a question about it, not a place called «دیدار خوبه». A
 * name that swallowed the filler would be searched verbatim, find nothing, and
 * make the parser look broken. The list is small and closed — the words that
 * follow a place noun in a sentence about meeting there — rather than a general
 * part-of-speech guess.
 *
 * Split from `lexicon.ts` so that file stays within the size a reader can hold
 * in one screen; the two are one concern and are always used together.
 */

import type { Match } from './lexicon';

const PLACE_NOUNS = [
  'کافه',
  'رستوران',
  'پارک',
  'سینما',
  'خونه',
  'خانه',
  'دفتر',
  'میدان',
  'خیابان',
  'بازار',
  'پاساژ',
  'فروشگاه',
  'شهربازی',
  'موزه',
  'دانشگاه',
  'باشگاه',
  'تالار',
  'هتل',
  'کتابخانه',
  'cafe',
  'restaurant',
  'park',
  'cinema',
  'mall',
];

const PLACE_FILLER = [
  'خوبه',
  'خوب',
  'خوب است',
  'هست',
  'باشه',
  'بریم',
  'نه',
  'بهتر',
  'عالیه',
  'باحاله',
  'دور',
  'نزدیک',
  'یه',
  'یک',
  'هم',
  'همون',
  'اونجا',
  'اینجا',
];

const PLACE_TERMINATORS = new RegExp(
  `[،,؟?!.\\n]|\\s+(?:${PLACE_FILLER.join('|')}|یا|و|ساعت)(?=\\s|$)`,
);

export interface PlaceMatch extends Match {
  /** The noun that made this a place, so the review can show what matched. */
  noun: string;
}

/** Finds every place phrase, in source order. */
export function findPlaces(text: string): PlaceMatch[] {
  const out: PlaceMatch[] = [];
  const seen = new Set<number>();

  for (const noun of PLACE_NOUNS) {
    const pattern = new RegExp(`(?:^|[^\\p{L}])(${noun}\\s+[^\\d]{1,40})`, 'giu');

    for (const found of text.matchAll(pattern)) {
      const tail = found[1] ?? '';

      // ★ PUNCTUATION IS PART OF THE NAME'S BOUNDARY, NOT ITS TAIL.
      //
      // `[^\d]{1,40}` stops at «؟», so in «کافه دیدار خوبه؟» the captured tail is
      // «کافه دیدار خوبه» with no trailing separator left to cut at — and the
      // terminator pattern therefore never fires. Trimming the punctuation first
      // puts the filler word back in a position where it can terminate the name.
      const candidatesRest = tail.slice(noun.length).replace(/[،,؟?!.\s]+$/u, '');

      const stop = PLACE_TERMINATORS.exec(candidatesRest);
      const name = (stop ? candidatesRest.slice(0, stop.index) : candidatesRest).trim();

      // One character is not a name: «کافه ن» is noise, not a venue.
      if (name.length < 2) continue;

      const index = found.index + (found[0].length - tail.length);
      if (seen.has(index)) continue;
      seen.add(index);

      out.push({ text: `${noun} ${name}`, index, noun });
    }
  }

  return out.sort((a, b) => a.index - b.index);
}
