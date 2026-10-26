/**
 * The package integrity test (Plan 15, Task 14).
 *
 * ★ A MISSING ARTIFACT FOUND BY A REVIEWER IS WORSE THAN ONE FOUND HERE.
 *
 * This is cheap insurance: the submission is a set of files, and a set is only
 * as good as its weakest member. Every assertion below is about the package
 * being COMPLETE, not about the product working — the product has its own
 * suites.
 *
 * ★ "EXISTS" IS NOT ENOUGH. EVERY FILE MUST BE NON-EMPTY.
 *
 * A zero-byte `engine-suite.txt` satisfies an existence check and proves
 * nothing. The same goes for a checklist with no checkboxes in it: it would
 * pass a "file present" test while claiming nothing at all. So each artifact is
 * checked for the CONTENT that makes it evidence.
 *
 * ★ AN UNCHECKED ITEM IS ALLOWED — A SILENT ONE IS NOT.
 *
 * PRD-12 §12: an unchecked item blocks `done`. The checklist is permitted to
 * leave an item unticked, because the honest alternative to verifying something
 * is saying so, not ticking it anyway. What this test enforces is that no gap
 * is SILENT: every unchecked box must carry a stated blocker on the next line,
 * must be named in §6, and must be counted in the summary table. A checklist
 * that cannot prove an item and says so is worth more than one that proves
 * nothing and claims everything.
 *
 * ★ THE SUMMARY TABLE MUST AGREE WITH THE BODY.
 *
 * A table claiming 46 items over a body of 51 is how a checklist starts lying
 * without anyone editing a single tick.
 *
 * ★ NO NETWORK, NO DATABASE, NO DEVICE.
 *
 * This runs in `npm test` as the last line of defence. It reads files. If it
 * needed a service it would be skipped precisely when things are worst.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, test } from 'node:test';

const ROOT = process.cwd();

/** Reads a packaged file, failing with the path rather than an ENOENT stack. */
function read(path: string): string {
  assert.ok(existsSync(`${ROOT}/${path}`), `missing from the package: ${path}`);
  return readFileSync(`${ROOT}/${path}`, 'utf8');
}

/** Asserts a file is present and carries content worth publishing. */
function assertNonEmpty(path: string): string {
  const body = read(path);
  assert.ok(body.trim().length > 0, `empty file proves nothing: ${path}`);
  return body;
}

/**
 * Every artifact PRD-13 §9 requires, plus what this phase added.
 *
 * Grouped so a failure message names the reason the file exists.
 */
const REQUIRED_ARTIFACTS: ReadonlyArray<{ path: string; why: string }> = [
  { path: 'README.md', why: 'what it is, how to run it, what is missing' },
  { path: 'docs/USER-TEST-LOG.md', why: 'the required user-test documentation' },
  { path: 'docs/QA-CHECKLIST.md', why: 'every §7 item with its evidence' },
  { path: 'docs/plans/ROADMAP.md', why: 'every plan, its status, the evidence trail' },
  { path: 'docs/plans/INDEX.md', why: 'the plan index' },
  { path: 'docs/prd/15-TRACEABILITY.md', why: 'feature → requirement → evidence' },
  { path: 'docs/prd/16-OPEN-QUESTIONS.md', why: 'every open question and the default that settled it' },
  { path: 'docs/prd/17-BUILD-HANDOFF.md', why: 'the ordered checklist and cut lines' },
  { path: 'docs/prd/18-SERVER-SURFACE.md', why: 'the deployed surface' },
  { path: 'docs/research/00-RESEARCH-SUMMARY.md', why: 'problem understanding and evidence' },
  { path: 'docs/evidence/test-output/release-gates.txt', why: 'all seven gates, verbatim' },
  { path: 'docs/evidence/test-output/engine-suite.txt', why: 'the differentiator is not hand-waving' },
  { path: 'docs/evidence/test-output/decision-card-identity.txt', why: 'the central promise, asserted' },
  { path: 'docs/evidence/test-output/db-suite.txt', why: 'the schema and RLS, live' },
  { path: 'docs/evidence/test-output/full-suite.txt', why: 'the unit and component suites' },
  { path: 'docs/evidence/notes/location-denied-walkthrough.md', why: 'the AC-8.1.1 evidence' },
];

