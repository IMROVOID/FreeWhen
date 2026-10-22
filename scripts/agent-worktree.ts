/**
 * Create an isolated git worktree for a parallel agent.
 *
 * ★ Why this exists.
 *
 * "Run these two plans in parallel" is only safe if the two agents cannot
 * see each other's writes. In one checkout they can: agent A edits
 * `src/i18n/fa.json` while agent B is reading it, and agent B's
 * `npm run export:web --clear` deletes the `dist/` agent A is gating.
 *
 * A git worktree is a second checkout of the same repository. The agent
 * gets its own working directory, its own branch, its own `dist/`, its own
 * Metro cache and its own database (see scripts/db/client.ts). Nothing one
 * agent writes is visible to another until the lead merges the branch.
 *
 * The alternative — "just be careful" — is not a mechanism, and this build
 * runs to a 7-day deadline with 18 plans.
 *
 * Usage:
 *   npm run worktree -- create <phase>   # e.g. 05
 *   npm run worktree -- remove <phase>
 *   npm run worktree -- list
 *
 * The worktree lives at `.worktrees/<phase>-<slug>`, which is gitignored.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const WORKTREES_DIR = join(PROJECT_ROOT, '.worktrees');

/** phase -> the branch slug the plan uses. */
const PHASE_SLUGS: Record<string, string> = {
  '02': 'schema-rls',
  '02B': 'local-postgres',
  '04': 'routing-adapter',
  '05': 'events-invites-identity',
  '06': 'proposals-time',
  '07': 'voting-decision',
  '08': 'map-ranking-ui',
  '09': 'privacy-retention',
  '10': 'follow-through',
  '11': 'states-accessibility',
  '12': 'deploy-reviewer',
  '13': 'user-test',
  '14': 'p1-backlog',
  '15': 'submission',
  '18': 'server-surface',
};

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
}

function branchName(phase: string): string {
  const slug = PHASE_SLUGS[phase];
  if (!slug) {
    throw new Error(
      `unknown phase ${phase}. Known: ${Object.keys(PHASE_SLUGS).join(', ')}`,
    );
  }
  return `feat/${phase}-${slug}`;
}

function worktreePath(phase: string): string {
  return join(WORKTREES_DIR, `${phase}-${PHASE_SLUGS[phase]}`);
}

function create(phase: string, base?: string): void {
  const branch = branchName(phase);
  const path = worktreePath(phase);

  if (existsSync(path)) {
    console.log(`worktree already exists: ${path}`);
    return;
  }

  mkdirSync(WORKTREES_DIR, { recursive: true });

  // The base is the CURRENT HEAD, not `main`.
  //
  // `main` is the last commit of the lead's work, and in a young repo that
  // can be several phases behind the working tree. Branching from `main`
  // would hand the agent a tree that is missing everything the lead has
  // built since — the agent's plan would describe files that do not exist.
  // Branching from HEAD gives the agent everything that is committed.
  //
  // The consequence is deliberate and worth stating: the lead must commit
  // before spawning parallel agents. A parallel agent cannot see the
  // lead's uncommitted work, and neither can any other agent. Uncommitted
  // work is invisible to the whole parallel scheme.
  const baseRef = base ?? 'HEAD';

  // The branch may already exist (the agent was run before and stopped).
  // Reuse it rather than failing — a resumed agent should not have to
  // delete its own work.
  const branches = git(['branch', '--list', branch]);
  const args = branches
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', path, '-b', branch, baseRef];

  git(args);

  // The plans are the agent's contract, and `docs/` is not tracked by git
  // in this repository — a worktree therefore has no `docs/` at all. Copy
  // it in: the plan files are READ-ONLY to a parallel agent (the doc
  // toolchain is lead-only), so a copy is sufficient and a copy cannot be
  // corrupted by an agent writing to the lead's copy.
  const docsSrc = join(PROJECT_ROOT, 'docs');
  const docsDst = join(path, 'docs');
  if (existsSync(docsSrc) && !existsSync(docsDst)) {
    cpSync(docsSrc, docsDst, { recursive: true });
    console.log('copied docs/ into the worktree (read-only for the agent)');
  }

  console.log(`worktree ready: ${path}`);
  console.log(`  branch: ${branch}`);
  console.log(`  base:   ${baseRef}`);
  console.log('');
  console.log('Run the agent in that directory. It has:');
  console.log('  - its own working tree, so no other agent sees its writes');
  console.log('  - its own dist/ (npm run export:web)');
  console.log('  - its own database (npm run test:db derives one from the branch)');
  console.log('');
  console.log('The agent does NOT:');
  console.log('  - edit docs/plans/ROADMAP.md');
  console.log('  - run scripts/docs/*.py (the doc toolchain is lead-only)');
  console.log('  - edit docs/ at all — the copy in the worktree is a read-only');
  console.log('    reference, and the lead owns the original');
  console.log('');
  console.log(`  cd ${path} && npm install`);
}

function remove(phase: string): void {
  const path = worktreePath(phase);
  if (!existsSync(path)) {
    console.log(`no worktree at ${path}`);
    return;
  }
  git(['worktree', 'remove', '--force', path]);
  console.log(`removed ${path}`);
}

function list(): void {
  console.log(git(['worktree', 'list']));
}

const [command, phase, base] = process.argv.slice(2);

if (!command) {
  console.error('usage: npm run worktree -- <create|remove|list> [phase]');
  process.exit(1);
}

try {
  switch (command) {
    case 'create':
      if (!phase) throw new Error('create needs a phase, e.g. `create 05`');
      create(phase, base);
      break;
    case 'remove':
      if (!phase) throw new Error('remove needs a phase, e.g. `remove 05`');
      remove(phase);
      break;
    case 'list':
      list();
      break;
    default:
      console.error(
        'usage: npm run worktree -- <create|remove|list> [phase]',
      );
      process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
