/**
 * The full QA run.
 *
 * `npm run qa:all` is the whole-checklist command: every release gate plus every
 * suite. `gate:all` answers "is the bundle shippable?"; this answers "is
 * anything at all broken?", which is the question P15's submission checklist
 * asks before a release.
 *
 * It runs `gate:all` first and stops there on failure — a secret in the tree
 * makes the test results irrelevant, and there is no point spending nine
 * minutes of suite time to find that out.
 */

import { spawnSync } from 'node:child_process';

import { PROJECT_ROOT } from '../db/paths';

type Step = { label: string; command: string; script: string; args: string[] };

const STEPS: Step[] = [
  { label: 'typecheck', command: 'npm', script: 'run', args: ['typecheck'] },
  { label: 'lint', command: 'npm', script: 'run', args: ['lint'] },
  { label: 'gates', command: 'npm', script: 'run', args: ['gate:all'] },
  { label: 'tests', command: 'npm', script: 'run', args: ['test'] },
  { label: 'engine', command: 'npm', script: 'run', args: ['test:engine'] },
];

for (const [index, step] of STEPS.entries()) {
  console.log(`\n${index + 1}/${STEPS.length} ${step.label}: npm run ${step.args.join(' ')}`);

  const result = spawnSync(step.command, [step.script, ...step.args], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.error(`qa:all: ${step.label} failed (exit ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nqa:all: ${STEPS.length} steps passed`);
