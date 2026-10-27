import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

/**
 * Metro mirrors dependency assets under an `assets/node_modules/` path.
 *
 * ★ VERCEL WILL NOT SERVE A URL CONTAINING `node_modules`, WHATEVER `.vercelignore` SAYS.
 *
 * Established by direct observation of the live deployment: from the SAME uploaded
 * tree, `/assets/assets/fonts/Vazirmatn-Bold.<hash>.ttf` answered 200 and
 * `/assets/node_modules/@expo-google-fonts/…/PlusJakartaSans_400Regular.<hash>.ttf`
 * answered 404. Re-including the path in `.vercelignore` changed nothing.
 *
 * That asymmetry is why this read as a font bug for so long: Vazirmatn lives under
 * `assets/assets/fonts/`, so Persian screens looked correct and only the English
 * typefaces fell back to a system face, while the HTML and JS served perfectly.
 *
 * So the compose step RELOCATES the segment to `assets/vendor/` and rewrites the
 * references. These assertions pin that, because the failure mode is silent: the
 * page loads, and only the typeface is wrong.
 */

test('the compose step relocates the node_modules asset segment', () => {
  // Arrange
  const compose = readFileSync('.github/scripts/compose-static.sh', 'utf8');

  // Act / Assert
  assert.ok(/assets\/node_modules/.test(compose), 'compose does not look for the segment');
  assert.ok(/assets\/vendor/.test(compose), 'compose has no destination for it');
  assert.ok(
    /rm -rf "\$OUT\/assets\/node_modules"/.test(compose),
    'the original segment is left in place, so the host still refuses it',
  );
});

test('the references are rewritten, not only the files moved', () => {
  // Arrange
  const compose = readFileSync('.github/scripts/compose-static.sh', 'utf8');

  // Act — a move without a rewrite leaves every URL pointing at the removed path.
  const rewrites =
    compose.includes('s#/assets/node_modules/#/assets/vendor/#g') &&
    compose.includes('-exec sed -i');

  // Assert
  assert.ok(rewrites, 'the HTML/JS/CSS references are not rewritten to the new path');
});

test('the deployment check rejects a node_modules reference outright', () => {
  // Arrange
  const verify = readFileSync('.github/scripts/verify-deployment.sh', 'utf8');

  // Act / Assert — the relocation is the invariant; a lingering reference means it
  // did not run.
  assert.ok(
    /grep -q '\/assets\/node_modules\/'/.test(verify),
    'verify-deployment.sh does not check for a lingering node_modules reference',
  );
});

test('the deployment check still fetches a real typeface', () => {
  // Arrange
  const verify = readFileSync('.github/scripts/verify-deployment.sh', 'utf8');

  // Act / Assert — the bundle check alone passed throughout the outage.
  assert.ok(/\.ttf/.test(verify), 'verify-deployment.sh does not fetch a font');
});
