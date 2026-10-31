/**
 * The camera, compared by value.
 *
 * ★ THIS MODULE IMPORTS NOTHING, AND THAT IS WHY IT EXISTS.
 *
 * `cameraKey` started life in `InteractiveMap.tsx`, which looks like the natural
 * home for it — it is the file both renderers share. But that file is the
 * TYPE-SYSTEM FALLBACK: its body is a `throw`, because Metro substitutes a platform
 * sibling at build time and `tsc` only needs a suffix-free module to resolve.
 *
 * So a VALUE defined there is a value that throws when the bundle is built by
 * something that does not apply Metro's substitution — which is exactly what happened:
 * `expo export` (the static web render) failed with
 * `TypeError: (0 , l.cameraKey) is not a function`, taking the whole web deployment
 * down. `tsc` was clean, because to `tsc` the function exists.
 *
 * The same rule `src/features/map/projection.ts` states applies here: the renderers
 * draw, this file decides. Keeping the arithmetic out of both renderers is also what
 * lets it be asserted without a canvas.
 */

/** The camera as one comparable string. */
export interface CameraPose {
  centre: { lat: number; lng: number };
  zoom: number;
  pitch: number;
  bearing: number;
}

/**
 * The camera as one comparable string.
 *
 * ★ EQUALITY BY VALUE IS WHAT SEPARATES "THE USER MOVED" FROM "SOMETHING RE-RENDERED".
 *
 * A caller builds its camera from state and memoized bounds, so the object identity
 * changes on renders that did not move anything. Comparing the values means only a
 * real change re-frames the map — which is what stops a pinch or a tilt being
 * cancelled by the report of its own result.
 *
 * Four decimals is about 11 m of latitude and finer than the smallest zoom step, so a
 * rounding difference cannot be mistaken for a deliberate move.
 */
export function cameraKey(camera: CameraPose): string {
  const round = (value: number): number => Math.round(value * 10_000) / 10_000;

  return [
    round(camera.centre.lat),
    round(camera.centre.lng),
    round(camera.zoom),
    round(camera.pitch),
    round(camera.bearing),
  ].join(',');
}