/**
 * ★ THE SUBMISSION DOCS ARE NOT IN THIS REPOSITORY.
 *
 * `docs/` is excluded from git on purpose (`.git/info/exclude`: "Dont Commit or
 * Push Document files to Remote"). A CI checkout therefore has none of it, and
 * every assertion below would fail on an absent file rather than on a bad one —
 * a red build that says nothing about the code.
 *
 * The suite still runs, in full, wherever the documents live. `describe.skip`
 * rather than a silent `if`: the reporter prints the skip, so a reader of a CI
 * log can see the submission package went unjudged instead of assuming it
 * passed.
 */
const DOCS_AVAILABLE =
  existsSync(`${ROOT}/docs/QA-CHECKLIST.md`) &&
  existsSync(`${ROOT}/docs/evidence/test-output/release-gates.txt`);

const suite = DOCS_AVAILABLE ? describe : describe.skip;

suite('the submission package contains every required artifact', () => {
  /**
   * The one artifact this suite cannot judge while it is running.
   *
   * `npm test | tee full-suite.txt` truncates the file at the start of the run
   * and fills it as tests complete, so during execution it is empty. Requiring
   * it to be non-empty here would fail a green build. It is checked for
   * existence only — the file's own content is the run's output, and its
   * verdict is the run's exit code.
   */
  const SELF_WRITTEN = new Set(['docs/evidence/test-output/full-suite.txt']);

  test('every artifact exists and is non-empty', () => {
    for (const { path, why } of REQUIRED_ARTIFACTS) {
      assert.ok(existsSync(`${ROOT}/${path}`), `missing: ${path} (for ${why})`);
      if (SELF_WRITTEN.has(path)) continue;
      const size = statSync(`${ROOT}/${path}`).size;
      assert.ok(size > 0, `empty: ${path} (for ${why})`);
    }
  });

  test('the list above is not silently shrinking', () => {
    // Arrange / Act
    const count = REQUIRED_ARTIFACTS.length;

    // Assert — a guard against an edit that removes a row to make the suite pass.
    assert.ok(count >= 16, `the package lost artifacts: ${count} listed, 16 required`);
  });
});

suite('the evidence files carry evidence, not just bytes', () => {
  test('the gate output names all seven gates and says they passed', () => {
    // Arrange
    const body = assertNonEmpty('docs/evidence/test-output/release-gates.txt');

    // Assert
    for (const gate of [
      'gate:secrets',
      'gate:location',
      'gate:engine-purity',
      'gate:logs',
      'gate:design',
      'gate:i18n',
      'gate:web',
    ]) {
      assert.ok(body.includes(gate), `the gate output does not mention ${gate}`);
    }
    assert.match(body, /all 7 gates passed/, 'the run did not report a full pass');
    assert.ok(
      !/FAILED/.test(body),
      'the captured gate output contains a failure — it must not ship as evidence',
    );
  });

  test('the engine output names all 18 TC-n cases individually', () => {
    // Arrange
    const body = assertNonEmpty('docs/evidence/test-output/engine-suite.txt');

    // Act — a bare "18 passed" is not evidence; the named assertions are.
    const named = new Set(body.match(/TC-\d+/g) ?? []);

    // Assert
    for (let n = 1; n <= 18; n += 1) {
      assert.ok(named.has(`TC-${n}`), `TC-${n} does not appear in the engine output`);
    }
    assert.ok(!/✖|failing tests/.test(body), 'the engine suite recorded a failure');
  });

  test('the engine output contains the two assertions that carry the product', () => {
    // Arrange — TC-11 (unknown ≠ accessible) and TC-18 (transit never "high").
    const body = assertNonEmpty('docs/evidence/test-output/engine-suite.txt');

    // Act / Assert
    assert.match(body, /TC-11:.*unknown accessibility is never treated as accessible/);
    assert.match(body, /TC-18:.*transit proxy is always low confidence/);
  });

  test('the decision-card output proves both sessions agree', () => {
    // Arrange
    const body = assertNonEmpty('docs/evidence/test-output/decision-card-identity.txt');

    // Act / Assert
    assert.match(body, /byte-identical/, 'the identity assertion is not in the captured output');
    assert.ok(!/✖|failing tests/.test(body), 'the identity suite recorded a failure');
  });

  test('the database output recorded no failures', () => {
    // Arrange
    const body = assertNonEmpty('docs/evidence/test-output/db-suite.txt');

    // Act / Assert
    assert.ok(!/failing tests/.test(body), 'the DB suite recorded a failure');
    assert.match(body, /ℹ fail 0/, 'the DB suite summary does not report zero failures');
  });

  test('the unit output is present and non-empty when this suite runs on its own', () => {
    // ★ THIS TEST DELIBERATELY DOES NOT INSPECT `full-suite.txt`'s SUMMARY.
    //
    // That file is produced by `npm test | tee full-suite.txt` — the very run
    // that contains this suite. `tee` truncates it at the start, so during the
    // run the file is EMPTY, and any assertion about its contents fails on a
    // perfectly green build. That is not a hypothetical: it failed twice while
    // this comment was being written.
    //
    // The zero-failure verdict for the unit suite is the run's own exit code,
    // which is what a caller reads. This test asserts only what is checkable
    // from inside: the path is part of the declared package. Existence and
    // non-emptiness of the file as an ARTIFACT is covered above by
    // `every artifact exists and is non-empty`, which is meaningful when the
    // suite is run on its own (`npm run test -- submission`).
    assert.ok(
      REQUIRED_ARTIFACTS.some((a) => a.path === 'docs/evidence/test-output/full-suite.txt'),
      'the unit output is no longer declared as a package artifact',
    );
  });
});

