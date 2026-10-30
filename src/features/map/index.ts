/**
 * The adapter factory (Plan 08 Task 7, Plan 64).
 *
 * ★ THE ONLY PLACE A RENDERER IS CONSTRUCTED.
 *
 * The screen and the list never change with the renderer: they talk to
 * `MapAdapter` and nothing else. Levels 1 and 2 need a platform module, and
 * importing one behind a conditional would still break the wrong bundle at import
 * time, so the construction is confined here and the platform substitution
 * (`InteractiveMap.web.tsx` / `.native.tsx`) handles the split.
 *
 * The reported level is the CONFIGURED one, so `map_viewed.render_level`
 * distinguishes "no map was configured" (3–4) from "a map crashed" (the error
 * boundary, which reports 4 after catching).
 */

import { NullMapAdapter } from './null-adapter';
import { MapboxMapAdapter } from './mapbox-adapter';
import { resolveMapLevel } from './level';
import { hasMapbox } from './mapbox-token';
import type { MapAdapter } from './types';

export type MapPlatform = 'native' | 'web' | 'node';

export { MapboxMapAdapter } from './mapbox-adapter';

/**
 * Builds the adapter for this platform.
 *
 * ★ LEVEL 1 IS NOW REACHABLE, AND ONLY WHEN A TOKEN EXISTS.
 *
 * Before Plan 64 every level resolved to the null adapter because no renderer was
 * installed. Now:
 *
 *  - a build with a MapBox public token gets `MapboxMapAdapter`, on native AND on
 *    the web (level 1);
 *  - a build without one still resolves down the ladder, and reports the level it
 *    actually reached — never level 1 with nothing drawn.
 *
 * That last sentence is the whole reason `hasMapbox()` is checked here as well as
 * in `resolveMapLevel`: the level says what a build is configured for, and this
 * says what it can actually construct. A `MapboxMapAdapter` that drew nothing while
 * claiming level 1 would make the analytics number a lie.
 */
export function createMapAdapter(platform: MapPlatform): MapAdapter {
  const level = resolveMapLevel(platform);

  if (level === 1 && hasMapbox()) return new MapboxMapAdapter();

  return new NullMapAdapter(level);
}
