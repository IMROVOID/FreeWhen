/**
 * A minimal `react-native-safe-area-context` stand-in for the UI test environment.
 *
 * ★ THE REAL MODULE LOADS A NATIVE VIEW.
 *
 * It reaches `react-native`'s `codegenNativeComponent`, whose Flow-typed source
 * esbuild cannot parse, so importing it fails before a component renders. No
 * earlier UI test happened to render a component that reads insets, which is
 * why this stub is new rather than pre-existing.
 *
 * ★ THE INSETS ARE A FIXED, NON-ZERO DEVICE.
 *
 * `{ top: 0, bottom: 0 }` would let a missing `paddingTop` assertion pass by
 * accident. These values are deliberately non-zero so a header or skeleton that
 * forgets an inset is visibly wrong in the markup, and so a test asserting the
 * inset actually sees it applied.
 */

import { createElement, type ReactNode } from 'react';

/** A phone with a notch and a home indicator. */
export const TEST_INSETS = { top: 47, right: 0, bottom: 34, left: 0 };

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function useSafeAreaInsets(): EdgeInsets {
  return TEST_INSETS;
}

export function useSafeAreaFrame(): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: 390, height: 844 };
}

export function SafeAreaProvider({ children }: { children: ReactNode }): ReactNode {
  return children;
}

export function SafeAreaView({ children }: { children: ReactNode }): ReactNode {
  return children;
}

export const SafeAreaInsetsContext = {
  Provider: ({ children }: { children: ReactNode }) => children,
  Consumer: ({ children }: { children: (value: EdgeInsets) => ReactNode }) =>
    children(TEST_INSETS),
};

export function useSafeArea(): { insets: EdgeInsets } {
  return { insets: TEST_INSETS };
}

/** Present on the real module; some code calls it before rendering. */
export function initialWindowMetrics(): { insets: EdgeInsets } {
  return { insets: TEST_INSETS };
}

export const createElementPassthrough = createElement;