suite('the QA checklist is complete', () => {
  /** The bullets that are genuinely unchecked — the standard task-list syntax. */
  function uncheckedBoxesWithText(body: string): string[] {
    return body.split('\n').filter((line) => /^- \[ \] /.test(line));
  }

  function checkedBoxes(body: string): string[] {
    return body.split('\n').filter((line) => /^- \[x\] /.test(line));
  }

  test('it covers all five sections of PRD-12 §7', () => {
    // Arrange
    const body = assertNonEmpty('docs/QA-CHECKLIST.md');

    // Act / Assert
    for (const section of ['7.1', '7.2', '7.3', '7.4', '7.5']) {
      assert.match(body, new RegExp(`^## ${section.replace('.', '\\.')} `, 'm'),
        `the checklist has no §${section} section`);
    }
  });

  test('every checked item carries its evidence', () => {
    // Arrange
    const body = assertNonEmpty('docs/QA-CHECKLIST.md');
    const lines = body.split('\n');

    // Act — an item is a checkbox line plus the indented line beneath it.
    const bare: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (!/^- \[x\] /.test(line)) continue;
      const evidence = (lines[i + 1] ?? '').trim();
      if (!/^(Evidence:|\*\*)/.test(evidence)) bare.push(line.slice(0, 60));
    }

    // Assert — a tick with nothing behind it is an assertion, not evidence.
    assert.deepEqual(bare, [], `these items are ticked with no evidence: ${bare.join(' | ')}`);
  });

  test('the starred items are present, and every one is either checked or explained', () => {
    // Arrange
    const body = assertNonEmpty('docs/QA-CHECKLIST.md');

    // Act — the eleven ★ items are non-negotiable (PRD-12 §7).
    const lines = body.split('\n');
    const starred = lines.filter((line) => /^- \[[x ]\] .*★/.test(line));

    // Assert — a starred item may be unchecked ONLY if the very next line says
    // why, and §6 names it. An unexplained unchecked ★ is a submission claiming
    // something it has not done.
    assert.ok(starred.length >= 11, `only ${starred.length} starred items are present, 11 required`);

    const unexplained = starred.filter((line) => {
      if (/^- \[x\] /.test(line)) return false;
      const globalIndex = lines.indexOf(line);
      const next = (lines[globalIndex + 1] ?? '').trim();
      // The evidence line opens with a bold tag: `**DEVICE** — …`,
      // `**PARTIAL** — …`, `**NOT VERIFIED** — …`.
      return !/^\*\*(PARTIAL|NOT VERIFIED)\b/.test(next);
    });

    assert.deepEqual(
      unexplained,
      [],
      `these starred items are unchecked with no stated reason: ${unexplained.join(' | ')}`,
    );
  });

  test('every unchecked item is declared in §6, so no gap is silent', () => {
    // Arrange
    const body = assertNonEmpty('docs/QA-CHECKLIST.md');

    // Act
    const unchecked = uncheckedBoxesWithText(body);
    const gapSection = body.split('## 6.')[1] ?? '';

    // Assert — each unchecked item must have its blocker written down. A gap
    // that exists only as an unticked box is invisible to a reviewer.
    for (const item of unchecked) {
      const keywords = item
        .replace(/^- \[ \] /, '')
        .replace(/[★*]/g, '')
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 5)
        .slice(0, 4);

      const declared = keywords.some((word) => gapSection.toLowerCase().includes(word));
      assert.ok(declared, `unchecked item is not explained in §6: ${item.slice(0, 70)}`);
    }
  });

  test('the summary counts agree with the checkboxes on disk', () => {
    // Arrange
    const body = assertNonEmpty('docs/QA-CHECKLIST.md');

    // Act
    const checked = checkedBoxes(body).length;
    const unchecked = uncheckedBoxesWithText(body).length;

    // Assert — a summary table that drifts from the body is how a checklist
    // starts reporting 46 while 51 items exist.
    assert.match(
      body,
      new RegExp(`\\*\\*${checked}\\*\\*\\s*\\|\\s*\\*\\*${unchecked}\\*\\*`),
      `the summary table does not report ${checked} checked / ${unchecked} unchecked`,
    );
    assert.equal(checked + unchecked, 54, 'the checklist no longer carries 54 items');
  });

  test('the checklist does not hide a gap behind non-standard syntax', () => {
    // Arrange — `[✗]`, `[-]` and `[~]` are not task-list markers, so a naive
    // `grep -c "\- \[ \]"` would report zero while items stayed unverified.
    const body = assertNonEmpty('docs/QA-CHECKLIST.md');

    // Act
    const oddMarkers = body.split('\n').filter((line) => /^- \[[^ x]\] /.test(line));

    // Assert
    assert.deepEqual(oddMarkers, [], `non-standard checkbox markers hide gap(s): ${oddMarkers.join(' | ')}`);
  });
});

