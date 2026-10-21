/**
 * The ONLY logging path in the app (PRD-10 §6, PRD-08 §15).
 *
 * Coordinates, invite tokens and pasted text must be impossible to log by
 * accident. This module is written before any logging exists, deliberately
 * (PRD-10 §13.6): written first it is a structural property; written last it
 * is a review obligation that will be missed.
 *
 * Three properties make that guarantee real rather than aspirational:
 *
 *  1. **Recursive** — coordinates hide in nested objects, so a shallow pass
 *     would be a false guarantee.
 *  2. **Key matching is normalised** — a coordinate under `Lat`, `user_lat`
 *     or `latLng` is still a coordinate.
 *  3. **String values are scrubbed** — free text is where a pasted
 *     coordinate and a pasted chat message actually live.
 *
 * Redaction must never throw. A crash in the error path is the worst
 * possible failure for a privacy control, so an unreadable value becomes
 * `[UNREADABLE]` rather than an exception.
 */

/** The forbidden key names, in their canonical form. */
const FORBIDDEN_KEYS = [
  'lat',
  'lng',
  'latrounded',
  'lngrounded',
  'latitude',
  'longitude',
  'coordinate',
  'coords',
  'startpoint',
  'accuracym',
  'token',
  'invitetoken',
  'invitetokenhash',
  'authheader',
  'text',
  'pastedtext',
  'body',
  'phone',
  'displayname',
] as const;

/**
 * Key fragments that make a key sensitive regardless of its exact spelling.
 *
 * A coordinate is a coordinate whether the field is called `lat`,
 * `userLat` or `latitude`; an exact-match list of 19 spellings is a false
 * guarantee.
 */
const FORBIDDEN_KEY_TOKENS = [
  'lat',
  'lng',
  'lon',
  'coord',
  'geo',
  'accuracy',
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'authorization',
  'authheader',
  'bearer',
  'credential',
  'phone',
  'text',
  'message',
  'body',
  'content',
  'note',
  'snippet',
  'caption',
  'comment',
  'displayname',
  'fullname',
] as const;

const REDACTED = '[REDACTED]';
const UNREADABLE = '[UNREADABLE]';

/** The maximum recursion depth. A deeper payload is truncated, not crashed. */
const MAX_DEPTH = 12;

/** The maximum number of entries taken from one array or object. */
const MAX_ENTRIES = 500;

type ForbiddenKey = (typeof FORBIDDEN_KEYS)[number];

const FORBIDDEN = new Set<string>(FORBIDDEN_KEYS);

/**
 * Latin lookalikes that survive NFKC.
 *
 * NFKC folds compatibility characters but leaves a Cyrillic `а` as itself,
 * so a key spelled `lаt` would otherwise look nothing like `lat`.
 */
const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ѕ: 's', ј: 'j',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N',
  Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
};

/**
 * Normalises a key so that spelling variations collapse to one form.
 *
 * NFKC defeats full-width and compatibility characters, the confusable fold
 * defeats Cyrillic and Greek lookalikes, lowercasing defeats casing, and
 * stripping `_`/`-`/camelCase boundaries defeats separators.
 */
export function normaliseKey(key: string): string {
  return foldConfusables(key.normalize('NFKC'))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function foldConfusables(input: string): string {
  let out = '';
  for (const character of input) {
    out += CONFUSABLES[character] ?? character;
  }
  return out;
}

/**
 * Whether a key is sensitive.
 *
 * A key is sensitive when it matches a forbidden name, or when it *contains*
 * a forbidden token as a whole word — so `userLat` and `accessToken` are
 * caught while `template` (which contains no whole-word `text`) is not.
 */
export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (FORBIDDEN.has(normalised)) return true;

  // Split the camelCase form into words, so `userLat` yields `user`, `lat`.
  const words = foldConfusables(key.normalize('NFKC'))
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

  return words.some((word) =>
    (FORBIDDEN_KEY_TOKENS as readonly string[]).includes(word),
  );
}

