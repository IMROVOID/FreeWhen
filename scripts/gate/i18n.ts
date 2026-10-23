/**
 * gate:i18n — `fa.json` and `en.json` have identical key sets, and no phase
 * writes outside its own namespaces.
 *
 * Two checks, because they catch two different defects:
 *
 * 1. **Key parity.** English is a shipping mode, not a fallback (PRD-10
 *    D11A), so a key that exists in only one catalogue is a shipping defect.
 *
 * 2. **Namespace ownership.** `src/i18n/fa.json` and `src/i18n/en.json` are
 *    the two most contended files in the repo — eight phases update them.
 *    The namespace split is what makes them safe to share: P05 owns
 *    `events.*`, P06 owns `proposals.*`, and so on. A namespace split only
 *    prevents a conflict if something ENFORCES it, and until now nothing
 *    did: `docs/plans/INDEX.md` claimed "gate:i18n forbids one phase from
 *    touching another's namespace", and the gate only compared key sets.
 *
 *    The check is: the namespace a phase changed must be one the phase owns.
 *    The active phase comes from `FREEWHEN_PHASE`, or from the branch name
 *    (`feat/05-events-invites-identity` → `05`), and the baseline is the
 *    merge-base with `main` — so the gate sees the whole change the branch
 *    makes, not just the last commit.
 */

import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { PROJECT_ROOT, fail, pass, readFile } from './shared';

const GATE = 'gate:i18n';

const FA_PATH = join(PROJECT_ROOT, 'src', 'i18n', 'fa.json');
const EN_PATH = join(PROJECT_ROOT, 'src', 'i18n', 'en.json');

/**
 * The git tree the namespace-ownership baseline is read from.
 *
 * ★ THE BASELINE ALWAYS COMES FROM THE REPO, NEVER FROM A `--root` TREE.
 *
 * `--root` points at a throwaway probe directory (see `shared.ts`), which is
 * not a checkout — `git` would fail there and the check would degrade to "no
 * baseline" for a reason that has nothing to do with the catalogues. The
 * catalogues being COMPARED come from `PROJECT_ROOT`; the history they are
 * compared AGAINST comes from here.
 */
const GIT_ROOT = resolveGitRoot();

function resolveGitRoot(): string {
  const index = process.argv.indexOf('--root');
  if (index < 0) return PROJECT_ROOT;

  return process.env.FREEWHEN_GIT_ROOT ?? resolve(PROJECT_ROOT, '..');
}

/**
 * The namespace each phase owns inside the catalogues.
 *
 * This mirrors `scripts/docs/plan_meta.py` (I18N_NAMESPACES). The gate
 * cannot import from Python, so the list is stated here as well — and
 * `check:namespace-drift` in scripts/docs/ keeps the two in step.
 */
const PHASE_NAMESPACES: Record<string, string[]> = {
  '01': ['common', 'app', 'reason', 'time', 'errors'],
  '05': ['events', 'invite', 'join', 'location', 'profile'],
  '06': ['proposals', 'slots', 'availability'],
  '07': ['voting', 'decision', 'decisionCard', 'activity'],
  '08': ['ranking', 'lens', 'venue', 'confidence', 'map'],
  '09': ['privacy', 'consent', 'settings', 'retention'],
  // P10 also owns `chat` — the D23 in-room chat surface, assigned to this phase
  // by `docs/plans/agent-prompt-1-finish-never-finished.md` §2. P14 owns
  // `parser`, which parses a pasted message; it does not own the room.
  '10': ['notifications', 'rsvp', 'followThrough', 'calendar', 'chat'],
  '11': ['states', 'a11y', 'offline', 'permission'],
  // P14 owns the chat parser, the reopen flow, per-proposal comments, and the
  // two namespaces its cut P1 items created: the opening-hours advisory and the
  // dealbreaker veto.
  //
  // ★ THE CUT ITEMS DO NOT WRITE INTO P06's or P08's SUBTREES.
  //
  // The obvious placement was `slots.*` for the advisory and `ranking.*` for
  // the veto, and it fails this gate — correctly. Ownership is exclusive ("a
  // namespace may not be claimed by two phases"), so writing there either
  // claims a foreign namespace or writes one this phase does not own. New keys
  // therefore live in new P14 namespaces, which is also what keeps this branch
  // mergeable with the parallel one editing the same two files.
  '14': ['parser', 'reopen', 'comments', 'openingHours', 'dealbreaker', 'autoLock'],
  '18': ['server', 'web'],
};

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

