/**
 * Text normalisation and phrase extraction for the deterministic parser.
 *
 * ★ PERSIAN AND LATIN NUMERALS BOTH PARSE (plan, Persian numeral handling).
 *
 * Every extraction runs on normalised text where `۰۱۲۳` has already become
 * `0123` and the two Arabic-script forms of `ي` and `ك` have become their
 * Persian counterparts. Normalising once, before any pattern runs, is what stops
 * a second pattern from being written for the Latin form — the failure mode
 * where one code path works and the other silently returns nothing.
 *
 * ★ THIS FILE EXTRACTS PHRASES. IT DOES NOT DECIDE WHAT THEY MEAN.
 *
 * `deterministic.ts` turns these phrases into instants and candidates. Keeping
 * the Sanskrit-free lexical work here means the date arithmetic can be tested
 * without a fixture full of Persian prose.
 */

/** A span of the normalised text, with the index it started at. */
export interface Match {
  /** The matched substring. */
  text: string;
  index: number;
}

/** Persian and Arabic-Indic digits, mapped to Latin. */
const DIGIT_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

/**
 * Normalises a pasted message for matching.
 *
 * Digit folding, `ي`/`ك` folding, ZWNJ → space, and the Arabic thousands
 * separator `٬` dropped. Whitespace is collapsed so a phrase spanning a wrapped
 * line still matches. Newlines are preserved as single newlines: a message
 * boundary is meaningful, and collapsing it would let a place from one message
 * attach to a time in the next.
 */
