/**
 * The map panel's type-system fallback.
 *
 * Metro always substitutes `VenueMap.native.tsx` or `VenueMap.web.tsx` for
 * this module, so this body is never the one that runs — the same rule
 * `src/platform/haptics.ts` follows.
 *
 * ★ THIS FILE IS WHY `app/event/[id]/map.tsx` CAN IMPORT A BARE SPECIFIER.
 *
 * `tsc` does not resolve `.native.tsx` / `.web.tsx`. Without a suffix-free
 * module the screen's `import { VenueMap } from '…/VenueMap'` is a type error
 * on both platforms, and the only alternative — importing `.native.tsx`
 * directly — would put the native map in the web bundle, which is the exact
 * failure the split exists to prevent.
 *
 * It must stay PURE: no `react-native`, no map module, nothing but the prop
 * type. Anything heavier here is evaluated on web before Metro's substitution
 * is ever consulted.
 */

import type { VenueMapProps } from '@/src/features/venues/components/VenueMap.types';

export type { VenueMapProps };

export function VenueMap(_props: VenueMapProps): never {
  throw new Error('VenueMap: Metro must resolve VenueMap.native.tsx or VenueMap.web.tsx');
}
