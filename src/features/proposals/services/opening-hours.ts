/**
 * The opening-hours advisory (Plan 14 Task 6, PRD-03 FR-3.13, AC-3.3.1, E9).
 *
 * ★ ADVISORY ONLY. THIS MODULE NEVER BLOCKS ANYTHING.
 *
 * Iranian venue hours are frequently missing or stale, so blocking a proposal on
 * them blocks a legitimate meeting. Nothing here refuses a slot, disables a
 * button, or filters a card — it answers one question ("does this look closed?")
 * and three states are possible: `unknown`, `closed`, `open`. The caller renders
 * the advisory and carries on.
 *
 * ★ ABSENT HOURS ARE NOT CLOSED (E9, TC-7).
 *
 * `null`, `undefined`, and any shape this module cannot read all resolve to
 * `unknown` — never to `closed` and never to `open`. That is the same rule the
 * engine's `closedBlocks` applies (`openingHours === null` applies no closure);
 * the two agree by construction, and the tests pin them together.
 *
 * ★ TWO HOUR SHAPES EXIST IN THIS REPO, AND THEY ARE NOT THE SAME.
 *
 * | Where | Shape |
 * |---|---|
 * | `src/engine/types.ts` → `OpeningHours` | `{ open: 9, close: 23 }` |
 * | `venue.opening_hours` (jsonb, migration 005) | `{ "mon": ["09:00","23:00"] }` |
 *
 * The engine's type is what the fairness engine consumes. The jsonb is what the
 * database stores and what a proposal's `venue.opening_hours` carries. This
 * module reads the STORED shape, because that is what a proposal card has; it
 * accepts the engine's shape too, so a caller that already converted does not
 * silently get `unknown`.
 */

/** What the advisory can say about a venue at a given instant. */
export type HoursAdvisory = 'open' | 'closed' | 'unknown';

/** The advisory plus the evidence behind it, for the accessibility label. */
export interface HoursVerdict {
  advisory: HoursAdvisory;
  /**
   * The hours the verdict was computed from, when they were readable.
   *
   * `null` for `unknown`. Carried so the caller can name the range it checked
   * (`۱۲:۰۰ تا ۲۳:۳۰`) instead of asserting a bare "probably closed".
   */
  hours: { open: string; close: string } | null;
}

/** The catalogue key each verdict renders (both live under `slots.*`). */
export const ADVISORY_KEY_BY_VERDICT: Record<HoursAdvisory, string> = {
  open: 'slots.advisoryOpen',
  closed: 'slots.advisoryClosed',
  unknown: 'slots.advisoryUnknown',
};

/** The seven day keys the stored jsonb uses, in the order a week runs. */
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

type StoredHours = Partial<Record<(typeof DAY_KEYS)[number], [string, string]>>;

/**
 * A clock time as minutes past midnight, or `null` when unreadable.
 *
 * Accepts `"09:00"`, `"9:00"` and `"23:30"`. A `24:00` close is legal and means
 * midnight. Persian digits are NOT accepted here — the stored jsonb is written
 * by providers and by the seed, both of which use ASCII, and accepting both
 * would make `"۰۹:۰۰"` pass in one place and fail in another.
 */
export function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes > 59) return null;
  if (hours > 24) return null;
  // 24:00 is midnight; 24:30 is nonsense.
  if (hours === 24 && minutes !== 0) return null;

  return hours * 60 + minutes;
}

/** The minutes-past-midnight of `instant` in `homeTz`, plus the local weekday. */
export function localClock(instant: Date, homeTz: string): { minutes: number; day: string } {
  // `Intl` with an explicit zone is the only portable way to ask "what time is
  // it THERE". Iran has had no DST since 2022, but this must not depend on it.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: homeTz,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  // `hour12: false` renders midnight as `24` in some ICU versions; both spellings
  // mean 00:00 and the wrap below handles either.
  const hours = Number(read('hour')) % 24;
  const minutes = Number(read('minute'));

  const weekday = read('weekday').toLowerCase().slice(0, 3);
  const day = DAY_KEYS.includes(weekday as (typeof DAY_KEYS)[number]) ? weekday : 'mon';

  return { minutes: hours * 60 + minutes, day };
}

