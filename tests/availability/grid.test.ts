/**
 * The availability grid's geometry and one-dataset rule
 * (Plan 14 Task 9, PRD-03 FR-3.7–FR-3.10, AC-3.1.2, AC-3.2.1).
 *
 * ★ THE FIXED POINT IS THE WHOLE TEST.
 *
 * If `cellFor` and `cellInterval` ever stop being inverses, the grid has begun
 * deriving its own truth somewhere — and the user then sees two answers to "when
 * can people meet?" with no way to tell which one is lying.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  GRID_BAND_COUNT,
  GRID_BAND_HOURS,
  GRID_FIRST_HOUR,
  cellFor,
  cellInterval,
  cellKey,
  columnLabel,
  firstColumnWeekday,
  gridLayout,
  heatFraction,
  paintCounts,
} from '../../src/features/availability/grid-geometry';
import { proposalsToGrid } from '../../src/features/proposals/services/grid-adapter';
import type { Proposal } from '../../src/types/proposal';

const HOME_TZ = 'Asia/Tehran';

/** A week starting Saturday 2026-08-01 (which is a Saturday). */
const LAYOUT = gridLayout('2026-08-01', '2026-08-07');

function proposal(
  options: { id?: string; startUtc?: string | null; endUtc?: string | null } = {},
): Proposal {
  return {
    id: options.id ?? 'p1',
    event_id: 'e1',
    type: 'TIME',
    title: 'شام',
    notes: null,
    link: null,
    status: 'OPEN',
    origin: 'manual',
    is_late: false,
    start_utc: options.startUtc === undefined ? '2026-08-01T15:30:00.000Z' : options.startUtc,
    end_utc: options.endUtc === undefined ? '2026-08-01T17:30:00.000Z' : options.endUtc,
    venue: null,
    proposer_id: 'u1',
    proposer_name: 'سارا',
    created_at: '2026-07-01T00:00:00.000Z',
  };
}

describe('layout', () => {
  test('a one-week window yields seven columns, in calendar order', () => {
    assert.equal(LAYOUT.dates.length, 7);
    assert.equal(LAYOUT.dates[0], '2026-08-01');
    assert.equal(LAYOUT.dates[6], '2026-08-07');
  });

  test('the bands start at the first grid hour and step by the band size', () => {
    assert.equal(LAYOUT.bandHours.length, GRID_BAND_COUNT);
    assert.equal(LAYOUT.bandHours[0], GRID_FIRST_HOUR);
    assert.equal(LAYOUT.bandHours[1], GRID_FIRST_HOUR + GRID_BAND_HOURS);
  });

  test('a window longer than a month is capped rather than rendered whole', () => {
    const long = gridLayout('2026-01-01', '2026-06-01');

    assert.equal(long.dates.length, 31);
  });

  test('AC-3.1.2 — the fa week starts on شنبه', () => {
    assert.equal(firstColumnWeekday('fa'), 'شنبه');
  });

  test('a Saturday column labels as شنبه in fa (AC-3.1.2)', () => {
    assert.equal(columnLabel('2026-08-01', 'fa'), 'شنبه');
  });

  test('the same column labels as Saturday in en — one dataset, two languages', () => {
    assert.equal(columnLabel('2026-08-01', 'en'), 'Saturday');
  });
});

describe('cell ↔ interval', () => {
  test('a proposal lands in the cell that produced its interval', () => {
    // Arrange
    const ref = { day: 0, band: 6 };

    // Act
    const interval = cellInterval(ref, LAYOUT, HOME_TZ);
    assert.ok(interval);

    // Assert — the round trip is identity
    assert.deepEqual(cellFor(interval.startUtc, LAYOUT, HOME_TZ), ref);
  });

  test('FIXED POINT — every cell round-trips through its own interval', () => {
    for (let day = 0; day < LAYOUT.dates.length; day++) {
      for (let band = 0; band < GRID_BAND_COUNT; band++) {
        const ref = { day, band };
        const interval = cellInterval(ref, LAYOUT, HOME_TZ);

        assert.ok(interval, `cell ${cellKey(ref)} must have an interval`);
        assert.deepEqual(cellFor(interval.startUtc, LAYOUT, HOME_TZ), ref, `cell ${cellKey(ref)}`);
      }
    }
  });

  test('a cell interval is exactly one band long', () => {
    const interval = cellInterval({ day: 0, band: 6 }, LAYOUT, HOME_TZ);
    assert.ok(interval);

    const minutes = (Date.parse(interval.endUtc) - Date.parse(interval.startUtc)) / 60_000;

    assert.equal(minutes, GRID_BAND_HOURS * 60);
  });

  test('an instant outside the window has no cell', () => {
    assert.equal(cellFor('2026-09-01T15:30:00.000Z', LAYOUT, HOME_TZ), null);
  });

  test('an instant outside the grid hours has no cell', () => {
    // 02:00 Tehran is before the grid's first band.
    assert.equal(cellFor('2026-07-31T22:30:00.000Z', LAYOUT, HOME_TZ), null);
  });

  test('a malformed instant yields null rather than throwing', () => {
    assert.equal(cellFor('not-a-date', LAYOUT, HOME_TZ), null);
  });
});

describe('ONE_DATASET — the heat is computed from proposals, never stored (FR-3.10)', () => {
  test('AC-3.2.1 — three proposals painted in one cell count as three', () => {
    // Arrange — three participants each offered the same slot
    const proposals = [
      proposal({ id: 'a' }),
      proposal({ id: 'b' }),
      proposal({ id: 'c' }),
    ];

    // Act
    const counts = paintCounts(proposalsToGrid(proposals), LAYOUT, HOME_TZ);

    // Assert
    assert.equal(counts.size, 1, 'one painted cell');
    assert.equal([...counts.values()][0], 3);
  });

  test('a withdrawn proposal stops counting', () => {
    const proposals = [
      proposal({ id: 'a' }),
      { ...proposal({ id: 'b' }), status: 'WITHDRAWN' as const },
    ];

    const counts = paintCounts(proposalsToGrid(proposals), LAYOUT, HOME_TZ);

    assert.equal([...counts.values()][0], 1);
  });

  test('a place-only proposal paints nothing', () => {
    const place = proposal({ startUtc: null, endUtc: null });

    assert.deepEqual(proposalsToGrid([place]), []);
    assert.equal(paintCounts(proposalsToGrid([place]), LAYOUT, HOME_TZ).size, 0);
  });

  test('the geometry module declares no availability table of its own', () => {
    // The invariant is structural: a file that names such a table has begun the
    // second store, whatever its queries currently do.
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'availability', 'grid-geometry.ts'),
      'utf8',
    );

    assert.ok(!/availability\s*\(/.test(source), 'no availability table reference');
    assert.ok(!/insert|upsert|update\s+set|delete from/i.test(source), 'geometry writes nothing');
  });
});

describe('heat', () => {
  test('the fullest cell is the full fill', () => {
    assert.equal(heatFraction(5, 5), 1);
  });

  test('an unpainted cell has no fill', () => {
    assert.equal(heatFraction(0, 5), 0);
  });

  test('a grid with nothing painted has no division by zero', () => {
    assert.equal(heatFraction(0, 0), 0);
  });

  test('the fill is proportional, never over 1', () => {
    assert.equal(heatFraction(3, 6), 0.5);
    assert.ok(heatFraction(9, 6) <= 1);
  });
});
