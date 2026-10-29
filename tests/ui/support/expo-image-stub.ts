/**
 * A minimal `expo-image` stand-in.
 *
 * ★ THE REAL ONE PULLS IN `expo-modules-core`.
 *
 * Which reads `globalThis.expo.EventEmitter` at import time and throws in Node
 * before any test body runs. The preview (`ProposalMapPreview`) uses `<Image>` for
 * exactly one thing — a remote tile URI — and a UI suite that renders to static
 * markup is not asserting on decode, decode priority or a transition. So the stub
 * renders the URI as an `<img>`-shaped node: the assertions are about WHICH tile
 * was asked for and what description it carries, which is all that matters here.
 */

import { createElement } from 'react';

export interface ImageProps {
  source?: { uri: string } | null;
  style?: unknown;
  accessibilityLabel?: string;
  accessibilityElementsHidden?: boolean;
  contentFit?: string;
  onError?: () => void;
  testID?: string;
}

/**
 * A plain element, the same shape `svg-stub` uses.
 *
 * A `View` was the first attempt and it DROPPED the extra attribute: the resolved
 * `react-native` is `react-native-web`, whose `View` filters unknown props. A bare
 * host element keeps everything the caller passed, so the URI is readable from the
 * rendered markup.
 */
export function Image({ source, style, accessibilityLabel, testID }: ImageProps) {
  return createElement('img', {
    style,
    'data-testid': testID,
    alt: accessibilityLabel,
    role: accessibilityLabel ? 'img' : undefined,
    // The URI is the assertion surface: this makes it readable from the rendered
    // markup without pretending to be a real decoder.
    'data-tile-src': source?.uri,
  });
}

/** Present because some callers import it by name. */
export const ImageBackground = Image;

export default { Image, ImageBackground };