/** Narrows an unknown jsonb value to the stored day-keyed shape. */
function asStoredHours(value: unknown): StoredHours | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const out: StoredHours = {};
  let readable = 0;

  for (const day of DAY_KEYS) {
    const entry = record[day];
    if (!Array.isArray(entry) || entry.length < 2) continue;

    const open = parseClock(entry[0]);
    const close = parseClock(entry[1]);
    if (open === null || close === null) continue;

    out[day] = [String(entry[0]), String(entry[1])];
    readable += 1;
  }

  // A jsonb object with no readable day is not "closed all week" — it is data
  // this module cannot interpret, which is `unknown`.
  return readable > 0 ? out : null;
}

/** Narrows an unknown value to the engine's `{ open, close }` shape. */
function asEngineHours(value: unknown): { open: number; close: number } | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const { open, close } = record;
  if (typeof open !== 'number' || typeof close !== 'number') return null;
  if (open < 0 || open > 24 || close < 0 || close > 24) return null;

  return { open, close };
}

/** Whether `minutes` sits inside `[open, close)`, handling a midnight crossing. */
function withinWindow(minutes: number, open: number, close: number): boolean {
  if (open < close) return minutes >= open && minutes < close;
  // open === close is a zero-length window, not an all-day one.
  if (open === close) return false;
  // Midnight crossing: `18:00 → 02:00` is open at 23:00 and at 01:00.
  return minutes >= open || minutes < close;
}

/**
 * The advisory verdict for one venue at one instant.
 *
 * `instant` is a `Date` because the caller always has one — a proposal's start,
 * or the slot being picked. `homeTz` is the EVENT's zone, not the device's: an
 * organizer abroad picking a time for Tehran needs Tehran's clock.
 */
export function openingHoursAdvisory(
  storedHours: unknown,
  instant: Date,
  homeTz: string,
): HoursVerdict {
  const stored = asStoredHours(storedHours);
  const engine = asEngineHours(storedHours);
  const { minutes, day } = localClock(instant, homeTz);

  if (engine) {
    // The engine's `open`/`close` are already hours 0–24. Build the display
    // strings from them, and compare the CLOCK in minutes against hours × 60.
    const open = `${String(engine.open).padStart(2, '0')}:00`;
    const close = `${String(engine.close).padStart(2, '0')}:00`;

    return {
      advisory: withinWindow(minutes, engine.open * 60, engine.close * 60)
        ? 'open'
        : 'closed',
      hours: { open, close },
    };
  }

  const today = stored?.[day as (typeof DAY_KEYS)[number]];
  if (!stored || !today) {
    // Hours exist but not for this day. A venue that publishes Monday only is
    // not thereby closed on Tuesday — it is a venue whose Tuesday is unknown.
    return { advisory: 'unknown', hours: null };
  }

  const open = parseClock(today[0]);
  const close = parseClock(today[1]);
  if (open === null || close === null) return { advisory: 'unknown', hours: null };

  return {
    advisory: withinWindow(minutes, open, close) ? 'open' : 'closed',
    hours: { open: today[0], close: today[1] },
  };
}

/**
 * The catalogue key for a proposal's venue at its own start time.
 *
 * ★ `unknown` RESOLVES TO A WORD, NEVER TO A BLANK.
 *
 * `«نامشخص»` (`slots.advisoryUnknown`) is what a proposal with no hours renders.
 * An empty string here would look like a bug and read like "open", which is the
 * one thing absence of hours must never imply.
 */
export function advisoryKeyForProposal(
  venueHours: unknown,
  startUtc: string | null,
  homeTz: string,
): string {
  // A place-only proposal has no time to check. Its hours are still worth
  // stating, so it gets the unknown-or-known answer at "now".
  const instant = startUtc !== null && Number.isFinite(Date.parse(startUtc))
    ? new Date(startUtc)
    : new Date();

  const verdict = openingHoursAdvisory(venueHours, instant, homeTz);
  return ADVISORY_KEY_BY_VERDICT[verdict.advisory];
}
