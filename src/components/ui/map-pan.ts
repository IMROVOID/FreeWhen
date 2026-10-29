/**
 * The arithmetic behind the map's drag, kept out of the component.
 *
 * ★ PURE, SO THE PAN CAN BE PINNED WITHOUT A GESTURE.
 *
 * `PanResponder` cannot be driven from a Node test, and both defects in this map
 * were entirely arithmetic: a per-frame delta applied as an absolute offset, and
 * a tile grid that jumped at every tile boundary. Moving the projection here means
 * the properties that broke are assertions rather than review notes.
 *
 * ★ WHY THE CENTRE MOVES AND THE TILES DO.
 *
 * The picker renders a 3x3 grid of 256px tiles keyed on `zoom-{tx}-{ty}`. Nothing
 * scrolls them: the grid is re-derived from the centre every render. So a drag only
 * becomes visible through the grid's SUB-TILE translation, which is what
 * `tileOffsetFor` computes.
 *
 * ★ THE TICK WAS A WRAP AROUND THE WRONG ANCHOR.
 *
 * The offset used to be the centre's fractional position inside its own
 * whole-number tile: `(exact.x % 1)`. That is continuous inside a tile and jumps
 * from ~1 back to ~0 the instant the index advances — a full 256px snap backwards
 * on exactly the frame the new tiles arrive. On screen that is the map "ticking
 * back" while the finger keeps moving, which is the reported behaviour.
 *
 * A slippy map has no such discontinuity. The translate that puts the centre point
 * under the crosshair is the distance from the CENTRE TILE'S ORIGIN to the centre
 * point, and if the tile index is chosen as the NEAREST tile rather than the
 * FLOORED one, that distance always lies in `[-0.5, 0.5)` and is continuous across
 * every boundary. `tileOffsetFor` returns exactly that, and
 * `tests/ui/map-pan-continuity.test.ts` walks a drag pixel-by-pixel to prove it.
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

/**
 * The exact fractional tile COLUMN of a longitude, at a zoom.
 *
 * Exported because the continuity property is about where a tile is drawn, which
 * is a function of the fractional coordinate rather than of a rounding choice —
 * see `tests/ui/map-pan-continuity.test.ts`.
 */
export function exactTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

/** The exact fractional tile ROW of a latitude, at a zoom. Mercator, so not linear. */
export function exactTileY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom;
}

/** The whole-number tile a centre is inside. */
export function tileIndexFor(lat: number, lng: number, zoom: number): TileIndex {
  const exact = toTileExact(lat, lng, zoom);
  return { x: Math.floor(exact.x), y: Math.floor(exact.y) };
}

/**
 * The tile the grid is centred on.
 *
 * The NEAREST whole tile, not the floored one — see the note at the top of this
 * file: this choice is what gives the translate a discontinuity-free domain of
 * `[-0.5, 0.5)`.
 */
export function centreTileFor(lat: number, lng: number, zoom: number): TileIndex {
  const exact = toTileExact(lat, lng, zoom);
  return { x: Math.round(exact.x), y: Math.round(exact.y) };
}

/**
 * How far the tile grid must move, in CSS pixels, to put the centre point under
 * the crosshair.
 *
 * ★ THE ANCHOR IS THE MIDDLE SLOT, AND THAT IS WHY THIS IS CONTINUOUS.
 *
 * The picker lays out a 3x3 grid inside a layer offset by `-TILE_SIZE`, so the
 * grid's MIDDLE column and row sit at the frame's origin. The tile list is built
 * as `centreTile + [-1, 0, 1]`, so the middle slot always holds `centreTile`.
 *
 * The translate therefore has to put `centreTile`'s origin under the crosshair —
 * which is `(exact − centreTile) * TILE_SIZE`, the distance from the centre point
 * to the tile that is actually drawn in the middle slot.
 *
 * ★ MEASURING FROM THE FLOORED TILE IS THE TICK.
 *
 * The original used `(exact % 1)`, i.e. the position inside the FLOORED tile.
 * That is the distance from a tile that is only in the middle slot when the
 * centre is in the first half of it; for the second half the grid holds a
 * different tile there, so the translate was measured against the wrong anchor and
 * the picture sat up to a tile out — snapping back by 256px every time the index
 * advanced. That snap is the reported "the map ticks back while I drag it".
 *
 * With `Math.round`, the offset lies in `[-0.5, 0.5) * TILE_SIZE` and varies
 * continuously with the centre, including across a boundary.
 */
export function tileOffsetFor(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const exact = toTileExact(lat, lng, zoom);
  const centre = centreTileFor(lat, lng, zoom);

  return {
    x: (exact.x - centre.x) * MAP_TILE_SIZE,
    y: (exact.y - centre.y) * MAP_TILE_SIZE,
  };
}

/**
 * How far one CSS pixel of drag moves the centre, in degrees.
 *
 * Longitude is linear — the whole world is 360° across `2^zoom` tiles. Latitude
 * is not, because the projection is Mercator: a pixel covers more ground the
 * further north or south the centre is, which is what `cos(lat)` corrects for.
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
 * caller is responsible for subtracting the last seen value — this module exists
 * partly because that subtraction was missing, which made every frame re-apply the
 * whole drag so far.
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
