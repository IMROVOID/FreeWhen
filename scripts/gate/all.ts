/**
 * `npm run gate:all` — all eight release gates, in order, stopping at the first
 * failure (PRD-13 §7).
 *
 * ★ MORE THAN SIX, BECAUSE THERE ARE TWO SHIPPING ARTIFACTS AND A BUILD-TIME ENV.
 *
 * The native bundle and the web bundle are built by different pipelines and one
 * can carry a key the other does not. Before PRD-18 the gates named only
 * `dist/`'s native output, so the web export could have shipped a service-role
 * key that the APK scan would have caught. Both artifacts go to strangers; both
 * get scanned.
 *
 * ★ IT STOPS AT THE FIRST FAILURE AND NAMES IT.
 *
 * Running the gate names after one has failed buries the first — and the first is
 * almost always the cause. The severity is not uniform either: `gate:secrets`
 * and `gate:web` are the two that protect against a credential reaching a
 * stranger's device, and everything after a leak is noise.
 *
 * ★ ORDER IS A DEPENDENCY, NOT A PREFERENCE.
 *
 * The source gates read `src/`, `app/` and `server/`. `gate:web` reads `dist/`,
 * which only exists after `npm run export:web`. So the deploy sequence is:
 *
 *     gates that read source  →  export  →  gate:web  →  rsync
 *
 * This runner covers the two ends of that sequence and cannot cover the middle
 * one — hence `scripts/build/export-web.sh`, which does the export and then
 * calls back in for the last gate.
 *
 * ★ `gate:web` IS SKIPPED, LOUDLY, WHEN `dist/` IS ABSENT.
 *
 * A developer running the gates before ever exporting has not produced a web
 * artifact to scan. Failing there would train everyone to pass `--skip`, which
 * disables the check in the deploy path too. So it is skipped with a line that
 * says what was not checked — and `export-web.sh` never skips it, because it
 * always builds first.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './shared';

/** One gate: the script, and what it protects against. */
interface Gate {
  name: string;
  script: string;
  /** The failure it exists to catch, printed when it fails. */
  protects: string;
  /** Whether it needs a built `dist/` to mean anything. */
  needsDist?: boolean;
}

/**
 * the gate names, in PRD-13 §7's order.
 *
 * The order runs from the most severe failure to the least: a leaked credential
 * first, then a privacy capability, then architectural purity, then the three
 * quality gates, and the bundle scan last because it depends on an artifact.
 */
const GATES: readonly Gate[] = [
  {
    name: 'gate:secrets',
    script: 'scripts/gate/secrets.ts',
    protects: 'a service-role key in the bundle bypasses every RLS policy (AC-8.6.1, AC-13.3.1)',
  },
  {
    name: 'gate:location',
    script: 'scripts/gate/location.ts',
    protects: 'background location is never declared, in app.json or the manifest',
  },
  {
    name: 'gate:engine-purity',
    script: 'scripts/gate/engine-purity.ts',
    protects: 'the engine stays platform-free, so its results are testable without a device',
  },
  {
    name: 'gate:env',
    script: 'scripts/gate/env.ts',
    protects:
      'a required public build variable is present, so the shipped bundle does not silently lose a feature (the map shipped dead without it)',
  },
  {
    name: 'gate:logs',
    script: 'scripts/gate/logs.ts',
    protects: 'no console.log of coordinates, tokens, or pasted text (PRD-08 §15)',
  },
  {
    name: 'gate:design',
    script: 'scripts/gate/design.ts',
    protects: 'no hardcoded colour, radius, spacing, duration or font name',
  },
  {
    name: 'gate:i18n',
    script: 'scripts/gate/i18n.ts',
    protects: 'fa.json and en.json have identical key sets — English is a shipping mode',
  },
  {
    name: 'gate:web',
    script: 'scripts/gate/web.ts',
    protects:
      'the exported web bundle carries no server secret, no sk. token, no .map, no third-party script (AC-18.6.1–3)',
    needsDist: true,
  },
];

/** the gate names, for the tests and the deploy script. */
export const GATE_NAMES: readonly string[] = GATES.map((gate) => gate.name);

const DIST = join(PROJECT_ROOT, 'dist');

/** Runs one gate as a child process, so a gate that exits cannot end this one. */
function run(gate: Gate): { ok: boolean; output: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', gate.script], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    shell: false,
  });

  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function main(): void {
  const skipWeb = process.argv.includes('--skip-web');
  const total = GATES.length;
  let passed = 0;

  for (const [index, gate] of GATES.entries()) {
    const position = `${index + 1}/${total}`;

    if (gate.needsDist && !existsSync(DIST)) {
      console.log(`${position} ${gate.name}: SKIPPED — dist/ does not exist`);
      console.log('       NOT CHECKED: the exported web bundle. Run `npm run export:web`');
      console.log('       and this gate again before anything is published.');
      continue;
    }

    if (gate.needsDist && skipWeb) {
      console.log(`${position} ${gate.name}: SKIPPED — --skip-web`);
      console.log('       NOT A DEPLOYABLE RESULT.');
      continue;
    }

    const outcome = run(gate);

    if (!outcome.ok) {
      console.error(`${position} ${gate.name}: FAILED`);
      console.error(`       protects: ${gate.protects}`);
      if (outcome.output !== '') console.error(outcome.output);
      console.error('');
      console.error(`gate:all stopped at ${gate.name} — the remaining gates were not run.`);
      process.exit(1);
    }

    // The gate's own success line is the detail; reprinting it keeps the log
    // readable without parsing.
    const detail = outcome.output.split(/\r?\n/).pop() ?? '';
    console.log(`${position} ${gate.name}: ${detail}`);
    passed += 1;
  }

  const skipped = total - passed;
  if (skipped > 0) {
    console.log(`gate:all: ${passed}/${total} passed, ${skipped} skipped`);
    // A run with a skipped gate is not a green light for a deploy, and saying
    // so is the difference between a useful gate and a comforting one.
    process.exit(skipWeb || !existsSync(DIST) ? 2 : 0);
  }

  console.log(`gate:all: all ${total} gates passed`);
}

main();
