/**
 * The page-scroll lock that keeps a web overlay from scrolling the page behind it.
 *
 * The reported defect was "after selecting the map I cannot scroll the page — like
 * the prompt or map is still on focus", and it happened with other overlays too.
 * Two independent causes are pinned here and in `location-map-responder.test.ts`:
 *
 *  1. the map's `PanResponder` claimed every gesture, so a swipe on the map was
 *     swallowed instead of scrolling the sheet;
 *  2. a web `Modal` leaves the document scrollable, so the page moved under it.
 *
 * This file covers (2): one shared counter, released only when the LAST overlay
 * leaves, restoring the page's own `overflow` rather than assuming it was empty.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  lockPageScroll,
  pageScrollLockCount,
  resetPageScrollLock,
} from '@/src/components/ui/page-scroll-lock';

/** A minimal `document.body` stand-in, which is all the lock touches. */
function installBody(initialOverflow = ''): { style: { overflow: string } } {
  const style = { overflow: initialOverflow };
  (globalThis as unknown as { document?: unknown }).document = { body: { style } };
  return { style };
}

describe('page scroll lock', () => {
  afterEach(() => {
    resetPageScrollLock();
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it('locks the page while held and releases it on the last release', () => {
    const { style } = installBody();

    const release = lockPageScroll();
    assert.equal(style.overflow, 'hidden', 'the page must not scroll behind the overlay');
    assert.equal(pageScrollLockCount(), 1);

    release();
    assert.equal(style.overflow, '', 'the page scrolls again once the overlay is gone');
    assert.equal(pageScrollLockCount(), 0);
  });

  it('keeps the page locked until every stacked overlay has closed', () => {
    const { style } = installBody();

    // A confirm sheet over a share sheet: closing the inner one must not unlock
    // the page while the outer one is still open.
    const releaseOuter = lockPageScroll();
    const releaseInner = lockPageScroll();
    assert.equal(style.overflow, 'hidden');

    releaseInner();
    assert.equal(style.overflow, 'hidden', 'the outer overlay still needs the lock');
    assert.equal(pageScrollLockCount(), 1);

    releaseOuter();
    assert.equal(style.overflow, '');
    assert.equal(pageScrollLockCount(), 0);
  });

  it('restores the overflow the page already had', () => {
    // A page that set its own `overflow: hidden` must get it back, not be reset
    // to scrollable by a sheet that happened to open on it.
    const { style } = installBody('hidden');

    const release = lockPageScroll();
    release();

    assert.equal(style.overflow, 'hidden');
  });

  it('ignores a repeated release from one holder', () => {
    const { style } = installBody();

    const releaseOuter = lockPageScroll();
    const releaseInner = lockPageScroll();

    // The inner component both unmounts and runs its close callback.
    releaseInner();
    releaseInner();

    assert.equal(style.overflow, 'hidden', 'a double release must not unlock early');

    releaseOuter();
    assert.equal(style.overflow, '');
    assert.equal(pageScrollLockCount(), 0);
  });

  it('is a no-op without a document, so native never touches it', () => {
    // No `document` installed at all.
    const release = lockPageScroll();
    assert.equal(pageScrollLockCount(), 0, 'native has no page to lock');
    release();
  });
});
