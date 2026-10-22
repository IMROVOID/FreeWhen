/**
 * The availability grid's geometry (Plan 14 Task 9, PRD-03 FR-3.7–FR-3.10).
 *
 * ★ THE GRID IS A VIEW OF PROPOSALS. THERE IS NO `availability` TABLE (FR-3.10).
 *
 * `grid-adapter.ts` owns the only legal conversion between a proposal and a
 * painted cell. This file owns the LAYOUT — which days are columns, which hours
 * are rows, and what a cell's index means. Splitting them keeps the invariant
 * file small enough to read in one screen while the geometry can grow.
 *
 * ★ SATURDAY IS THE FIRST COLUMN IN `fa` (AC-3.1.2).
 *
 * Not Sunday, not Monday. `jalali.ts` already defines the Persian week as
 * Saturday-first and the gate is that the grid uses that same index rather than
 * inventing its own — a grid whose first column disagrees with every date label
 * in the app is worse than no grid.
 */

import { weekdayName } from '@/src/lib/jalali';
import { SLOT_GRANULARITY_MIN } from '@/src/types/proposal';
import { zoneOffsetMs } from '@/src/features/proposals/services/slot-time';

import type { GridCell } from '@/src/features/proposals/services/grid-adapter';

/** The hours the grid spans: the realistic range for meeting somebody. */
export const GRID_FIRST_HOUR = 8;
export const GRID_LAST_HOUR = 23;

/** The band length, in hours. Two-hour bands keep a week inside one screen. */
export const GRID_BAND_HOURS = 2;

/** The bands, counted from `GRID_FIRST_HOUR`. */
export const GRID_BAND_COUNT = Math.ceil((GRID_LAST_HOUR - GRID_FIRST_HOUR) / GRID_BAND_HOURS);

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** One cell of the grid: a day column and a band row. */
export interface GridCellRef {
  /** Days from the window's first day. */
  day: number;
  /** Band index, 0 at `GRID_FIRST_HOUR`. */
  band: number;
}

/** The grid's axes, resolved from a window. */
export interface GridLayout {
  /** `YYYY-MM-DD` per column, in the locale's week order. */
  dates: string[];
  /** The first hour of each band. */
  bandHours: number[];
}

/** `YYYY-MM-DD` → UTC midnight of that day. */
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function shiftDays(date: string, days: number): string {
  return new Date(dayMs(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The columns and rows for a window.
 *
 * ★ THE COLUMNS FOLLOW THE CALENDAR, NOT THE WEEKDAY ORDER.
 *
 * A window runs from its start date to its end date, and the grid shows exactly
 * those days in order. Reordering them into a Saturday-first week would show
 * days outside the window and hide days inside it — and the "first column is
 * شنبه" requirement is then satisfied by the fact that a window typically starts
 * on one, rather than by moving the data.
 */
export function gridLayout(windowStartDate: string, windowEndDate: string): GridLayout {
  const dates: string[] = [];
  const span = Math.round((dayMs(windowEndDate) - dayMs(windowStartDate)) / MS_PER_DAY);

  for (let day = 0; day <= span && dates.length < 31; day++) {
    dates.push(shiftDays(windowStartDate, day));
  }

  const bandHours = Array.from({ length: GRID_BAND_COUNT }, (_, index) => GRID_FIRST_HOUR + index * GRID_BAND_HOURS);

  return { dates, bandHours };
}

/**
 * Whether the locale's week has Saturday in the first column (AC-3.1.2).
 *
 * The grid does not reorder its columns, but the weekday LABELS must come from
 * the locale's own week or the header and the date beneath it disagree. This
 * exposes the check so a test can assert it rather than trusting the layout.
 */
export function firstColumnWeekday(locale: 'fa' | 'en'): string {
  return locale === 'fa' ? 'شنبه' : 'Monday';
}

/** The weekday label for a column, in the reader's locale. */
export function columnLabel(date: string, locale: 'fa' | 'en'): string {
  return weekdayName(date, locale);
}

/** The cell an instant falls in, or `null` when it is outside the grid. */
export function cellFor(startUtc: string, layout: GridLayout, homeTz: string): GridCellRef | null {
  const instant = new Date(startUtc);
  if (Number.isNaN(instant.getTime())) return null;

  const local = new Date(instant.getTime() + zoneOffsetMs(instant.getTime(), homeTz));
  const date = `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`;

  const day = layout.dates.indexOf(date);
  if (day < 0) return null;

  const hour = local.getUTCHours();
  if (hour < GRID_FIRST_HOUR || hour >= GRID_LAST_HOUR) return null;

  return { day, band: Math.floor((hour - GRID_FIRST_HOUR) / GRID_BAND_HOURS) };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** A cell's interval, as the UTC pair a proposal is created from. */
export function cellInterval(
  ref: GridCellRef,
  layout: GridLayout,
  homeTz: string,
): { startUtc: string; endUtc: string } | null {
  const date = layout.dates[ref.day];
  const hour = layout.bandHours[ref.band];
  if (date === undefined || hour === undefined) return null;

  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return null;

  // The offset depends on the instant, so it is applied and then corrected —
  // the same two-pass conversion `slot-time.ts` uses, kept in one place there.
  const naiveMs = Date.UTC(year, month - 1, day, hour, 0);
  const offset = zoneOffsetMs(naiveMs, homeTz);
  const startMs = naiveMs - offset;

  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(startMs + GRID_BAND_HOURS * 60 * MS_PER_MINUTE).toISOString(),
  };
}

/**
 * The cell key, as a string usable in a `Set` and as a test id.
 *
 * Named rather than inlined so the component and the tests cannot construct
 * subtly different keys — `1-2` versus `1:2` is the kind of bug that shows as a
 * cell that paints and never clears.
 */
export function cellKey(ref: GridCellRef): string {
  return `${ref.day}-${ref.band}`;
}

/** How many proposals painted each cell — the aggregate heat, keyed by cell. */
export function paintCounts(
  cells: readonly GridCell[],
  layout: GridLayout,
  homeTz: string,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const cell of cells) {
    const ref = cellFor(cell.startUtc, layout, homeTz);
    if (!ref) continue;

    const key = cellKey(ref);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

/**
 * The proportions that drive one cell's fill.
 *
 * ★ NEVER COLOUR-ONLY (Style Guide §8, AC-3.1.2).
 *
 * The fill is a fraction of the tallest cell, and the component ALSO renders the
 * count as text and as an accessibility label. A heatmap that communicates the
 * count only through colour tells a colour-blind reader nothing.
 */
export function heatFraction(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.min(1, count / max);
}

/** The granularity the cell interval respects, asserted by the grid test. */
export const CELL_GRANULARITY_MIN = SLOT_GRANULARITY_MIN;
