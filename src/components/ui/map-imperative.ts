/**
 * The two commands a caller may send to a map surface on purpose.
 *
 * ★ ZOOM IS IMPERATIVE, AND THAT IS THE POINT.
 *
 * The camera prop is a POSE the caller asks for; a gesture must never be undone by
 * the pose it reported. A zoom button written as `setZoom(z + 1)` is the same
 * mistake in a different place: it writes the caller's state, the renderer reads a
 * new camera key, and the map jumps back to the centre it was built with — which
 * is the reported "when I zoom, the map returns to the pin".
 *
 * So the control asks the SURFACE to zoom, exactly as a pinch would, and the
 * camera stays wherever the reader left it.
 *
 * The type lives in a plain module (not a `.web`/`.native` file) because callers
 * import it and `tsc` does not resolve platform suffixes.
 */

/** What a map surface exposes through its ref. */
export interface MapSurfaceHandle {
  /** Zooms by `delta` levels about the current centre. */
  zoomBy(delta: number): void;
  /** Frames the camera without touching the caller's state. */
  recentre(): void;
}

/** The two levels one press of a control may move. */
export const ZOOM_STEP = 1;

/**
 * What one press of a zoom control should do.
 *
 * ★ THE CAMERA IS NOT WRITTEN, AND THAT IS THE FIX FOR A REPORTED DEFECT.
 *
 * The picker's `+`/`−` used to do `setZoom(current + delta)`, i.e. write the pose
 * the map was built with. The renderer sees a new `cameraKey` and `jumpTo`s back to
 * the pose's centre — so zooming snapped the map back to the pin the selection was
 * placed at, and the reader could not look anywhere else (the reported "it is like
 * the pin is always the pivot").
 *
 * A pinch does not do that: it changes the map's camera and reports it upward, and
 * nothing writes it back. So a control asks the SURFACE for the same thing, through
 * its imperative handle. The only question left is whether there IS a surface to
 * ask — a build with no basemap draws none, and a press must then do nothing rather
 * than crash.
 */
export function zoomControlAction(
  handle: { zoomBy(delta: number): void } | null | undefined,
  delta: number,
): boolean {
  if (!handle) return false;
  if (!Number.isFinite(delta) || delta === 0) return false;

  handle.zoomBy(delta);
  return true;
}
