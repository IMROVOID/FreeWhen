/**
 * gate:i18n — `fa.json` and `en.json` have identical key sets.
 *
 * English is a shipping mode, not a fallback (PRD-10 D11A), so a key that
 * exists in only one catalogue is a shipping defect.
 */

import { join } from 'node:path';

import { PROJECT_ROOT, fail, pass, readFile } from './shared';

const GATE = 'gate:i18n';

const FA_PATH = join(PROJECT_ROOT, 'src', 'i18n', 'fa.json');
const EN_PATH = join(PROJECT_ROOT, 'src', 'i18n', 'en.json');

/** Flattens a nested catalogue into dotted key paths. */
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  const keys: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    keys.push(...flattenKeys(child, path));
  }
  return keys;
}

function readCatalogue(path: string): Record<string, unknown> {
  return JSON.parse(readFile(path)) as Record<string, unknown>;
}

let fa: Record<string, unknown>;
let en: Record<string, unknown>;

try {
  fa = readCatalogue(FA_PATH);
  en = readCatalogue(EN_PATH);
} catch (error) {
  fail(GATE, [`could not read a catalogue: ${(error as Error).message}`]);
}

const faKeys = new Set(flattenKeys(fa));
const enKeys = new Set(flattenKeys(en));

const missingInEn = [...faKeys].filter((key) => !enKeys.has(key)).sort();
const missingInFa = [...enKeys].filter((key) => !faKeys.has(key)).sort();

const failures: string[] = [];

if (missingInEn.length > 0) {
  failures.push(`missing from en.json: ${missingInEn.join(', ')}`);
}
if (missingInFa.length > 0) {
  failures.push(`missing from fa.json: ${missingInFa.join(', ')}`);
}

if (failures.length > 0) fail(GATE, failures);

pass(GATE, `fa.json and en.json share ${faKeys.size} keys`);
