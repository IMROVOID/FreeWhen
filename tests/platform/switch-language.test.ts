/**
 * The web language switch (PRD-18 §6 row 3, AC-18.8.1).
 *
 * ★ THE RELOAD WAS THE BUG, SO THE ASSERTION IS NOW THAT THERE IS NONE.
 *
 * This file used to assert that `switchLanguage` drained its queue and then
 * called `window.location.reload()` exactly once. That looked safe — "web can set
 * `dir` on a live document" — but the document it reloaded was the STATICALLY
 * EXPORTED one, stamped `dir="rtl" lang="fa"` at build time by `app/+html.tsx`
 * (which runs in Node, where there is no `localStorage`). The reload therefore
 * faithfully restored the OLD language: "when I click English it restarts but
 * stays on Persian".
 *
 * The switch is live now: it persists, drains the queue, then calls `setLanguage`,
 * which swaps the i18next catalogue and applies the direction to the document. The
 * ordering assertion survives because it is still load-bearing — a write lost to a
 * language change is a data bug attributed to the wrong feature.
 *
 * ★ WHAT THIS SUITE CANNOT REACH, AND WHY.
 *
 * Node (`tsx`) resolves `./store` to `src/i18n/store.ts` — the NATIVE
 * implementation, backed by `expo-file-system`. Metro's `.web.ts` substitution
 * only happens in a web bundle. So the storage-dependent behaviour is asserted
 * against the SOURCE; the queue behaviour, which IS reachable, is tested for real.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import i18next, { initI18n } from '@/src/i18n';
import {
  clearPendingWrites,
  flushPendingWrites,
  pendingWriteCount,
  registerPendingWrite,
} from '@/src/lib/pending-writes';

type Reloadable = { window?: unknown };

/** Installs a `window` whose reload is recorded into `order`. */
function installWindow(order: string[]): void {
  (globalThis as Reloadable).window = {
    location: {
      reload: () => {
        order.push('reload');
      },
    },
  };
}

function removeWindow(): void {
  delete (globalThis as Reloadable).window;
}

function strippedSource(): string {
  return readFileSync('src/features/settings/services/switch-language.web.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const load = () => import('@/src/features/settings/services/switch-language.web');

test('AC-18.8.1: pending writes drain before the catalogue changes', async () => {
  // Arrange
  initI18n('fa');
  clearPendingWrites();
  const order: string[] = [];
  installWindow(order);

  registerPendingWrite(async () => {
    // A write that yields, as a real network call would.
    await new Promise((resolve) => setTimeout(resolve, 1));
    order.push('write');
  });

  const { switchLanguage } = await load();

  try {
    // Act
    const result = await switchLanguage({ current: 'fa' });

    // Assert — the write is recorded, and the catalogue moved.
    assert.equal(result.changed, true);
    assert.deepEqual(order, ['write'], 'the queue did not drain before the switch');
    assert.equal(i18next.language, 'en', 'the catalogue did not change');
  } finally {
    removeWindow();
    clearPendingWrites();
    initI18n('fa');
  }
});

test('the switch never reloads the page', async () => {
  // Arrange — a reload restores the STATICALLY EXPORTED document, whose `dir` was
  // stamped at build time, so it can only ever undo the switch.
  initI18n('fa');
  clearPendingWrites();
  const order: string[] = [];
  installWindow(order);

  const { switchLanguage } = await load();

  try {
    // Act
    await switchLanguage({ current: 'fa' });

    // Assert
    assert.equal(order.filter((event) => event === 'reload').length, 0, 'the switch reloaded the page');
  } finally {
    removeWindow();
    clearPendingWrites();
    initI18n('fa');
  }
});

test('the source persists, THEN flushes, THEN swaps the language', () => {
  // Arrange
  const source = strippedSource();

  // Act — `persist(target)` is the call; `flush` and `setLanguage` follow it
  // inside the shared implementation.
  const persist = source.indexOf('persist(target)');
  const flush = source.indexOf('await flush()');
  const swap = source.indexOf('setLanguage(target)');

  // Assert — the order in the file is the order at runtime.
  assert.ok(persist > 0, 'the choice is not persisted');
  assert.ok(flush > persist, 'the flush must come AFTER persisting the choice');
  assert.ok(swap > flush, 'the language must change AFTER the flush — or a write is lost');
  assert.ok(!/location\.reload/.test(source), 'the page is reloaded, which undoes the switch');
});

test('the source returns before any side effect when nothing changes', () => {
  // Arrange
  const source = strippedSource();

  // Act — the no-op guard must return before `persist` is reached.
  const guard = source.indexOf('if (target === current)');
  const persist = source.indexOf('persist(target)');

  // Assert
  assert.ok(guard > 0, 'there is no no-op guard — a same-language switch would churn');
  assert.ok(persist > guard, 'the guard does not precede the first side effect');
});

test('there is no restart prompt on web', () => {
  // Arrange — a dialog explaining a page refresh is worse than the refresh.
  const source = strippedSource();

  // Assert
  assert.ok(!/Alert\.|confirm\(|prompt\(/.test(source), 'the web switch must not prompt');
});

test('the queue runs every writer, and a failing writer surfaces', async () => {
  // Arrange
  clearPendingWrites();
  const ran: string[] = [];

  registerPendingWrite(async () => {
    ran.push('a');
  });
  registerPendingWrite(async () => {
    ran.push('b');
    throw new Error('network down');
  });
  registerPendingWrite(async () => {
    ran.push('c');
  });

  // Act
  await assert.rejects(() => flushPendingWrites(), /network down/);

  // Assert — one failure must not stop the others, but it must be reported.
  assert.deepEqual(ran.sort(), ['a', 'b', 'c']);
  assert.equal(pendingWriteCount(), 0, 'the queue must be cleared, not leak writers');
});

test('unregistering removes a completed write', () => {
  // Arrange
  clearPendingWrites();

  // Act
  const release = registerPendingWrite(async () => {});
  assert.equal(pendingWriteCount(), 1);
  release();

  // Assert
  assert.equal(pendingWriteCount(), 0);
});
