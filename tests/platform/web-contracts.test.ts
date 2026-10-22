/**
 * The platform layer's web-side behaviour (PRD-18 §6).
 *
 * ★ THESE TEST THE CONTRACTS THE WEB IMPLEMENTATIONS MUST KEEP.
 *
 * Each web file has a native sibling with the SAME signature. `tsc` only ever
 * sees the shared interface, so a web implementation that returns a different
 * shape or calls things in the wrong order is a runtime bug with no type
 * error behind it. These assertions are the only thing standing between the
 * two implementations and a silent divergence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// ──────────────────────────────────────────────────────────────────────────
// The suffix contract
// ──────────────────────────────────────────────────────────────────────────

test('every platform capability has a shared interface AND both implementations', () => {
  // Arrange
  const capabilities = ['haptics', 'direction'];
  const components = ['features/venues/components/VenueMap'];

  // Act / Assert — a missing `.web` file is the export failure: Metro would
  // resolve the `.native` implementation on web and die at import time.
  for (const name of capabilities) {
    for (const suffix of ['.ts', '.native.ts', '.web.ts']) {
      const path = `src/platform/${name}${suffix}`;
      assert.ok(existsSync(path), `missing ${path}`);
    }
  }

  for (const name of components) {
    for (const suffix of ['.tsx', '.native.tsx', '.web.tsx']) {
      const path = `src/${name}${suffix}`;
      assert.ok(existsSync(path), `missing ${path} — the web export would break`);
    }
  }

  // The web-only Reduce Motion hook is the fourth file in the same family.
  assert.ok(existsSync('src/theme/useMotion.ts'), 'missing src/theme/useMotion.ts');
  assert.ok(existsSync('src/theme/useMotion.web.ts'), 'missing src/theme/useMotion.web.ts');
});

test('no shared platform file imports a native module', () => {
  // Arrange
  const shared = [
    'src/platform/haptics.ts',
    'src/platform/direction.ts',
    'src/platform/environment.ts',
    'src/features/venues/components/VenueMap.tsx',
    'src/features/venues/components/VenueMap.types.ts',
  ];

  // Act / Assert — a native import here is evaluated in the web bundle
  // whether or not a runtime branch would reach it.
  for (const path of shared) {
    const source = readFileSync(path, 'utf8');
    assert.ok(
      !/from ['"]expo-haptics['"]/.test(source),
      `${path} imports expo-haptics — it must only be imported by *.native.ts`,
    );
    assert.ok(
      !/from ['"]@rnmapbox\/maps['"]/.test(source),
      `${path} imports the native map — the web export would fail`,
    );
    assert.ok(
      !/import \{[^}]*I18nManager[^}]*\} from ['"]react-native['"]/.test(source),
      `${path} imports I18nManager — it is native-only`,
    );
  }
});

test('the web map fallback does not read as an error', () => {
  // Arrange
  const source = code('src/features/venues/components/VenueMap.web.tsx');

  // Act / Assert — AC-18.4.1: a designed fallback, not a failure state.
  assert.ok(source.includes('unavailableOnWeb'), 'the localized fallback copy is not used');
  assert.ok(!/textAlert|textDanger|errorColor|variant="danger"/.test(source), 'the fallback uses an error colour');
  assert.ok(!/retry/i.test(source), 'the fallback offers a retry that cannot succeed');
});

// ──────────────────────────────────────────────────────────────────────────
// Document direction (AC-18.7.1)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Strips comments, so an assertion about CODE cannot be satisfied or defeated
 * by the prose that explains it. These files are heavily commented with the
 * very identifiers the tests look for.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function withDocument(): { dir: string; lang: string } {
  const attrs: Record<string, string> = {};
  const fake = {
    setAttribute(name: string, value: string) {
      attrs[name] = value;
    },
  };
  (globalThis as { document?: unknown }).document = { documentElement: fake };
  return attrs as { dir: string; lang: string };
}

test('applyDirection sets rtl and fa on the document for Persian', async () => {
  // Arrange
  const attrs = withDocument();
  const { applyDirection } = await import('@/src/platform/direction.web');

  // Act
  applyDirection('fa');

  // Assert — both attributes: a missing `lang` also breaks font fallback.
  assert.equal(attrs.dir, 'rtl');
  assert.equal(attrs.lang, 'fa');

  delete (globalThis as { document?: unknown }).document;
});

test('applyDirection sets ltr and en on the document for English', async () => {
  // Arrange
  const attrs = withDocument();
  const { applyDirection } = await import('@/src/platform/direction.web');

  // Act
  applyDirection('en');

  // Assert
  assert.equal(attrs.dir, 'ltr');
  assert.equal(attrs.lang, 'en');

  delete (globalThis as { document?: unknown }).document;
});

test('applyDirection tolerates a missing document', async () => {
  // Arrange — the static export renders in Node, with no DOM.
  delete (globalThis as { document?: unknown }).document;
  const { applyDirection } = await import('@/src/platform/direction.web');

  // Act / Assert — it must not throw during the export.
  assert.doesNotThrow(() => applyDirection('fa'));
});

// ──────────────────────────────────────────────────────────────────────────
// Haptics (a no-op on web is correct, not a stub)
// ──────────────────────────────────────────────────────────────────────────

test('haptics.impact on web is a silent no-op', async () => {
  // Arrange
  const { haptics } = await import('@/src/platform/haptics.web');

  // Act / Assert — the platform has no haptic API; press feedback is CSS.
  assert.doesNotThrow(() => haptics.impact('light'));
  assert.doesNotThrow(() => haptics.impact('medium'));
  assert.doesNotThrow(() => haptics.impact('success'));
});

// ──────────────────────────────────────────────────────────────────────────
// Reduce Motion (Style Guide §7.7)
// ──────────────────────────────────────────────────────────────────────────

test('useMotion.web source reads prefers-reduced-motion, not AccessibilityInfo', () => {
  // Arrange
  const source = code('src/theme/useMotion.web.ts');

  // Act / Assert — AccessibilityInfo is native; on web it never resolves.
  assert.ok(source.includes('prefers-reduced-motion'), 'the media query is not read');
  assert.ok(!/AccessibilityInfo/.test(source), 'AccessibilityInfo does not work on web');
});

test('useMotion.web keeps the native return shape', () => {
  // Arrange
  const web = code('src/theme/useMotion.web.ts');
  const native = code('src/theme/useMotion.ts');

  // Act — the four feature flags must appear in BOTH, or a call site reads
  // `undefined` on one platform with no type error.
  const keys = ['reduce', 'enter', 'spring', 'parallax', 'orbit', 'sparkles', 'meetPointTravel'];

  // Assert
  for (const key of keys) {
    assert.ok(web.includes(key), `useMotion.web is missing "${key}"`);
    assert.ok(native.includes(key), `useMotion.ts is missing "${key}"`);
  }
});
