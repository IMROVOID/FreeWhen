/**
 * The venue, drawn: a small map of the proposal's own coordinates.
 *
 * ★ THE PROPOSAL BOX SHOWED A SENTENCE WHERE A MAP WAS EXPECTED.
 *
 * There was no map on a proposal at all. The venue block carried a `Button`
 * labelled «بازکردن در برنامه دیگر» — "open in another app" — which was the
 * actionable half of an address, and with nothing drawn above it the reader
 * reported exactly what they saw: "the map is not displayed on the proposal
 * boxes, and instead it displays `بازکردن در برنامه دیکر`". A caption standing in
 * for a picture is indistinguishable from a picture that failed.
 *
 * ★ A STATIC IMAGE, NOT AN INTERACTIVE MAP.
 *
 * A proposal is a row in a list: it needs to say WHERE, not to be pannable. One
 * MapBox Static Images request — the same style, the same account and the same
 * accent as the interactive map beside it — costs one `<Image>`, needs no script
 * and no WebGL, and cannot drift from the picker's own look because both read
 * `styleForTheme()` and `readMapboxToken()`.
 *
 * ★ IT DEGRADES TO A PIN, NOT TO A LABEL.
 *
 * A request can fail — an offline device, a blocked host, or a build with no
 * token at all. All three land on the same state: a pin on the theme's own
 * surface, which still reads as a place at a glance.
 */

import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { MapPin } from 'phosphor-react-native';

import { Image } from 'expo-image';

import {
  PROPOSAL_MAP_PREVIEW_HEIGHT,
  staticMapUrl,
} from '@/src/features/proposals/services/static-map';
import { radius, size, space } from '@/src/theme/tokens';
import { useTheme } from '@/src/theme/useTheme';

export { PROPOSAL_MAP_PREVIEW_HEIGHT };

export interface ProposalMapPreviewProps {
  lat: number;
  lng: number;
  /** The venue's name, for the picture's accessible description. */
  label: string;
  testID?: string;
}

export function ProposalMapPreview({ lat, lng, label, testID }: ProposalMapPreviewProps) {
  const { t: theme, name } = useTheme();

  /**
   * Whether the picture failed to load.
   *
   * State rather than an error boundary: a missing picture is not an exception,
   * and an `Image` that cannot decode is a routine outcome on a train.
   */
  const [failed, setFailed] = useState(false);

  const frame: ViewStyle = {
    height: PROPOSAL_MAP_PREVIEW_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: theme.surface3,
    overflow: 'hidden',
  };

  const uri = staticMapUrl(lat, lng, name === 'dark' ? 'dark' : 'light', theme.primary);

  // No token and no arithmetic are the same answer as a failed request: there is
  // no picture, so draw the one thing that still says where this is.
  if (uri === null || failed) {
    return (
      <View style={[styles.fallback, frame]} testID={testID}>
        <MapPin size={size.stepperButton / 2} color={theme.textMuted} weight="fill" />
      </View>
    );
  }

  return (
    <View style={frame} testID={testID}>
      <Image
        source={{ uri }}
        style={styles.image}
        contentFit="cover"
        // The picture is information, so it has a description; an empty alt would
        // make the one element that says WHERE silent to a screen reader.
        accessibilityLabel={label}
        onError={() => setFailed(true)}
        testID={testID ? `${testID}-tile` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[2],
  },
});