export function normaliseText(input: string): string {
  return input
    .replace(/[۰-۹٠-٩]/g, (digit) => DIGIT_MAP[digit] ?? digit)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .replace(/٬/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** Splits normalised text into message-sized chunks. */
export function splitMessages(input: string): string[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The Persian and English weekday names, indexed the way `jalali.ts` indexes
 * them: **0 = Saturday**.
 *
 * Both scripts are present so an English-language group chat parses with the
 * same resolver. A parser that only knew Persian would be half a feature in
 * `en` mode, which is a shipping mode (PRD-10 D11A).
 */
export const WEEKDAY_NAMES: ReadonlyArray<{ index: number; names: string[] }> = [
  { index: 0, names: ['شنبه', 'shabe', 'shanbe', 'saturday'] },
  { index: 1, names: ['یکشنبه', 'یک شنبه', 'yekshanbe', 'sunday'] },
  { index: 2, names: ['دوشنبه', 'دو شنبه', 'doshanbe', 'monday'] },
  { index: 3, names: ['سه شنبه', 'seshanbe', 'tuesday'] },
  { index: 4, names: ['چهارشنبه', 'چهار شنبه', 'chaharshanbe', 'wednesday'] },
  { index: 5, names: ['پنجشنبه', 'پنج شنبه', 'panjshanbe', 'thursday'] },
  { index: 6, names: ['جمعه', 'jome', 'jomeh', 'friday'] },
];

/** The Jalali month names, indexed 1–12. `Esfand` is the boundary case (E9). */
export const MONTH_NAMES: ReadonlyArray<{ index: number; names: string[] }> = [
  { index: 1, names: ['فروردین', 'farvardin'] },
  { index: 2, names: ['اردیبهشت', 'ordibehesht'] },
  { index: 3, names: ['خرداد', 'khordad'] },
  { index: 4, names: ['تیر', 'tir'] },
  { index: 5, names: ['مرداد', 'mordad'] },
  { index: 6, names: ['شهریور', 'shahrivar'] },
  { index: 7, names: ['مهر', 'mehr'] },
  { index: 8, names: ['آبان', 'aban'] },
  { index: 9, names: ['آذر', 'azar'] },
  { index: 10, names: ['دی', 'dey'] },
  { index: 11, names: ['بهمن', 'bahman'] },
  { index: 12, names: ['اسفند', 'esfand'] },
];

/** The relative-day words the parser understands. */
const RELATIVE_DAYS: ReadonlyArray<{ offset: 1 | 2; names: string[] }> = [
  { offset: 1, names: ['فردا', 'tomorrow'] },
  { offset: 2, names: ['پس فردا', 'پس فردا', 'پس‌فردا', 'day after tomorrow'] },
];

/** A phrase the parser found, with what it was. */
export interface PhraseMatch extends Match {
  kind: 'time' | 'weekday' | 'relativeDay' | 'monthDay';
}

/**
 * The relative-day phrase, when one appears.
 *
 * Read before the weekday scan: «فردا» is more specific than «جمعه», and a
 * message containing both means tomorrow.
 */
export function findRelativeDay(text: string): { offset: 1 | 2; match: Match } | null {
  for (const entry of RELATIVE_DAYS) {
    for (const name of entry.names) {
      const index = text.indexOf(name);
      if (index >= 0) {
        return { offset: entry.offset, match: { text: name, index } };
      }
    }
  }
  return null;
}

/** The weekday phrase, when one appears. `index` is 0 = Saturday. */
export function findWeekday(text: string): { index: number; match: Match } | null {
  for (const entry of WEEKDAY_NAMES) {
    for (const name of entry.names) {
      // Word-bounded for the Latin forms: `saturdayish` is not a weekday, and a
      // substring match would fire on it.
      const pattern = /^[a-z ]+$/i.test(name)
        ? new RegExp(`\\b${name}\\b`, 'i')
        : null;

      const found = pattern ? pattern.exec(text) : null;
      if (found) {
        return { index: entry.index, match: { text: found[0], index: found.index } };
      }

      if (!pattern) {
        const index = text.indexOf(name);
        if (index >= 0) return { index: entry.index, match: { text: name, index } };
      }
    }
  }
  return null;
}

/** A Jalali month and day read from the text, e.g. «۱۲ اسفند». */
export function findMonthDay(text: string): { month: number; day: number; match: Match } | null {
  for (const entry of MONTH_NAMES) {
    for (const name of entry.names) {
      const pattern = new RegExp(`(\\d{1,2})\\s*${name}`, 'i');
      const found = pattern.exec(text);
      if (found) {
        const day = Number(found[1]);
        if (day >= 1 && day <= 31) {
          return { month: entry.index, day, match: { text: found[0], index: found.index } };
        }
      }
    }
  }
  return null;
}

/**
 * A time of day: `19`, `19:00`, `7 شب`, `ساعت 8`, `۸ عصر`.
 *
 * ★ THE MERIDIEM WORDS DECIDE THE AMPLITUDE, AND THEY ARE PERSIAN FIRST.
 *
 * «شب» and «عصر» push an hour of 1–11 into the evening; «صبح» pulls a 12 into
 * the morning. This is the difference between 07:00 and 19:00 for a group that
 * wrote «۷ شب» — and getting it wrong produces a candidate that is plausible,
 * ordered, in-window and completely wrong.
 */
export interface TimeMatch extends Match {
  hour: number;
  minute: number;
}

const MERIDIEM_PM = ['شب', 'عصر', 'بعدازظهر', 'بعد از ظهر', 'evening', 'pm'];
const MERIDIEM_AM = ['صبح', 'بامداد', 'ظهر', 'morning', 'am'];

/** The evening default when a message names «شب» but no hour. */
const EVENING_DEFAULT_HOUR = 20;

/**
 * Finds every plausible time of day, in source order.
 *
 * ★ TWO PATTERNS, BECAUSE A TIME HAS TWO SHAPES IN PERSIAN CHAT.
 *
 * «ساعت ۱۹:۰۰» puts digits first and the meridiem word second; «شب» on its own
 * after a day («جمعه شب») puts the meridiem word first with no digits at all.
 * One regex cannot read both without a lookbehind that Node and Hermes disagree
 * about, so the digit-led form is matched first and the standalone evening word
 * second. The second yields 20:00, which is what «فردا شب» means.
 *
 * ★ A BARE NUMBER IS ONLY A TIME WHEN IT LOOKS LIKE ONE.
 *
 * `8` on its own could be «۸ نفر» (eight people) or a Jalali day, and treating
 * it as 08:00 puts an invented slot in front of the group. Only an explicit
 * `HH:MM`, a meridiem word, or the clock word «ساعت» makes a number a time.
 */
export function findTimes(text: string): TimeMatch[] {
  const out: TimeMatch[] = [];
  const claimed = new Set<number>();

  const digitLed = /(\d{1,2})(?::(\d{2}))?\s*(شب|عصر|بعدازظهر|بعد از ظهر|صبح|بامداد|ظهر|evening|morning|pm|am)?/gi;

  for (const found of text.matchAll(digitLed)) {
    const rawHour = Number(found[1]);
    const rawMinute = found[2] === undefined ? 0 : Number(found[2]);
    const meridiem = (found[3] ?? '').toLowerCase();

    if (rawMinute > 59 || rawHour > 23) continue;

    const index = found.index;
    const before = text.slice(Math.max(0, index - 8), index);

    const hasColon = found[2] !== undefined;
    const hasMeridiem = meridiem !== '';
    const hasClockWord = /ساعت\s*$/i.test(before);

    if (!hasColon && !hasMeridiem && !hasClockWord) continue;

    let hour = rawHour;

    if (meridiem === 'ظهر') {
      // Noon, not midnight — and not 12 + 12.
      hour = 12;
    } else if (MERIDIEM_PM.some((word) => meridiem.startsWith(word))) {
      if (hour < 12) hour += 12;
    } else if (MERIDIEM_AM.some((word) => meridiem.startsWith(word))) {
      if (hour === 12) hour = 0;
    }

    claimed.add(index);
    out.push({ text: found[0].trim(), index, hour, minute: rawMinute });
  }

  // ★ THE STANDALONE EVENING WORD IS A FALLBACK, NOT A COMPETITOR.
  //
  // «جمعه شب» names no hour, but it does name evening — and a candidate that
  // quietly became an all-day place proposal would lose the half of the message
  // the group actually said. 20:00 is the evening default, named here rather
  // than as a literal at the call site.
  //
  // It yields to ANY explicit time in the same message, whichever side of the
  // word it sits on: «فردا شب ساعت 19:30» is 19:30, not 20:00. That guard is the
  // whole reason this is a second pass rather than a second alternative inside
  // the first pattern.
  if (out.length > 0) return out.sort((a, b) => a.index - b.index);

  const standalone = /(^|\s)(شب|عصر)(?=\s|$)/g;
  for (const found of text.matchAll(standalone)) {
    const index = found.index + (found[0].length - (found[2] ?? '').length);
    if (claimed.has(index)) continue;

    claimed.add(index);
    out.push({ text: found[2] ?? '', index, hour: EVENING_DEFAULT_HOUR, minute: 0 });
  }

  return out.sort((a, b) => a.index - b.index);
}


/** The first sentence of a message, trimmed to a proposal title's length. */
export function titleFrom(message: string, fallback: string, maxLength = 60): string {
  const firstClause = message.split(/[،,؟?!.\n]/)[0]?.trim() ?? '';
  const candidate = firstClause.length > 0 ? firstClause : message.trim();
  const title = candidate.length > 0 ? candidate : fallback;

  return title.length > maxLength ? `${title.slice(0, maxLength - 1)}…` : title;
}
