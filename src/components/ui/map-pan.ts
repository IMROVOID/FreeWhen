/**
 * The arithmetic behind the map's drag, kept out of the component.
 *
 * ★ PURE, SO THE PAN CAN BE PINNED WITHOUT A GESTURE.
 *
 * `PanResponder` cannot be driven from a Node test, and the defect that made the
 * map look frozen was entirely arithmetic: a per-frame delta was applied as if it
 * were an offset from the start of the drag. Moving the projection here means the
 * property that broke — *n* equal steps travel the same distance as one step *n*
 * times as large — is an assertion rather than a review note.
 *
 * ★ WHY THE CENTRE MOVES AND THE TILES DO.
 *
 * The picker renders a 3x3 grid of 256px tiles keyed on `zoom-{tx}-{ty}`. Nothing
 * scrolls them: the grid is re-derived from the centre every render. So a drag
 * only becomes visible when the centre crosses a whole tile boundary and the keys
 * change — which is what `tileIndexFor` exists to make checkable.
 */

/** One slippy tile, in CSS pixels. */
export const MAP_TILE_SIZE = 256;

/** The projection is undefined at the poles; every tiler stops at this. */
const MAX_LATITUDE = 85;

/** A point on the map. */
export interface MapCentre {
  lat: number;
  lng: number;
}

/** The tile column and row a centre falls in, at a zoom. */
export interface TileIndex {
  x: number;
  y: number;
}

/** The exact (fractional) slippy coordinates of a centre. */
function toTileExact(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** The whole-number tile a centre is inside. */
export function tileIndexFor(lat: number, lng: number, zoom: number): TileIndex {
  const exact = toTileExact(lat, lng, zoom);
  return { x: Math.floor(exact.x), y: Math.floor(exact.y) };
}

/**
 * How far into its own tile the centre sits, in whole tiles.
 *
 * ★ THE TILE GRID ALONE CANNOT SHOW A PAN.
 *
 * The picker draws a 3x3 grid of 256px tiles centred on the frame and re-derives
 * it from the centre on every render. Keying a tile on `zoom-tx-ty` swaps which
 * URL goes in which slot, but the grid never leaves the middle of the frame, so
 * a drag that does not cross a tile boundary changes nothing a person can see —
 * which is exactly the "the coordinates update but the map doesn't move" report.
 *
 * The visible movement is the residual: the fractional part of the centre's
 * position inside its centre tile. Translating the grid by `-residual * tileSize`
 * slides the picture under the pin continuously, and because the residual is
 * always in `[0, 1)` the 3x3 grid still covers the frame at every step.
 *
 * Both axes are wrapped into `[0, 1)`: panning west makes the exact coordinate
 * decrease, and a residual of `-0.2` would translate the grid a fifth of a tile
 * the wrong way and show the frame's edge.
 */
export function offsetWithinTile(lat: number, lng: number, zoom: number): TileIndex {
  const exact = toTileExact(lat, lng, zoom);
  const wrap = (value: number) => ((value % 1) + 1) % 1;
  return { x: wrap(exact.x), y: wrap(exact.y) };
}

/**
 * How far one CSS pixel of drag moves the centre, in degrees.
 *
 * Longitude is linear — the whole world is 360° across `2^zoom` tiles. Latitude
 * is not, because the projection is Mercator: a pixel covers more ground the
 * further north or south the centre is, which is what `cos(lat)` corrects for.
 *
 * ★ This is the step for `1` pixel; `1 / (2^zoom)` is what makes a pan *look*
 * the same at every zoom.
 */
function degreesPerPixel(lat: number, zoom: number): { lat: number; lng: number } {
  const span = MAP_TILE_SIZE * 2 ** zoom;
  return {
    lng: 360 / span,
    lat: (360 / span) * Math.cos((lat * Math.PI) / 180),
  };
}

/**
 * Moves the centre by a drag DELTA, in CSS pixels.
 *
 * ★ THE ARGUMENTS ARE PER-FRAME MOVEMENT, NOT DISTANCE SINCE THE GESTURE BEGAN.
 *
 * `PanResponderGestureState.dx`/`dy` are measured from the touch's start, and the
 * caller is responsible for subtracting the last seen value — `map-drag.ts` exists
 * because that subtraction was missing, which made every frame re-apply the whole
 * drag so far.
 *
 * The sign is inverted on purpose: dragging the map to the right moves the VIEW
 * west, which is a smaller longitude, and dragging down moves the view north.
 */
export function translateCentre(
  from: MapCentre,
  dx: number,
  dy: number,
  zoom: number,
): MapCentre {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(zoom)) return from;

  const step = degreesPerPixel(from.lat, zoom);

  return clampCentre({
    lat: from.lat + dy * step.lat,
    lng: from.lng - dx * step.lng,
  });
}

/** Holds a centre inside the region the projection can draw. */
export function clampCentre(centre: MapCentre): MapCentre {
  const lat = Number.isFinite(centre.lat) ? centre.lat : 0;
  const lng = Number.isFinite(centre.lng) ? centre.lng : 0;

  return {
    lat: Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)),
    // Wrapped rather than clamped: the map is a cylinder, and panning east off
    // the antimeridian should arrive in the west rather than stop dead.
    lng: ((((lng + 180) % 360) + 360) % 360) - 180,
  };
}

/**
 * A centre written the way a map says it, for the chosen-place line.
 *
 * ★ THE HEMISPHERE, NOT A MINUS SIGN.
 *
 * `-33.8688` is a quantity. `33.8688° S` is a place, and it reads correctly in
 * both directions — an RTL layout renders a leading `-` on the wrong side of the
 * number often enough that a Persian reader sees a positive latitude.
 *
 * Four decimals is about 11 m, which is finer than a pin can be placed.
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latitude = `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`;
  const longitude = `${Math.abs(lng).toFixed(4)}° ${lng < 0 ? 'W' : 'E'}`;
  return `${latitude}, ${longitude}`;
}
