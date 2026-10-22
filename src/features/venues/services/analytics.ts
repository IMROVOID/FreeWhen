/**
 * Ranked-view analytics (Plan 08 Task 12, PRD-04 §9).
 *
 * ★ `map_viewed.render_level` IS A KEY METRIC, NOT A DECORATION.
 *
 * If levels 3–4 show up in the user test, the map is not a viable dependency
 * and the list-first design is vindicated. That decision needs data, so the
 * level is recorded per map view and monitored deliberately rather than
 * assumed to work.
 *
 * ★ NO COORDINATE, EVER.
 *
 * `lat`, `lng`, `accuracy` and every position key are on the forbidden list
 * in `redact.ts`, which scrubs them before they reach a sink. These payloads
 * are closed scalar sets as well, so there is no field a position could even
 * be attached to — the belt and the braces.
 */

import { logSafe } from '@/src/lib/redact';
import type { Lens } from '@/src/engine/types';
import type { MapRenderLevel } from '@/src/features/map/types';

/** A map was shown, at whichever rung of the ladder survived. */
export function trackMapViewed(renderLevel: MapRenderLevel): void {
  logSafe('map_viewed', { render_level: renderLevel });
}

/** The map threw and the screen fell back to list-only. */
export function trackMapRenderFailed(renderLevel: MapRenderLevel): void {
  logSafe('map_render_failed', { level_reached: renderLevel });
}

/**
 * A venue was chosen, from the list or from a pin.
 *
 * `source` is the interesting half: it says whether the map is earning its
 * place or whether everyone is using the list.
 */
export function trackVenueSelected(rank: number, source: 'list' | 'map'): void {
  logSafe('venue_selected', { rank, source });
}

/** The detail panel was opened, and whether a map was available to reach it. */
export function trackVenueDetailOpened(rank: number, renderLevel: MapRenderLevel): void {
  logSafe('venue_detail_opened', { rank, render_level: renderLevel });
}

/** The lens changed. Recorded because it says which questions people ask. */
export function trackLensChanged(from: Lens, to: Lens): void {
  logSafe('lens_changed', { from, to });
}

/**
 * The ranking could not be produced at all.
 *
 * Distinct from `NoVenueMeetsThreshold`, which is a working answer.
 */
export function trackRankingFailed(reason: 'transport' | 'refused'): void {
  logSafe('ranking_failed', { reason });
}
