/**
 * Regenerates `server/sql/index.ts` from the `.sql` files beside it.
 *
 * ★ THE `.sql` FILES ARE THE SOURCE OF TRUTH. THIS FILE IS A COMPILER.
 *
 * A developer edits `server/sql/join_event.sql` exactly as before. The inlined
 * module exists only so the bundled server needs no filesystem — it is a build
 * artifact committed to the tree, the same way a generated client is.
 *
 * ★ RUN IT VIA `npm run gen:server-sql`, THEN COMMIT BOTH FILES.
 *
 * `tests/server/server-sql.test.ts` fails when they disagree, so a forgotten
 * regeneration is a red suite rather than a deployed server running stale SQL.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// `scripts/` sits directly under the repo root, so one level up, not two.
const SQL_DIR = join(HERE, '..', 'server', 'sql');
const OUT = join(SQL_DIR, 'index.ts');

const files = readdirSync(SQL_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  process.stderr.write('gen:server-sql: no .sql files found in server/sql\n');
  process.exit(1);
}

/** A JS string literal for arbitrary SQL, by JSON-escaping and re-wrapping. */
function literal(sql: string): string {
  // JSON.stringify escapes quotes, backslashes and newlines correctly for a
  // double-quoted JS string, which is the whole requirement here.
  return JSON.stringify(sql);
}

const header = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source of truth: the \`.sql\` files in this directory.
 * Regenerate with: \`npm run gen:server-sql\`
 *
 * ★ WHY THIS EXISTS.
 *
 * \`server/lib/server-sql.ts\` used to read these files from disk. A host with no
 * filesystem (Cloudflare Workers) could not start the server at all, for the
 * sake of one constant. The SQL is inlined here so the server bundles without
 * \`node:fs\`, and \`tests/server/server-sql.test.ts\` fails if this copy drifts
 * from the \`.sql\` files.
 */

/** The inlined statements, keyed by the \`.sql\` filename they came from. */
export const SERVER_SQL: Readonly<Record<string, string>> = {
`;

const body = files
  .map((file) => `  ${JSON.stringify(file)}: ${literal(readFileSync(join(SQL_DIR, file), 'utf8'))},`)
  .join('\n');

const footer = `
};

/**
 * The inlined filenames, in apply order.
 *
 * Mirrors the old \`readdirSync(...).sort()\` so the apply order is unchanged —
 * \`join_event.sql\` is the only file today, but a second one must not silently
 * change precedence.
 */
export function serverSqlFiles(): string[] {
  return Object.keys(SERVER_SQL).sort();
}
`;

writeFileSync(OUT, header + body + footer, 'utf8');
process.stdout.write(
  `gen:server-sql: wrote ${OUT} (${files.length} file${files.length === 1 ? '' : 's'}: ${files.join(', ')})\n`,
);
