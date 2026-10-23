/**
 * The inlined server SQL (Plan 39 T1).
 *
 * ★ WHY THIS FILE EXISTS.
 *
 * `server/lib/server-sql.ts` used to read `server/sql/*.sql` from disk with
 * `node:fs` at module load. That made the whole server un-runnable on a host
 * with no filesystem (Cloudflare Workers), for the sake of one 9 KB constant.
 *
 * The SQL now lives in `server/sql/index.ts` as a string, and the `.sql` files
 * remain the source of truth an editor reads. The risk of that arrangement is
 * obvious: someone edits `join_event.sql`, the inlined copy silently keeps the
 * old text, and the deployed server runs a function nobody can find in a
 * migration.
 *
 * ★ SO THE TEST COMPARES THE TWO.
 *
 * The inlined constant must equal the file byte-for-byte. It reads the file
 * from disk — which is allowed HERE, because a test runs on a developer machine
 * and never in the bundled server.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SERVER_SQL, serverSqlFiles } from '@/server/sql';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SQL_DIR = join(REPO_ROOT, 'server', 'sql');

describe('server SQL is inlined, not read from disk', () => {
  it('names exactly the .sql files that exist on disk', () => {
    const onDisk = readdirSync(SQL_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    assert.deepEqual(
      [...serverSqlFiles()].sort(),
      onDisk,
      'the inlined file list drifted from server/sql/',
    );
  });

  it('every inlined statement is byte-identical to its .sql file', () => {
    for (const file of serverSqlFiles()) {
      const onDisk = readFileSync(join(SQL_DIR, file), 'utf8');
      const inlined = SERVER_SQL[file];
      assert.ok(inlined !== undefined, `${file} is not inlined`);

      assert.equal(
        inlined,
        onDisk,
        `${file} was edited on disk but not regenerated in server/sql/index.ts — ` +
          `run \`npm run gen:server-sql\``,
      );
    }
  });

  it('carries no trailing whitespace drift', () => {
    // A trailing newline difference is the most common way an inlined copy
    // drifts after a hand edit, and it is invisible in a diff of two files.
    for (const file of serverSqlFiles()) {
      const inlined = SERVER_SQL[file];
      assert.ok(inlined !== undefined, `${file} is not inlined`);
      assert.ok(
        inlined.endsWith('\n'),
        `${file}: the inlined constant must end with a newline`,
      );
    }
  });

  it('declares join_event, the function the API depends on', () => {
    const sql = SERVER_SQL['join_event.sql'];
    assert.ok(sql, 'join_event.sql must be inlined');
    assert.match(sql, /create or replace function\s+join_event/i);
  });
});
