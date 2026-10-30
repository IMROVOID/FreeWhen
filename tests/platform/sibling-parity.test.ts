/**
 * The two platform siblings of a service must export the SAME shape.
 *
 * ★ A DIVERGENT SIBLING IS A PLATFORM-ONLY CRASH `tsc` CANNOT SEE.
 *
 * Metro picks a file by its NAME — `switch-language.web.ts` on the web bundle,
 * `switch-language.ts` everywhere else — so `tsc` type-checks whichever one the
 * import graph happens to reach and never compares the two. When the native
 * sibling grew `chooseLanguage` and the web one did not, Settings' import
 * resolved to `undefined` in the browser only: the first tap on a language threw
 * `undefined is not a function` inside an `async` handler, the `await` never
 * settled, and the control stayed `aria-disabled` for the rest of the session.
 * That is the reported "I can't switch back to Persian — clicking does nothing",
 * and it was invisible to the type checker and to every passing unit test.
 *
 * This walks the pairs that matter and compares the export surface by reading
 * the source. It is deliberately a SOURCE comparison: importing both would give
 * this runner the two modules, but not the guarantee that a third pair added
 * later is checked.
 */

import '../ui/support/register';

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Every `<name>.ts` / `<name>.web.ts` pair whose contract the app relies on.
 *
 * A pair belongs here when a SHARED call site imports it — i.e. when Metro's
 * choice between the two is invisible to the caller.
 */
const PAIRS = [
  'src/features/settings/services/switch-language',
  'src/platform/direction',
  'src/platform/direction-reload',
  'src/platform/environment',
  'src/platform/haptics',
  'src/i18n/store',
];

function exportedNames(path: string): { values: string[]; types: string[] } {
  const source = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const values = new Set<string>();
  const types = new Set<string>();

  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    values.add(match[1]!);
  }
  for (const match of source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) {
    values.add(match[1]!);
  }
  for (const match of source.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*)/g)) {
    types.add(match[1]!);
  }
  for (const match of source.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)/g)) {
    types.add(match[1]!);
  }
  // `export { a, b };` re-exports, which count as exports of this module. A
  // `export type { … }` is type-only and erases at runtime, so it is tracked
  // separately — a name that exists as a TYPE on one side and not the other
  // cannot cause the runtime crash this file exists to prevent.
  for (const match of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    const bucket = match[1] ? types : values;
    for (const piece of (match[2] ?? '').split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) bucket.add(name);
    }
  }

  return { values: [...values].sort(), types: [...types].sort() };
}

for (const base of PAIRS) {
  const native = `${base}.ts`;
  const web = `${base}.web.ts`;

  test(`${base}: the web sibling exports every VALUE its shared sibling does`, () => {
    // Arrange
    assert.ok(existsSync(native), `${native} is missing`);
    assert.ok(existsSync(web), `${web} is missing`);

    // Act
    const nativeNames = exportedNames(native);
    const webNames = new Set(exportedNames(web).values);

    // Assert — a missing VALUE is the crash. A missing type cannot be, because
    // types erase; the type check covers those and this test does not pretend to.
    const missing = nativeNames.values.filter((name) => !webNames.has(name));

    assert.deepEqual(
      missing,
      [],
      `${web} is missing ${missing.join(', ')} — a shared import of those resolves to undefined on web`,
    );
  });
}

test('settings imports a name the web sibling actually exports', () => {
  // Arrange — the exact call site that broke.
  const settings = readFileSync('src/features/settings/components/LanguageToggle.tsx', 'utf8');
  const webExports = new Set(exportedNames('src/features/settings/services/switch-language.web.ts').values);

  // Act
  const imported = /import\s*\{([^}]*)\}\s*from\s*'@\/src\/features\/settings\/services\/switch-language'/.exec(
    settings,
  )?.[1];

  // Assert
  assert.ok(imported, 'the toggle no longer imports the switch service');
  for (const name of imported!.split(',').map((piece) => piece.trim()).filter(Boolean)) {
    assert.ok(webExports.has(name), `the toggle imports ${name}, which the web sibling does not export`);
  }
});
