/**
 * The fixture verifier.
 *
 * ★ The seed must reproduce the PRD-05 §12A worked example EXACTLY, because
 * the engine tests (Phase 3) and the demo (Phase 12) share one ground truth.
 * A seed that drifts turns the demo's number into an unverifiable claim.
 *
 * This script does not trust the seed: it reads the travel minutes back out
 * of `travel_measurement`, RECOMPUTES the engine's aggregates from them
 * (the same formula the engine uses — `u(m,i) = 100 · max(0, 1 − d/D_max)`,
 * rounded once at the end), and asserts the result against the values
 * published in PRD-05 §12A.
 *
 * It also asserts the load-bearing fixture properties: Darya's 45-minute
 * cap, the exact floor/mean/gap table, and that Balanced picks V2.
 *
 * The travel cache is keyed by GEOGRAPHY, not by participant or venue id
 * (PRD-09 AS9.2 — that is what lets the cache be shared across events), so
 * the read joins origin → start_point → participant and destination → venue.
 */

import { pathToFileURL } from 'node:url';

import { createPool, devDatabaseUrl, loadDotEnv } from './client';

/** The PRD-05 §12A fixture, as published. */
const FIXTURE = {
  participants: [
    { name: 'علی', dMax: 60, minutes: [30, 12, 15] },
    { name: 'بهار', dMax: 60, minutes: [20, 40, 48] },
    { name: 'سیروس', dMax: 60, minutes: [22, 38, 50] },
    { name: 'داریا', dMax: 45, minutes: [35, 22, 28] },
  ],
  venues: ['V1', 'V2', 'V3'],
  /** The floors, means and gaps PRD-05 §12A publishes. */
  expected: {
    floor: [22.22, 33.33, 16.67],
    mean: [50.56, 50.28, 37.36],
    gap: [44.44, 46.67, 58.33],
  },
  /** Balanced picks the higher floor — V2, despite V1's mean advantage. */
  balancedWinner: 'V2',
} as const;

/** Rounds to two decimals, once, at the end. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** The engine's utility function, verbatim from PRD-05 §12A. */
function utility(minutes: number, dMax: number): number {
  return 100 * Math.max(0, 1 - minutes / dMax);
}

interface TravelRow {
  display_name: string;
  modes: string[];
  max_travel_minutes: number;
  minutes: number;
  venue_id: string;
}

async function main(): Promise<void> {
  loadDotEnv();

  const pool = createPool(devDatabaseUrl());
  const failures: string[] = [];

  try {
    // The venues, in the PRD's order. The ids carry the fixture's own
    const venueIds = (
      await pool.query<{ id: string }>(
        `select id from venue
         where provider_place_id in ('neshan-place-1','neshan-place-2','neshan-place-3')
         order by provider_place_id`,
      )
    ).rows.map((row) => row.id);

    if (venueIds.length !== FIXTURE.venues.length) {
      failures.push(
        `expected ${FIXTURE.venues.length} venues, found ${venueIds.length}`,
      );
    }

    // The travel measurements, joined through the start points.
    const rows = (
      await pool.query<TravelRow>(
        `select p.display_name,
                p.modes,
                p.max_travel_minutes,
                tm.minutes,
                v.id as venue_id
           from travel_measurement tm
           join start_point sp
             on abs(sp.lat_rounded - tm.origin_lat) < 0.0001
            and abs(sp.lng_rounded - tm.origin_lng) < 0.0001
           join participant p on p.id = sp.participant_id
           join venue v
             on abs(v.lat - tm.dest_lat) < 0.0001
            and abs(v.lng - tm.dest_lng) < 0.0001`,
      )
    ).rows;

    if (rows.length === 0) {
      failures.push('no travel_measurement rows matched the fixture participants');
    }

    // The matrix of travel minutes, participant × venue.
    const matrix: number[][] = FIXTURE.participants.map(() => venueIds.map(() => NaN));

    for (const row of rows) {
      const pIndex = FIXTURE.participants.findIndex((p) => p.name === row.display_name);
      const vIndex = venueIds.indexOf(row.venue_id);
      if (pIndex < 0 || vIndex < 0) {
        failures.push(`unmatched travel row: ${row.display_name} → ${row.venue_id}`);
        continue;
      }
      matrix[pIndex]![vIndex] = row.minutes;
    }

    // 1. The travel minutes match PRD-05 §12A exactly.
    FIXTURE.participants.forEach((participant, pIndex) => {
      participant.minutes.forEach((expected, vIndex) => {
        const actual = matrix[pIndex]![vIndex];
        if (Number.isNaN(actual)) {
          failures.push(
            `missing travel time for ${participant.name} → ${FIXTURE.venues[vIndex]}`,
          );
          return;
        }
        if (actual !== expected) {
          failures.push(
            `travel time ${participant.name} → ${FIXTURE.venues[vIndex]}: ` +
              `expected ${expected}, got ${actual}`,
          );
        }
      });
    });

    // 2. Darya's cap is 45. This one value is the whole differentiator.
    const darya = FIXTURE.participants[3];
    const daryaRow = (
      await pool.query<{ max_travel_minutes: number }>(
        `select max_travel_minutes from participant where display_name = $1`,
        [darya!.name],
      )
    ).rows[0];

    if (!daryaRow || daryaRow.max_travel_minutes !== 45) {
      failures.push(
        `Darya's max_travel_minutes is ${daryaRow?.max_travel_minutes}, expected 45`,
      );
    }

    // 3. The aggregates, recomputed from the seed's own minutes.
    const floors: number[] = [];
    const means: number[] = [];
    const gaps: number[] = [];

    venueIds.forEach((_, vIndex) => {
      const utilities = FIXTURE.participants.map(
        (participant, pIndex) => utility(matrix[pIndex]![vIndex]!, participant.dMax),
      );

      // Full precision throughout; round ONLY the final aggregate.
      const floor = Math.min(...utilities);
      const mean = utilities.reduce((sum, u) => sum + u, 0) / utilities.length;
      const gap = Math.max(...utilities) - Math.min(...utilities);

      floors.push(round2(floor));
      means.push(round2(mean));
      gaps.push(round2(gap));
    });

    const compare = (label: string, actual: number[], expected: readonly number[]) => {
      expected.forEach((value, index) => {
        if (actual[index] !== value) {
          failures.push(`${label}[${index}]: expected ${value}, got ${actual[index]}`);
        }
      });
    };

    compare('floor', floors, FIXTURE.expected.floor);
    compare('mean', means, FIXTURE.expected.mean);
    compare('gap', gaps, FIXTURE.expected.gap);

    // 4. Balanced picks V2 — the higher floor, over V1's 0.28 mean lead.
    const bestFloor = Math.max(...floors);
    const winnerIndex = floors.indexOf(bestFloor);
    const winner = FIXTURE.venues[winnerIndex];

    if (winner !== FIXTURE.balancedWinner) {
      failures.push(
        `Balanced picks ${winner}, expected ${FIXTURE.balancedWinner}`,
      );
    }
  } finally {
    await pool.end();
  }

  if (failures.length > 0) {
    console.error('db:verify-fixture FAILED');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log('db:verify-fixture: the seed reproduces the PRD-05 §12A example exactly');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Not `await main()` at the top level: tsx compiles this file as CommonJS
  // here, and a top-level await is not supported in that output format.
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
