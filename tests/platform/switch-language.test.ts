/**
 * The web language switch (PRD-18 §6 row 3, AC-18.8.1).
 *
 * ★ THE ASSERTION IS THE ORDER, NOT THE OUTCOME.
 *
 * A reload discards whatever is in flight. If `switchLanguage` reloaded before
 * draining its pending writes, a vote the network had not yet accepted would
 * be lost silently — the one failure a language change must never cause. So
 * these tests record the sequence of effects and assert that the flush
 * completed BEFORE the navigation, not merely that both happened.
 *
 * ★ WHAT THIS SUITE CANNOT REACH, AND WHY.
 *
 * Node (`tsx`) resolves `./store` to `src/i18n/store.ts` — the NATIVE
 * implementation, backed by `expo-file-system`. Metro's `.web.ts` substitution
 * only happens in a web bundle. So under this runner, `switchLanguage` still
 * runs its real logic, but the persistence half writes through the native
 * store rather than `localStorage`.
 *
 * Rather than stub a module the runtime never loads, the storage-dependent
 * behaviour is asserted against the SOURCE (the `readStoredLanguage` guard and
 * the ordering of `persistLanguage` → flush → reload). The navigation and queue
 * behaviour, which IS reachable, is tested for real.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const load = () => import('@/src/features/settings/services/switch-language.web');

test('AC-18.8.1: pending writes drain before the reload', async () => {
  // Arrange — no stored language, so the switch is not a no-op.
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
    const changed = await switchLanguage('en');

    // Assert — the write must be recorded BEFORE the navigation.
    assert.equal(changed, true);
    assert.deepEqual(order, ['write', 'reload']);
  } finally {
    removeWindow();
    clearPendingWrites();
  }
});

test('the switch runs exactly one reload', async () => {
  // Arrange
  clearPendingWrites();
  const order: string[] = [];
  installWindow(order);

  const { switchLanguage } = await load();

  try {
    // Act
    await switchLanguage('en');

    // Assert — a second reload would race the first.
    assert.equal(order.filter((event) => event === 'reload').length, 1);
  } finally {
    removeWindow();
    clearPendingWrites();
  }
});

test('the source persists, THEN flushes, THEN reloads', async () => {
  // Arrange
  const source = readFileSync(
    'src/features/settings/services/switch-language.web.ts',
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Act
  const persist = source.indexOf('persistLanguage(');
  const flush = source.indexOf('flushPendingWrites(');
  const reload = source.indexOf('reload(');

  // Assert — the order in the file is the order at runtime.
  assert.ok(persist > 0, 'persistLanguage is not called');
  assert.ok(flush > persist, 'the flush must come AFTER persisting the choice');
  assert.ok(reload > flush, 'the reload must come AFTER the flush — or the write is lost');
});

test('the source skips the flush and the reload when nothing changes', async () => {
  // Arrange
  const source = readFileSync(
    'src/features/settings/services/switch-language.web.ts',
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Act — the no-op guard must exist and return before any side effect.
  const guard = source.indexOf('readStoredLanguage() === next');

  // Assert
  assert.ok(guard > 0, 'there is no no-op guard — a same-language switch would reload');
});

test('there is no restart prompt on web', async () => {
  // Arrange — a dialog explaining a page refresh is worse than the refresh.
  const source = readFileSync(
    'src/features/settings/services/switch-language.web.ts',
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Act / Assert
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
