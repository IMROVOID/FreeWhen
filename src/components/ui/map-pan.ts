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
 * The tile grid's placement and size for a measured frame.
 *
 * ★ THE GRID IS CENTRED ON THE FRAME, AND THAT IS A VISUAL FIX.
 *
 * The picker pins its layer at `left/top: -TILE_SIZE`, which is only right when
 * the frame is exactly three tiles across — the shift assumes the centre tile's
 * origin coincides with the frame's origin. The frame is `100%` wide and
 * `MAP_HEIGHT` tall, so it almost never is, and the measured result was a 768 px
 * grid inside a 480×538 frame (desktop) or 350×538 (phone): 294 px and 246 px of
 * the frame had no tile at all, showing the placeholder in rectangles. That is
 * the reported "the separate map segments are not aligned, not seamless".
 *
 * Two things make coverage a property rather than a hope:
 *
 *  1. the origin places the MIDDLE slot of the grid at the frame's middle, so the
 *     drag translate (`-tileOffset`, which is bounded to ±half a tile) keeps the
 *     frame covered instead of walking the picture off an edge;
 *  2. the grid grows in rings until it is at least as large as the frame in both
 *     axes, so a frame wider than one tile-span gets more columns rather than a
 *     hole.
 *
 * A 3×3 grid on a 768×768 frame reproduces the old constant exactly, so the case
 * that used to be right does not move.
 */

/** The grid's tile count, and its placement is `gridOriginFor`'s job. */
export interface TileGrid {
  /** How many tiles per side. Always odd, so there is a true middle slot. */
  count: number;
}

/** The frame's measured size, or zeroes before its first layout pass. */
export interface CanvasSize {
  canvasWidth: number;
  canvasHeight: number;
}

/** The largest sub-tile distance `tileOffsetFor` can produce, in pixels. */
const MAX_SUB_TILE = MAP_TILE_SIZE / 2;

/**
 * The smallest odd tile count whose grid covers `size` with drag slack.
 *
 * ★ THE SLACK IS ADDED TO THE GRID, NOT TO THE DIVISION.
 *
 * Dividing first and rounding after is what produced a three-tile grid for a 538
 * px frame: `538 + 256` divides to 3.1, "round up to odd" lands on 3, and a
 * three-tile grid is exactly 768 — two hundred px short of covering 538 plus the
 * half-tile the drag can travel in each direction. The requirement is on the
 * EXTENT, so the count is solved from it and then made odd.
 */
function countFor(size: number): number {
  const needed = size + MAX_SUB_TILE * 2;
  let count = Math.max(1, Math.ceil(needed / MAP_TILE_SIZE));
  if (count % 2 === 0) count += 1;
  return Math.max(3, count);
}

/**
 * The grid's tile count, large enough that the frame stays covered at ANY drag.
 *
 * ★ THE DRAG IS PART OF THE SIZE REQUIREMENT, AND THAT WAS THE HOLE.
 *
 * A grid exactly as wide as the frame covers it only at zero offset. The
 * translate moves it by up to half a tile in each direction, so the grid has to
 * exceed the frame by that much on both sides — otherwise coverage fails at the
 * extremes, which is a seam that appears and disappears while dragging.
 */
export function gridSpanFor({ canvasWidth, canvasHeight }: CanvasSize): TileGrid {
  const width = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : MAP_TILE_SIZE * 3;
  const height = Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : MAP_TILE_SIZE * 3;

  return {
    count: Math.max(countFor(width), countFor(height)),
  };
}

/**
 * The grid's origin, so its own centre sits on the frame's centre.
 *
 * ★ THE WHOLE GRID IS CENTRED, NOT JUST THE MIDDLE SLOT.
 *
 * The old constant (`-TILE_SIZE`) put the centre tile's origin on the frame's
 * origin, which is right only when the frame is exactly one tile-span. Centring
 * the grid means the centre tile is at the frame's centre and the surplus rings
 * extend symmetrically past every edge, so a drag in either direction has slack
 * to give instead of running out at an edge.
 */
export function gridOriginFor({ canvasWidth, canvasHeight }: CanvasSize): { left: number; top: number } {
  const width = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : MAP_TILE_SIZE * 3;
  const height = Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : MAP_TILE_SIZE * 3;

  const { count } = gridSpanFor({ canvasWidth: width, canvasHeight: height });
  const extent = count * MAP_TILE_SIZE;

  // A tile-grid offset in a pixel plane, not a text-direction inset: the grid is
  // centred on the frame, so there is no reading edge to mirror.
  return {
    left: (width - extent) / 2, // rtl-ok: tile-grid offset, symmetric about the frame
    top: (height - extent) / 2,
  };
}

/** A rectangle, in the frame's coordinate space. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Whether a set of tiles covers a rectangle completely.
 *
 * Used by the test as the property, rather than a magic expected offset: the rule
 * is "no pixel of the frame shows background", which survives any future change
 * to tile size, ring count or measured frame.
 */
export function tilesCover(frame: Rect, tiles: readonly Rect[]): boolean {
  // Sample the frame on a grid finer than any gap that could hide between tiles.
  const step = 4;

  for (let y = frame.top; y <= frame.bottom; y += step) {
    for (let x = frame.left; x <= frame.right; x += step) {
      const covered = tiles.some(
        (tile) => x >= tile.left && x <= tile.right && y >= tile.top && y <= tile.bottom,
      );
      if (!covered) return false;
    }
  }

  return true;
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
