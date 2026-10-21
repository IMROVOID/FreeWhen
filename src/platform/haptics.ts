/**
 * The haptics interface.
 *
 * The shared file holds the INTERFACE. Metro resolves `.native.ts` and
 * `.web.ts` in its place, so the web bundle never contains the native
 * implementation. `tsc` does not resolve those suffixes, so the shared file
 * must not import a native module — or `tsc` and Metro will disagree.
 */

export type HapticStyle = 'light' | 'medium' | 'success';

export interface Haptics {
  impact(style: HapticStyle): void;
}

/**
 * The type-system fallback.
 *
 * Metro always substitutes `haptics.native.ts` or `haptics.web.ts` for this
 * module, so this object is never the one that runs. It exists so that a
 * consumer's `import { haptics } from '@/src/platform/haptics'` type-checks.
 */
export const haptics: Haptics = {
  impact() {
    // Unreachable at runtime — see above.
  },
};
