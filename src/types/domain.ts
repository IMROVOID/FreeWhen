/**
 * Shared domain types.
 *
 * Extended phase by phase. Phase 1 owns the locale-agnostic shapes that
 * every later phase refers to.
 */

export type { Confidence, TransportMode, TravelMeasurement } from '@/src/routing/types';

export type { Language } from '@/src/i18n/types';

/** The reason contract: the engine returns a template key, never prose. */
export interface Reason {
  templateId: string;
  params: Record<string, number | string | Reason>;
}

export type { Reason as DomainReason } from '@/src/lib/format';
