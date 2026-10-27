import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('the asset mirror under node_modules is re-included for upload', () => {
  // Arrange — `.gitignore:20` is `node_modules/`, and an unanchored pattern
  // matches at ANY depth. Metro mirrors the package layout under `assets/`, so
  // `static/assets/node_modules/**` was filtered out of the upload by the same
  // rule that excludes the real dependency directory — while `!static/**` did not
  // rescue it, because a more specific ignore wins.
  const ignore = readFileSync('.vercelignore', 'utf8');

  // Act
  const reincludesAssets = /!static\/assets\/node_modules\/\*\*/.test(ignore);
  const reincludesDist = /!dist\/assets\/node_modules\/\*\*/.test(ignore);

  // Assert — this is the difference between a font that loads and a page that
  // silently falls back to a system face.
  assert.ok(reincludesAssets, 'static/assets/node_modules is not re-included');
  assert.ok(reincludesDist, 'dist/assets/node_modules is not re-included');
});

test('the real dependency tree stays excluded', () => {
  // Arrange
  const ignore = readFileSync('.vercelignore', 'utf8');

  // Act — the re-inclusions must be scoped to the ASSET mirror, and something
  // must positively exclude the root tree.
  const loosensRoot = /^!node_modules/m.test(ignore);
  const excludesRoot = /^node_modules\s*$/m.test(ignore);

  // Assert
  assert.equal(loosensRoot, false, 'the root node_modules directory was re-included');
  assert.ok(excludesRoot, 'nothing positively excludes the root node_modules tree');
});

test('the root exclusion comes BEFORE the asset re-inclusions', () => {
  // ★ ORDER IS THE WHOLE FIX.
  //
  // `.vercelignore` and `.gitignore` are merged, and gitignore semantics say a
  // negated pattern has no effect if its parent directory is excluded. Listing
  // the re-inclusion before the exclusion re-excludes the fonts again — the bug
  // comes straight back and the check still looks present.
  const lines = readFileSync('.vercelignore', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const excludeAt = lines.indexOf('node_modules');
  const reincludeAt = lines.findIndex((line) => line === '!static/assets/node_modules/');

  assert.ok(excludeAt >= 0, 'the root exclusion is missing');
  assert.ok(reincludeAt >= 0, 'the asset re-inclusion is missing');
  assert.ok(
    excludeAt < reincludeAt,
    'the asset re-inclusion is listed before the root exclusion, so it is overridden',
  );
});

test('the deployment check fetches a font, not only the bundle', () => {
  // Arrange — the bundle check passed while every Jakarta file 404'd, which is
  // exactly how this shipped green twice.
  const verify = readFileSync('.github/scripts/verify-deployment.sh', 'utf8');

  // Act
  const checksFonts = /assets\/\[\^"\]\*\\\.ttf|\.ttf/.test(verify);
  const checksNested = verify.includes('/assets/node_modules/');

  // Assert
  assert.ok(checksFonts, 'verify-deployment.sh does not fetch a font');
  assert.ok(checksNested, 'verify-deployment.sh does not specifically probe the node_modules mirror');
});
