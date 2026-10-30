/**
 * Web implementation: nothing to rebuild.
 *
 * ★ THE BROWSER RE-READS DIRECTION IMMEDIATELY.
 *
 * `applyDirection` sets `dir`/`lang` on `<html>`, and every CSS logical property
 * (`flex-direction` ordering via `direction`, `text-align: start`,
 * `padding-inline-start`) resolves against it on the next style pass. There is no
 * cached window direction to flush, which is why the web build never had this
 * defect — and why reloading the page here would be a regression, not a fix.
 */
export function reloadForDirection(): void {
  // Deliberately empty — see the note above.
}
