/**
 * `npm run gate:env` — the build-time variables a shipped bundle needs to WORK.
 *
 * ★ THE SECRET GATES ARE BLIND TO THIS, BY DESIGN.
 *
 * `gate:secrets` looks for a credential that SHOULD NOT be in the bundle. This checks
 * the opposite: a required PUBLIC variable that is MISSING from it. Both matter, one
 * has a loud symptom (a leaked key) and the other has a silent one — a feature that
 * simply does not appear, on every device, with nothing in any log.
 *
 * ★ THIS GATE WOULD NOT HAVE CAUGHT THE BLANK MAP, AND THAT IS WHY IT IS DESCRIBED
 *   NARROWLY.
 *
 * The shipped map was blank while the key was present and CARTO answered `200`; the
 * grid was anchored with a logical inset and drew outside its frame. Claiming this gate
 * prevents that would be a false account of what it does — it prevents a MISSING KEY,
 * which is a real and quiet failure mode of its own (`EXPO_PUBLIC_*` is inlined at build
 * time, so a variable set only on the host produces a bundle with an empty value).
 *
 * ★ IT READS `.env`, AND THE PRODUCTION VALUES ARE CHECKED ON THE DEPLOY PATH.
 *
 * A local `.env` proves the build CAN carry the key; it does not prove the deploy does.
 * `deploy.yml` passes `vars.FREEWHEN_CARTO_API_KEY` into `export-web.sh`, which is the
 * sanctioned writer — see the note there.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './shared';

/** A public variable that a shipped client bundle cannot work without. */
interface RequiredPublicVar {
  name: string;
  /** What breaks, in the user's terms. */
  without: string;
  /** Where the build reads it from, for the failure message. */
  source: string;
}

const REQUIRED: readonly RequiredPublicVar[] = [
  {
    name: 'EXPO_PUBLIC_CARTO_API_KEY',
    without: 'the location picker renders a blank map with no explanation',
    source: 'https://carto.com/developers/basemaps/guides/quickstart/',
  },
];

/** Reads `NAME=value` pairs from `.env`, ignoring comments and blank lines. */
function readDotEnv(): Record<string, string> {
  const path = join(PROJECT_ROOT, '.env');
  if (!existsSync(path)) return {};

  const out: Record<string, string> = {};

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;

    // Strip a single layer of surrounding quotes; `.env` values may be quoted.
    const raw = (match[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
    out[match[1] as string] = raw;
  }

  return out;
}

function main(): number {
  const fileVars = readDotEnv();
  const missing: RequiredPublicVar[] = [];

  for (const variable of REQUIRED) {
    // The environment wins over the file: CI sets it as a real env var.
    const value = process.env[variable.name] ?? fileVars[variable.name] ?? '';

    if (value.trim() === '') {
      missing.push(variable);
      continue;
    }

    // `EXPO_PUBLIC_*` is INLINED at build time, so a value present but empty
    // produces a bundle that requests the unkeyed URL — exactly the shipped bug.
    if (value.trim().length < 8) {
      missing.push(variable);
    }
  }

  if (missing.length > 0) {
    console.error('gate:env: missing public build variables');
    for (const variable of missing) {
      console.error(`  ${variable.name} — without it, ${variable.without}`);
      console.error(`    set it in .env AND on the deploy platform; see ${variable.source}`);
    }
    console.error('');
    console.error('  Vercel:  vercel env add <NAME> production');
    return 1;
  }

  console.log(`gate:env: ${REQUIRED.length} public build variable(s) present`);
  return 0;
}

process.exit(main());
