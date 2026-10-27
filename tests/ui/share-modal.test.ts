/**
 * The share sheet: rows as wide as the action, a copy that proves itself, and a
 * link that names the host the reader is actually on.
 *
 * ★ THE DEFECTS THESE PIN.
 *
 * 1. THE ROWS WERE NARROWER THAN THE BUTTON. "Code" and "Link" sat in two
 *    `Card`s inside a container with `paddingHorizontal: space[5]`, and the
 *    container is already inside the sheet's own `space[5]` of padding — so the
 *    rows were inset twice and stopped well short of the Share button below
 *    them. The indentation read as nesting: as though the code and the link
 *    belonged to something else.
 *
 * 2. THE COPY HAD NO PROOF BUT A TOAST IN ANOTHER CORNER. The icon did not
 *    change, so on a slow page the only evidence a copy worked was a pill at the
 *    bottom of the screen — three seconds later, away from the thing that was
 *    pressed. The icon flips to a check and pulses where the tap landed.
 *
 * 3. THE URL NAMED THE PLATFORM, NOT THE SITE. The invite URL is built
 *    server-side from `PUBLIC_BASE_URL`, or else from `request.url`'s origin —
 *    and on a serverless host that request origin is the deployment's own
 *    `*.vercel.app` host, not the custom domain the reader typed. So a person
 *    on `freewhen.rovoid.tech` was invited to `freewhen-orpin.vercel.app`. The
 *    invitation link has to be re-hosted onto the origin the page was loaded
 *    from, which is the same rule `resolveBaseUrlFrom` already applies to API
 *    calls.
 */

import './support/register';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { republishOnOrigin } from '@/src/lib/public-url';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('★ the invitation link is re-hosted on the page a reader loaded', () => {
  // Arrange — the exact pair from the report.
  const platformUrl = 'https://freewhen-orpin.vercel.app/e/abc123';
  const customOrigin = 'https://freewhen.rovoid.tech';

  // Act
  const published = republishOnOrigin(platformUrl, customOrigin);

  // Assert — the path and query survive; only the host changes.
  assert.equal(published, 'https://freewhen.rovoid.tech/e/abc123');
});

test('the path, query and hash are preserved, not rebuilt', () => {
  // Arrange
  const platformUrl = 'https://freewhen-orpin.vercel.app/e/tok?ref=x#top';

  // Act
  const published = republishOnOrigin(platformUrl, 'https://freewhen.rovoid.tech');

  // Assert
  assert.equal(published, 'https://freewhen.rovoid.tech/e/tok?ref=x#top');
});

test('a page already on its own origin is left alone', () => {
  // Arrange
  const onCustom = 'https://freewhen.rovoid.tech/e/abc';

  // Act / Assert — idempotent, so the modal can call it every render.
  assert.equal(republishOnOrigin(onCustom, 'https://freewhen.rovoid.tech'), onCustom);
});

test('an unknown origin, or a non-absolute URL, keeps the server value', () => {
  // Act / Assert — there is nothing to republish onto, and dropping the link
  // would be worse than showing the platform host.
  assert.equal(republishOnOrigin('https://a.test/e/1', undefined), 'https://a.test/e/1');
  assert.equal(republishOnOrigin('https://a.test/e/1', ''), 'https://a.test/e/1');
  assert.equal(republishOnOrigin('not-a-url', 'https://freewhen.rovoid.tech'), 'not-a-url');
  assert.equal(republishOnOrigin(null, 'https://freewhen.rovoid.tech'), null);
  assert.equal(republishOnOrigin(undefined, 'https://freewhen.rovoid.tech'), undefined);
});

test('a non-web page origin is not applied', () => {
  // Arrange — `file://` has no host to serve an invite from.
  // Act / Assert
  assert.equal(
    republishOnOrigin('https://a.test/e/1', 'file:///tmp/app.html'),
    'https://a.test/e/1',
  );
});

test('the share sheet re-hosts the URL it is given', () => {
  // Arrange
  const modal = code('src/features/events/components/EventShareModal.tsx');

  // Act
  const rehosts = /republishOnOrigin\(inviteUrl/.test(modal);
  const usesResolved = /const (\w+) = republishOnOrigin\(/.test(modal);

  // Assert
  assert.ok(rehosts, 'the sheet still shows the server value verbatim');
  assert.ok(usesResolved, 'the re-hosted URL is computed and never used');
});

test('the code and link rows stop being doubly inset', () => {
  // Arrange
  const modal = code('src/features/events/components/EventShareModal.tsx');

  // Act — the sheet already pads by `space[5]`; the container adds its own.
  const container = /container:\s*\{([^}]*)\}/.exec(modal)?.[1] ?? '';

  // Assert
  assert.ok(container.length > 0, 'the sheet container style is missing');
  assert.ok(
    !/paddingHorizontal:\s*space\[5\]/.test(container),
    'the rows are inset a second time inside the sheet, so they stop short of the button',
  );
});

test('the copy control flips to a check where the tap landed', () => {
  // Arrange
  const modal = code('src/features/events/components/EventShareModal.tsx');

  // Act — the confirmed state is per-row, not one shared toast.
  const perRowState = /const \[copied, setCopied\] = useState<CopiedRow>\(null\)|type CopiedRow =/.test(
    modal,
  );
  const showsCheck = /<Check\b/.test(modal);
  const perRowProps = (modal.match(/copied=\{copied === '/g) ?? []).length;

  // Assert — both rows confirm independently: one shared flag would light the
  // code button when the link was copied.
  assert.ok(perRowState, 'the copy has no per-row confirmation state');
  assert.ok(showsCheck, 'the copy icon never becomes a check');
  assert.equal(perRowProps, 2, `${perRowProps} rows take a copied state, expected 2`);
});

test('the copy control animates, so the confirmation is seen', () => {
  // Arrange
  const modal = code('src/features/events/components/EventShareModal.tsx');

  // Act / Assert — a static icon swap is easy to miss on a large sheet.
  assert.ok(/withSequence|withSpring|withTiming/.test(modal), 'the copied state does not animate');
  assert.ok(/useSharedValue/.test(modal), 'the animation has no shared value to drive');
});
