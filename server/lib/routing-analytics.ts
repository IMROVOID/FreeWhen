/**
 * The routing analytics.
 *
 * ★ `ranking_degraded.level_reached` IS A KEY METRIC.
 *
 * PRD-05 §16 names it as such: if the demo never reaches level 1, the
 * routing assumption failed and the labelled fallback is carrying the
 * product. That is a finding to REPORT, not to hide — so the event fires
 * once per resolution, whatever the level, and it fires for a healthy
 * resolution too (a level 1 is evidence the metric works).
 *
 * ★ NOTHING SENSITIVE TRAVELS IN THESE PAYLOADS.
 *
 * No coordinate, no key, no participant name. The event id is the only
 * identifier, and it is the event's own id rather than a user's.
 */

import { logSafe } from '@/src/lib/redact';
import type { DegradationReason } from '@/src/routing/ladder';

/**
 * The routing events this phase emits.
 *
 * A closed set, so a typo cannot invent a new event and so the analytics
 * table's `event_name` constraint has a known domain.
 */
export type RoutingEvent = 'ranking_degraded' | 'transit_proxy_used';

/**
 * Emits a routing event.
 *
 * The payload is a closed set of scalars — no `unknown` bag — so a caller
 * cannot attach a coordinate or a key by accident.
 */
export function trackRouting(
  event: RoutingEvent,
  properties: Record<string, string | number | boolean | null>,
): void {
  // `logSafe` redacts by key AND scrubs coordinate-shaped strings, so a
  // payload that slipped a coordinate in would still be scrubbed.
  logSafe(event, properties);
}

/**
 * Records that a ranking was resolved, and how far the ladder had to go.
 *
 * ★ IT FIRES ONCE PER RESOLUTION, WHATEVER THE LEVEL.
 *
 * A level 1 is the evidence that the metric is meaningful; a level 5 is the
 * evidence that the fallback is carrying the product. Recording only the
 * degraded cases would make the metric's denominator invisible.
 */
export function trackRankingDegraded(input: {
  eventId: string;
  levelReached: number;
  reason: DegradationReason;
}): void {
  trackRouting('ranking_degraded', {
    event_id: input.eventId,
    level_reached: input.levelReached,
    reason: input.reason,
  });
}

/**
 * Records that the transit proxy served a measurement.
 *
 * Fired when the proxy served ANY transit measurement, with the number of
 * participants it served — the count is what tells us how much of the
 * product is riding on the estimate (PRD-05 §16).
 */
export function trackTransitProxyUsed(input: {
  eventId: string;
  participantCount: number;
}): void {
  trackRouting('transit_proxy_used', {
    event_id: input.eventId,
    participant_count: input.participantCount,
  });
}