/**
 * Converts Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits
 * to Latin.
 *
 * Persian digits are this app's NORMAL rendering, so a digit-shaped security
 * rule that ignores them cannot see a Persian-rendered coordinate.
 */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * A decimal coordinate pair, in any of the shapes real data arrives in:
 * negative values, 1–7 decimals, comma- or space-separated, and behind a
 * `lat:` / `lng:` label. The digits are normalised to Latin first.
 *
 * The label is consumed as part of the match, so `lat: 35.7000, lng: 51.4000`
 * is removed whole rather than leaving the label behind.
 */
const COORDINATE_PAIR = new RegExp(
  [
    // A labelled pair: `lat: 35.7000, lng: 51.4000`
    '(?:\\blat\\s*[:=]\\s*)?',
    '[-+]?\\d{1,3}\\.\\d{1,7}',
    // A comma, slash or semicolon separator, or plain whitespace.
    '\\s*(?:[,;/]\\s*|\\s+)',
    '(?:\\blng\\s*[:=]\\s*)?(?:\\blon\\s*[:=]\\s*)?',
    '[-+]?\\d{1,3}\\.\\d{1,7}',
  ].join(''),
  'g',
);

/** Degrees, minutes and seconds — `35°41'22"N 51°24'31"E`. */
const COORDINATE_DMS = /\d{1,3}\s*°\s*\d{1,2}\s*['′]\s*\d{1,2}\s*["″]?\s*[NSEW]?/gi;

/** Strips coordinate pairs and DMS coordinates from a free-text field. */
export function redactString(value: string): string {
  const normalised = toLatinDigits(value);
  return normalised
    .replace(COORDINATE_PAIR, REDACTED)
    .replace(COORDINATE_DMS, REDACTED);
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  // A Date is a value, not a bag of properties.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '[INVALID DATE]' : value.toISOString();
  }

  // A Map, Set or Buffer carries its contents in a way `Object.entries` cannot
  // see. Dropping them wholesale is safe; reading them as properties is not.
  if (value instanceof Map || value instanceof Set) {
    return '[COLLECTION]';
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((entry) => redactValue(entry, depth + 1, seen));
  }

  const out: Record<string, unknown> = Object.create(null);

  for (const key of Object.keys(value as Record<string, unknown>)) {
    // `__proto__` is not an own property, and assigning to it would set the
    // prototype of the result rather than create a key.
    if (key === '__proto__') {
      out[key] = REDACTED;
      continue;
    }

    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }

    // Read the descriptor rather than the value: `Object.entries` invokes a
    // getter, and a getter that throws would abort the whole redaction. An
    // unreadable value becomes `[UNREADABLE]` instead.
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      out[key] = UNREADABLE;
      continue;
    }

    if (!('value' in descriptor)) {
      out[key] = UNREADABLE;
      continue;
    }

    try {
      out[key] = redactValue(descriptor.value, depth + 1, seen);
    } catch {
      out[key] = UNREADABLE;
    }
  }

  seen.delete(value);
  return out;
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  return redactValue(obj, 0, new WeakSet<object>()) as Record<string, unknown>;
}

/**
 * `__DEV__` is injected by the React Native bundler. It is absent under plain
 * Node, where the test suite runs, so the flag is read defensively.
 */
const isDev = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__ === true;

/**
 * The single logging entry point. Every call is redacted before it reaches
 * the console.
 */
export function logSafe(event: string, props: Record<string, unknown> = {}): void {
  const safe = redactObject(props);
  if (isDev()) {
    console.log(`[freewhen] ${event}`, safe);
  }
  // The production sink is wired in Phase 12 (analytics_event table). It
  // receives the SAME redacted payload — redaction happens before the
  // dev-only branch, not inside it.
}

export { REDACTED, UNREADABLE };
export type { ForbiddenKey };
