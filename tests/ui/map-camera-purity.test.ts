/**
 * A value both renderers share must not live in the platform-substituted fallback.
 *
 * ★ THIS IS THE BUG THAT TOOK THE WEB DEPLOYMENT DOWN, AND `tsc` SAID IT WAS FINE.
 *
 * `cameraKey` was written into `InteractiveMap.tsx` — the natural-looking home, since
 * that is the file both renderers import their TYPES from. But that file is the
 * fallback: its body is a `throw`, and Metro substitutes a real sibling at build time.
 * Anything that builds the bundle WITHOUT Metro's substitution therefore links a value
 * that throws.
 *
 * `expo export --platform web` is exactly that. It failed with
 *
 *   TypeError: (0 , l.cameraKey) is not a function
 *   Failed to statically export route: e/[token]/location
 *
 * and every route behind it failed with it. `tsc --noEmit` was clean throughout,
 * because to the type checker the function exists.
 *
 * ★ THE RULE, AS A TEST.
 *
 * `InteractiveMap.tsx` may export TYPES and the throwing component. Any other value a
 * renderer needs belongs in a pure module — `map-camera.ts` for the camera key,
 * `src/features/map/projection.ts` for the geometry. `src/platform/README.md` states
 * the same rule for the platform seams, and this file holds the map surface to it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { cameraKey } from '@/src/components/ui/map-camera';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FALLBACK = code('src/components/ui/InteractiveMap.tsx');
const WEB = code('src/components/ui/InteractiveMap.web.tsx');
const NATIVE = code('src/components/ui/InteractiveMap.native.tsx');

/* ── The rule ─────────────────────────────────────────────────────────────── */

test('the fallback file exports no value a renderer would call', () => {
  // Arrange — the only permitted value export is the throwing component itself,
  // which is what makes an unresolvable import fail loudly rather than silently.
  const valueExports = [...FALLBACK.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);

  // Assert
  assert.deepEqual(
    valueExports,
    ['InteractiveMap'],
    `the fallback exports values a platform bundle would link: ${valueExports.join(', ')}`,
  );
  assert.doesNotMatch(FALLBACK, /^export const /m, 'the fallback exports a constant');
});

test('neither renderer imports a value from the fallback', () => {
  // Arrange — `import type` is erased at compile time and is safe; a plain import is
  // a link to the body, which throws.
  const plainImports = [WEB, NATIVE].flatMap((source) =>
    [...source.matchAll(/^import \{([^}]+)\} from '\.\/InteractiveMap';/gm)].flatMap((m) =>
      (m[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean),
    ),
  );

  // Assert
  assert.deepEqual(plainImports, [], `a renderer imports ${plainImports.join(', ')} from the fallback`);
  assert.match(WEB, /import type \{[^}]*\} from '\.\/InteractiveMap';/);
  assert.match(NATIVE, /^} from '\.\/InteractiveMap';$/m);
});

test('both renderers take the camera key from the pure module', () => {
  // Assert
  assert.match(WEB, /import \{ cameraKey \} from '\.\/map-camera';/);
  assert.match(NATIVE, /import \{ cameraKey \} from '\.\/map-camera';/);
});

test('the pure module imports nothing', () => {
  // Arrange — an import here would drag a platform dependency back into the seam this
  // module exists to be free of.
  const imports = [...code('src/components/ui/map-camera.ts').matchAll(/^import .*$/gm)];

  // Assert
  assert.deepEqual(imports, [], 'map-camera.ts imports something, so it is no longer pure');
});

/* ── The key's own behaviour ─────────────────────────────────────────────── */

test('the key is equal for equal poses and different for a real move', () => {
  // Arrange — this is what separates "the user moved" from "something re-rendered",
  // and it is the reason a pinch or a tilt is no longer cancelled by its own report.
  const pose = { centre: { lat: 35.6892, lng: 51.389 }, zoom: 15, pitch: 50, bearing: 0 };

  // Act / Assert
  assert.equal(cameraKey({ ...pose }), cameraKey(pose), 'a rebuilt equal pose changed the key');
  assert.notEqual(cameraKey({ ...pose, zoom: 16 }), cameraKey(pose), 'a zoom is not a change');
  assert.notEqual(cameraKey({ ...pose, pitch: 20 }), cameraKey(pose), 'a tilt is not a change');
  assert.notEqual(
    cameraKey({ ...pose, centre: { lat: 35.7, lng: 51.389 } }),
    cameraKey(pose),
    'a pan is not a change',
  );
});

test('a sub-metre difference does not count as a move', () => {
  // Arrange — a float jitter of 1e-9 degrees is 0.1 mm, and treating it as a pose
  // change would re-frame the map on every report.
  const base = { centre: { lat: 35.6892, lng: 51.389 }, zoom: 15, pitch: 50, bearing: 0 };
  const jittered = { ...base, centre: { lat: 35.6892 + 1e-9, lng: 51.389 } };

  // Assert
  assert.equal(cameraKey(jittered), cameraKey(base));
});