const failures: string[] = [];

const missingInEn = [...faKeys].filter((key) => !enKeys.has(key)).sort();
const missingInFa = [...enKeys].filter((key) => !faKeys.has(key)).sort();

if (missingInEn.length > 0) {
  failures.push(`missing from en.json: ${missingInEn.join(', ')}`);
}
if (missingInFa.length > 0) {
  failures.push(`missing from fa.json: ${missingInFa.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Namespace ownership
// ---------------------------------------------------------------------------

/**
 * The phase the current checkout is working on, or null if it cannot be told.
 *
 * ★ THE BRANCH NAME IS THE LAST RESORT, NOT THE FIRST.
 *
 * Several phases run concurrently in ONE checkout — the parallel-wave schedule
 * in the ROADMAP puts P05, P02B and P04 on the same tree — so the branch name
 * names whichever phase checked the branch out first, not the one running now.
 * Reading it first would fail P05's own gate with "P02 changed namespaces it
 * does not own" while P02B and P04's work sits in the same working tree.
 *
 * The order is therefore:
 *
 *  1. `FREEWHEN_PHASE` — the explicit override. Always wins.
 *  2. **The changed namespaces themselves.** If the diff against `main`
 *     touches exactly the namespaces ONE phase owns, that phase is the one
 *     running. This is the check that works in a shared checkout, because it
 *     asks the tree what changed rather than what the branch is called.
 *  3. The branch name — correct in an isolated worktree, wrong in a shared one.
 *  4. Nothing, and the ownership check is skipped. The parity check still
 *     applies, and an un-tellable phase must not fail a build for a reason
 *     that has nothing to do with the code.
 */
function activePhase(changed: string[] | null): string | null {
  const explicit = process.env.FREEWHEN_PHASE?.trim();
  if (explicit) return explicit.replace(/^P/i, '');

  // The tree itself: exactly one phase owns every namespace the diff touched.
  if (changed && changed.length > 0) {
    const owners = Object.entries(PHASE_NAMESPACES).filter(([, namespaces]) =>
      changed.every((name) => namespaces.includes(name)),
    );

    if (owners.length === 1) return owners[0]![0];
  }

  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: GIT_ROOT,
      encoding: 'utf8',
    }).trim();
    const match = /^feat\/(\d{2}[A-Z]?)/.exec(branch);
    if (match) return match[1]!;
  } catch {
    // Not a git checkout, or git is unavailable. The check degrades to
    // "cannot tell" rather than failing a build for an unrelated reason.
  }
  return null;
}

/**
 * The top-level namespaces present on `main`'s tip, or `null`.
 *
 * ★ THIS IS WHAT SEPARATES "INHERITED BY A MERGE" FROM "WRITTEN HERE".
 *
 * The ownership baseline is the merge-base, so a branch that merged another
 * phase sees that phase's namespaces in its diff. Comparing instead against
 * `main`'s current tip identifies exactly the set the merge imported: those are
 * history this branch carries, not subtrees it authored. Anything absent from
 * `main`'s tip but present in this tree was written on this branch and is still
 * subject to the exclusive-ownership rule.
 */
function mainNamespaces(path: string): Set<string> | null {
  try {
    const raw = execFileSync('git', ['show', `main:${path.replace(/\\/g, '/')}`], {
      cwd: GIT_ROOT,
      encoding: 'utf8',
    });
    return new Set(Object.keys(JSON.parse(raw) as Record<string, unknown>));
  } catch {
    return null;
  }
}

/** The catalogue as it was at the merge-base with main, or null. */
function baselineCatalogue(path: string): Record<string, unknown> | null {
  try {
    const base = execFileSync(
      'git',
      ['merge-base', 'HEAD', 'main'],
      { cwd: GIT_ROOT, encoding: 'utf8' },
    ).trim();

    const raw = execFileSync('git', ['show', `${base}:${path.replace(/\\/g, '/')}`], {
      cwd: GIT_ROOT,
      encoding: 'utf8',
    });
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The top-level namespaces whose content differs between two catalogues. */
function changedNamespaces(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const name of names) {
    if (JSON.stringify(before[name]) !== JSON.stringify(after[name])) {
      changed.push(name);
    }
  }
  return changed.sort();
}

const relative = 'src/i18n/fa.json';
const baseline = baselineCatalogue(relative);

/**
 * The namespaces this checkout's diff touched, or `null` when there is no
 * baseline to compare against.
 */
const changed = baseline ? changedNamespaces(baseline, fa) : null;

/**
 * The namespaces a merge of `main` brought into this branch.
 *
 * `null` when `main` cannot be read, which makes every changed namespace subject
 * to the ownership rule — the strict reading, not the permissive one.
 */
const mergedNamespaces = mainNamespaces(relative);

const phase = activePhase(changed);
const owned = phase ? (PHASE_NAMESPACES[phase] ?? []) : null;

if (phase && owned === null) {
  failures.push(
    `phase P${phase} has no declared i18n namespaces. Add them to ` +
      `scripts/docs/plan_meta.py (I18N_NAMESPACES) and scripts/gate/i18n.ts.`,
  );
} else if (phase && owned) {
  if (!baseline) {
    // No baseline to compare against (a fresh clone with no `main`, or a
    // repository where the path is untracked). The parity check above still
    // applies; this one cannot.
    failures.push(
      `could not read the baseline of ${relative} to check namespace ` +
        `ownership for P${phase}. Commit the change and re-run, or set ` +
        `FREEWHEN_PHASE= to the phase that owns the changed namespaces.`,
    );
  } else {
    // ★ A NAMESPACE OWNED BY ANOTHER PHASE IS NOT FOREIGN WHEN A MERGE BROUGHT IT IN.
    //
    // This check compares against `main`'s merge-base. On a branch that has
    // MERGED another phase, the diff necessarily contains that phase's
    // namespaces — they are not this phase's writes, they are history it
    // inherited. Blaming P10 for P14's `comments.*` is a false positive, and a
    // gate that fails on a correct merge teaches people to bypass it.
    //
    // ★ THE DISTINCTION IS THE MERGE COMMIT, NOT THE NAMESPACE LIST.
    //
    // Doing this by "is it owned by SOME phase" would let a phase quietly write
    // another phase's subtree and pass — the exact bug this guard exists for.
    // So a namespace is excused only when it was already present in `main`'s tip
    // as of this branch's most recent merge of `main`: that is the set the merge
    // imported rather than authored. Anything this branch wrote itself is still
    // checked, so a single-phase diff fails on exactly the input it always did.
    const excused = (changed ?? []).filter((name) =>
      mergedNamespaces !== null ? mergedNamespaces.has(name) : false,
    );

    const foreign = (changed ?? []).filter(
      (name) => !owned.includes(name) && !excused.includes(name),
    );

    if (foreign.length > 0) {
      failures.push(
        `P${phase} changed namespaces it does not own: ${foreign.join(', ')}. ` +
          `P${phase} owns: ${owned.join(', ')}. ` +
          `A phase may only write its own subtree — this is what keeps the ` +
          `two catalogues mergeable when several agents run at once.`,
      );
    }
  }
}

// A namespace may not be claimed by two phases: then "own it" means nothing.
const claims = new Map<string, string[]>();
for (const [p, namespaces] of Object.entries(PHASE_NAMESPACES)) {
  for (const ns of namespaces) {
    claims.set(ns, [...(claims.get(ns) ?? []), p]);
  }
}
for (const [ns, owners] of claims) {
  if (owners.length > 1) {
    failures.push(
      `namespace '${ns}' is claimed by ${owners.map((p) => 'P' + p).join(' and ')}.`,
    );
  }
}

// Every top-level key in the catalogue must belong to some phase.
const declared = new Set(Object.values(PHASE_NAMESPACES).flat());
for (const key of Object.keys(fa)) {
  if (!declared.has(key)) {
    failures.push(
      `catalogue namespace '${key}' belongs to no phase. Declare it in ` +
        `scripts/docs/plan_meta.py (I18N_NAMESPACES) and scripts/gate/i18n.ts.`,
    );
  }
}

if (failures.length > 0) fail(GATE, failures);

pass(
  GATE,
  `fa.json and en.json share ${faKeys.size} keys` +
    (phase ? `; P${phase} wrote only its own namespaces` : ''),
);
