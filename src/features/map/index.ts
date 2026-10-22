/**
 * The adapter factory (Plan 08 Task 7).
 *
 * ★ THE ONLY PLACE A RENDERER WOULD BE CONSTRUCTED.
 *
 * Levels 1 and 2 need a native module this build does not ship, and importing
 * one behind a conditional would still break the web bundle and the Node test
 * runner at import time. When a renderer is added, it is constructed here and
 * nowhere else — the screen and the list never change.
 *
 * The reported level is the CONFIGURED one, so `map_viewed.render_level`
 * distinguishes "no map was configured" (3–4) from "a map crashed" (the
 * error boundary, which reports 4 after catching).
 */

import { NullMapAdapter } from './null-adapter';
import { resolveMapLevel } from './level';
import type { MapAdapter } from './types';

export type MapPlatform = 'native' | 'web' | 'node';

/**
 * Builds the adapter for this platform.
 *
 * Every level currently resolves to the null adapter, because no renderer is
 * installed. That is the honest position: the props, the camera framing and
 * the selection wiring are real and tested; only the drawing is absent, and
 * the level says so.
 */
export function createMapAdapter(platform: MapPlatform): MapAdapter {
  return new NullMapAdapter(resolveMapLevel(platform));
}