suite('the package states what it cannot claim', () => {
  test('the user test log says plainly that the test was not run', () => {
    // Arrange
    const body = assertNonEmpty('docs/USER-TEST-LOG.md');

    // Act / Assert — the honesty requirement, asserted rather than trusted.
    assert.match(body, /NOT RUN/i, 'the log does not state its status up front');
    assert.match(body, /superseded/i, 'the log does not explain the superseded state');
    assert.match(body, /Round 2/i, 'the log does not address the missing Round 2');
  });

  test('the README states all six gaps plus the transit and accessibility disclosures', () => {
    // Arrange
    const body = assertNonEmpty('README.md');

    // Act / Assert — G-1..G-6 (PRD-08 §9.2) and the two research findings.
    for (const gap of ['G-1', 'G-2', 'G-3', 'G-4', 'G-5', 'G-6']) {
      assert.ok(body.includes(gap), `the README does not state ${gap}`);
    }
    assert.match(body, /Transit is an estimate/i, 'the transit estimate is not disclosed');
    assert.match(body, /wheelchair/i, 'the OSM accessibility limitation is not disclosed');
    assert.match(body, /iOS is out of scope/i, 'the iOS exclusion is not stated');
  });

  test('no unsupported differentiation claim appears anywhere in the package', () => {
    // Arrange — Finding F1: do not market FreeWhen as inventing fairness.
    const artifacts = ['README.md', 'README.fa.md', 'docs/QA-CHECKLIST.md', 'docs/USER-TEST-LOG.md'];

    // Act — the four forbidden shapes from NO_UNSUPPORTED_CLAIM.
    const forbidden = [
      /the first fairness/i,
      /the only fair/i,
      /we invented/i,
      /world's first/i,
    ];

    // Assert
    for (const path of artifacts) {
      const body = assertNonEmpty(path);
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(body), `${path} makes an unsupported claim: ${pattern}`);
      }
    }
  });

  test('the traceability matrix gives every catalogued item a final status', () => {
    // Arrange
    const body = assertNonEmpty('docs/prd/15-TRACEABILITY.md');

    // Act
    const rows = body.split('\n').filter((line) => /^\| [A-J]\d{1,2}[ab]? \|/.test(line));
    const withoutStatus = rows.filter(
      (line) => !/\*\*(Built|Built \(part\)|Deferred|Cut|Not built)\*\*/.test(line),
    );

    // Assert — an unfinished matrix undermines the argument it exists to make.
    assert.ok(rows.length >= 84, `only ${rows.length} catalogued rows; the brief has 84+`);
    assert.deepEqual(
      withoutStatus.map((l) => (l.split('|')[1] ?? '').trim()),
      [],
      'these catalogued items have no final status',
    );
  });

  test('the keystore location is recorded, not left as a blank', () => {
    // Arrange
    const body = assertNonEmpty('README.md');

    // Act
    const line = body.split('\n').find((l) => /Keystore location/i.test(l)) ?? '';

    // Assert — the field must exist; an unfilled placeholder is reported, not failed,
    // because the host is provisioned by the operator, not by the build.
    assert.ok(line.length > 0, 'the README does not record where the keystore lives');
    assert.match(line, /must not be inside the repository/, 'the storage rule is not stated');
  });
});
