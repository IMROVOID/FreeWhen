/**
 * The one piece of the old hand-rolled map worth keeping.
 *
 * ★ EVERYTHING ELSE IN THIS MODULE WAS TILE-GRID GEOMETRY AND IS GONE.
 *
 * It held `MAP_TILE_SIZE`, `centreTileFor`, `tileOffsetFor`, `gridSpanFor`,
 * `gridOriginFor`, `tilesCover`, `translateCentre`, `clampCentre`, `tileIndexFor`
 * and the two `exactTile*` helpers — roughly 300 lines whose only consumer was the
 * `<Image>` grid inside `LocationMapPicker`. That grid has been replaced by a real
 * map library (`InteractiveMap`), which owns its own projection, its own camera
 * and its own pan arithmetic, correctly and natively.
 *
 * Keeping the arithmetic "in case" would leave two incompatible models of the same
 * map in the tree, and the next person would have to work out which one the screen
 * actually uses. It is deleted rather than exported.
 *
 * ★ WHAT SURVIVES IS FORMATTING, WHICH NO LIBRARY DOES FOR US.
 *
 * `formatCoordinates` is used by the picker's confirm card and by the propose
 * screen's chosen-place row. It has nothing to do with tiles, so it stays.
 */

/**
 * A coordinate written the way a map says it.
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
