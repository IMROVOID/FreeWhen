/**
 * Event search matching (Plan 49 T11).
 *
 * ★ CASE-INSENSITIVE, AND THAT IS NOT A DETAIL.
 *
 * Autocapitalisation is on by default on a phone, so a case-sensitive search
 * finds nothing when the reader types the title of the event they are looking at
 * in the list behind the sheet. It reads as a broken feature rather than a strict
 * one.
 *
 * Kept apart from the sheet component so the rule can be tested without mounting
 * a bottom sheet — the component's import graph reaches the gesture library, which
 * has no meaningful behaviour under the Node test runner.
 */

/** Whether a title matches the typed query. An empty query matches everything. */
export function matchesQuery(title: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;

  return title.toLowerCase().includes(needle);
}
