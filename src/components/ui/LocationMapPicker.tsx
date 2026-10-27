/**
 * An interactive map-based location picker with Google Maps-style in-map search.
 *
 * Requirements:
 * - Map is the sole location selection method (no manual coordinate typing).
 * - Floating search bar inside the map with autocomplete suggestions.
 * - Center pin marker with drop feedback.
 * - Floating GPS button for device location.
 * - Bottom confirmation card showing chosen place details.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import {
  MagnifyingGlass,
  MapPin,
  Minus,
  NavigationArrow,
  Plus,
  X,
} from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import {
  searchPlaces,
  type PlaceResult,
} from '@/src/features/venues/services/place-search';
import { haptics } from '@/src/platform/haptics';
import { formatCoordinates, translateCentre } from '@/src/components/ui/map-pan';
import { border, radius, size, space } from '@/src/theme/tokens';
import { fonts } from '@/src/theme/fonts';
import { useTheme } from '@/src/theme/useTheme';
import type { VenueRef } from '@/src/types/proposal';

export interface LocationMapPickerProps {
  initialLat?: number;
  initialLng?: number;
  initialName?: string;
  onSelect: (venue: VenueRef) => void;
  onCancel?: () => void;
  testID?: string;
}

const TILE_SIZE = 256;
const MAP_HEIGHT = 380;
const DEBOUNCE_MS = 300;

// Conversion between (lat, lng) and slippy tile coordinates
function latLngToTileExact(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function LocationMapPicker({
  initialLat = 35.6892, // Tehran default
  initialLng = 51.389,
  initialName = '',
  onSelect,
  onCancel,
  testID,
}: LocationMapPickerProps) {
  const { t } = useTranslation();
  const { t: theme, name: themeName } = useTheme();

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [zoom, setZoom] = useState(14);
  const [placeName, setPlaceName] = useState(initialName);
  const [placeAddress, setPlaceAddress] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  const searchRequestId = useRef(0);

  // Conversion between (lat, lng) and slippy tile coordinates
  const centerTile = useMemo(() => latLngToTileExact(lat, lng, zoom), [lat, lng, zoom]);

  /**
   * ★ THE PAN CANNOT CLOSE OVER `lat`/`lng`/`zoom`.
   *
   * The responder below is built once, in a `useRef`, so every value it captures
   * is frozen at the first render for the life of the mount. It therefore reads
   * the view from this ref, which `commitCentre` writes on every change, and the
   * zoom from `zoomRef`.
   *
   * ★ AND THE DELTA IS PER-FRAME, NOT PER-GESTURE.
   *
   * `PanResponderGestureState.dx`/`dy` measure from where the touch STARTED. They
   * were applied to absolute state, so frame two re-applied frame one's travel on
   * top of a centre that had already moved by it, frame three re-applied three
   * frames, and so on. The tile URIs only change when the centre crosses a whole
   * tile, and a compounding offset does not move it far enough — so the numbers in
   * the card ran while the map sat still, which is the bug this fixes.
   *
   * `lastPan` holds the gesture's previous position so each frame applies the
   * difference, and the arithmetic lives in `map-pan.ts` so it can be tested.
   */
  const centreRef = useRef({ lat: initialLat, lng: initialLng });
  const zoomRef = useRef(zoom);
  const lastPan = useRef({ x: 0, y: 0 });

  const commitCentre = (next: { lat: number; lng: number }) => {
    centreRef.current = next;
    setLat(next.lat);
    setLng(next.lng);
  };

  /**
   * Zoom, written to the ref as well as the state.
   *
   * The pan handler is built once, so `zoom` inside it is the value from the
   * first render; `zoomRef` is what it actually reads. Keeping the two in step
   * here is what makes a zoom followed by a drag behave.
   */
  const changeZoom = (delta: number) => {
    const next = Math.max(8, Math.min(18, zoomRef.current + delta));
    zoomRef.current = next;
    setZoom(next);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setIsDragging(true);
        // A new gesture starts from zero, and its first move must be measured
        // from here rather than from the previous gesture's last position.
        lastPan.current = { x: 0, y: 0 };
        haptics.impact('light');
      },
      onPanResponderMove: (_, gestureState) => {
        const dx = gestureState.dx - lastPan.current.x;
        const dy = gestureState.dy - lastPan.current.y;
        lastPan.current = { x: gestureState.dx, y: gestureState.dy };

        if (dx === 0 && dy === 0) return;

        commitCentre(translateCentre(centreRef.current, dx, dy, zoomRef.current));
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
        haptics.impact('light');
        if (!placeName) {
          setPlaceName(t('proposals.place.customPin'));
        }
      },
    }),
  ).current;

  // Search places with debounce
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    const timer = setTimeout(async () => {
      const mine = ++searchRequestId.current;
      setIsSearching(true);
      try {
        const outcome = await searchPlaces(searchQuery.trim(), { lat, lng });
        if (mine === searchRequestId.current) {
          setSearchResults(outcome.results);
          setShowResults(true);
        }
      } catch {
        if (mine === searchRequestId.current) {
          setSearchResults([]);
        }
      } finally {
        if (mine === searchRequestId.current) {
          setIsSearching(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchQuery, lat, lng]);

  const handleSelectSearchResult = (result: PlaceResult) => {
    commitCentre({ lat: result.lat, lng: result.lng });
    setPlaceName(result.name);
    setPlaceAddress(result.address ?? '');
    setShowResults(false);
    setSearchQuery(result.name);
    haptics.impact('light');
  };

  const handleLocateMe = async () => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        commitCentre({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setPlaceName(t('location.currentPosition'));
        haptics.impact('medium');
      }
    } catch {
      // Permission denied or GPS unavailable
    } finally {
      setIsLocating(false);
    }
  };

  const handleConfirm = () => {
    const finalName = placeName.trim() || t('proposals.place.customPin');
    onSelect({
      name: finalName,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      address: placeAddress.trim() || undefined,
    });
  };

  // 3x3 Tile generation around center
  const centerTileX = Math.floor(centerTile.x);
  const centerTileY = Math.floor(centerTile.y);
  const maxTile = 2 ** zoom - 1;

  const tileOffsets = [-1, 0, 1];
  const tileBase = themeName === 'dark' ? 'dark_all' : 'voyager';

  return (
    <View style={styles.container} testID={testID}>
      {/* Map View Frame */}
      <View style={[styles.mapFrame, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        {/* Render Tile Grid */}
        <View style={styles.tileCanvas} {...panResponder.panHandlers}>
          {tileOffsets.map((oy) => {
            const ty = Math.max(0, Math.min(maxTile, centerTileY + oy));
            return (
              <View key={`row-${ty}`} style={styles.tileRow}>
                {tileOffsets.map((ox) => {
                  const tx = (centerTileX + ox + 2 ** zoom) % (2 ** zoom);
                  const cartoKey = process.env.EXPO_PUBLIC_CARTO_API_KEY;
                  const uri = cartoKey
                    ? `https://a.basemaps.cartocdn.com/rastertiles/${tileBase}/${zoom}/${tx}/${ty}.png?key=${cartoKey}`
                    : `https://a.basemaps.cartocdn.com/rastertiles/${tileBase}/${zoom}/${tx}/${ty}.png`;
                  return (
                    <Image
                      key={`${zoom}-${tx}-${ty}`}
                      source={{ uri }}
                      style={styles.tile}
                      resizeMode="cover"
                    />
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* Center Target Pin */}
        <View style={styles.centerPinContainer} pointerEvents="none">
          <View style={[styles.pinIconWrapper, isDragging && styles.pinLifted]}>
            <MapPin size={38} color={theme.brand} weight="fill" />
          </View>
          <View style={[styles.pinShadow, { backgroundColor: theme.line }]} />
        </View>

        {/* Top Floating Search Bar (Google Maps style) */}
        <View style={styles.searchBarWrapper}>
          <View style={[styles.searchBar, { backgroundColor: theme.surface1, borderColor: theme.line }]}>
            <MagnifyingGlass size={20} color={theme.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('proposals.place.searchPlaceholder')}
              placeholderTextColor={theme.textFaint}
              style={[
                styles.searchInput,
                { color: theme.text, writingDirection: 'rtl' },
              ]}
              testID={testID ? `${testID}-search-input` : undefined}
            />
            {isSearching ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : searchQuery.length > 0 ? (
              <Pressy onPress={() => setSearchQuery('')} style={styles.clearBtn}>
                <X size={18} color={theme.textMuted} />
              </Pressy>
            ) : null}
          </View>

          {/* Autocomplete Suggestions Dropdown */}
          {showResults && searchResults.length > 0 && (
            <Card variant="raised" style={styles.dropdownCard}>
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                style={styles.dropdownList}
              >
                {searchResults.map((res) => (
                  <Pressy
                    key={res.provider_place_id}
                    onPress={() => handleSelectSearchResult(res)}
                    style={styles.resultItem}
                  >
                    <View style={styles.resultRow}>
                      <MapPin size={18} color={theme.brand} />
                      <View style={styles.resultTexts}>
                        <Text variant="body" color={theme.text} numberOfLines={1}>
                          {res.name}
                        </Text>
                        {res.address && (
                          <Text variant="caption" color={theme.textMuted} numberOfLines={1}>
                            {res.address}
                          </Text>
                        )}
                      </View>
                    </View>
                  </Pressy>
                ))}
              </ScrollView>
            </Card>
          )}
        </View>

        {/* Floating Zoom & GPS Controls */}
        <View style={styles.floatingControls}>
          <Pressy
            onPress={() => changeZoom(1)}
            style={[styles.fabBtn, { backgroundColor: theme.surface1 }]}
            accessibilityRole="button"
            accessibilityLabel={t('map.zoomIn')}
          >
            <Plus size={18} color={theme.text} />
          </Pressy>
          <Pressy
            onPress={() => changeZoom(-1)}
            style={[styles.fabBtn, { backgroundColor: theme.surface1 }]}
            accessibilityRole="button"
            accessibilityLabel={t('map.zoomOut')}
          >
            <Minus size={18} color={theme.text} />
          </Pressy>
          <Pressy
            onPress={() => void handleLocateMe()}
            style={[styles.fabBtn, { backgroundColor: theme.surface1 }]}
            accessibilityRole="button"
            accessibilityLabel={t('location.useCurrent')}
          >
            {isLocating ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : (
              <NavigationArrow size={18} color={theme.primary} weight="bold" />
            )}
          </Pressy>
        </View>
      </View>

      {/* Bottom Place Confirmation Card */}
      <Card variant="surface" style={styles.bottomCard}>
        <View style={styles.bottomInfo}>
          <Text variant="bodyL" color={theme.text} align="center">
            {placeName || t('proposals.place.customPin')}
          </Text>
          <Text variant="caption" color={theme.textMuted} align="center" numeric>
            {formatCoordinates(lat, lng)}
          </Text>
        </View>

        <View style={styles.bottomActions}>
          {onCancel && (
            <Button
              label={t('common.cancel')}
              onPress={onCancel}
              variant="ghost"
              size="medium"
              fullWidth={false}
              style={styles.cancelBtn}
            />
          )}
          <Button
            label={t('proposals.place.confirmLocation')}
            onPress={handleConfirm}
            variant="primary"
            size="medium"
            testID={testID ? `${testID}-confirm` : undefined}
            style={styles.confirmBtn}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[3],
  },
  mapFrame: {
    height: MAP_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: border.hairline,
    overflow: 'hidden',
    position: 'relative',
  },
  tileCanvas: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileRow: {
    flexDirection: 'row',
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    start: '50%',
    marginStart: -19,
    marginTop: -38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIconWrapper: {
    transform: [{ translateY: 0 }],
  },
  pinLifted: {
    transform: [{ translateY: -12 }],
  },
  pinShadow: {
    width: space[3],
    height: space[1],
    borderRadius: radius.pill,
    opacity: 0.4,
    marginTop: -space[1],
  },
  searchBarWrapper: {
    position: 'absolute',
    top: space[3],
    start: space[3],
    end: space[3],
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    // ★ NO BORDER.
    //
    // An outlined pill floating over map tiles reads as a form field dropped on
    // top of the map rather than a control belonging to it, and the hairline is
    // the one thing on screen with a hard edge. The fill alone is enough to lift
    // it off the tiles.
    borderWidth: 0,
    paddingHorizontal: space[3],
    height: size.buttonSmall,
    gap: space[2],
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.persian[500],
    paddingVertical: 0,
    textAlign: 'end',
  },
  clearBtn: {
    padding: space[1],
  },
  dropdownCard: {
    marginTop: space[2],
    maxHeight: 180,
    borderRadius: radius.md,
    padding: space[2],
  },
  dropdownList: {
    maxHeight: 170,
  },
  resultItem: {
    paddingVertical: space[2],
    paddingHorizontal: space[2],
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  resultTexts: {
    flex: 1,
    gap: space[1],
  },
  floatingControls: {
    position: 'absolute',
    bottom: space[3],
    end: space[3],
    gap: space[2],
    zIndex: 5,
  },
  fabBtn: {
    width: size.stepperButton,
    height: size.stepperButton,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  bottomCard: {
    gap: space[3],
  },
  bottomInfo: {
    gap: space[1],
    // The chosen place is the card's subject, so it is centred rather than
    // pinned to one edge — it reads the same in both directions that way.
    alignItems: 'center',
  },
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    // ★ THE CONFIRM BUTTON NEEDED AIR ABOVE IT.
    //
    // At the card's own gap it sat directly under the coordinate line, so the one
    // action that commits the location read as part of the label block.
    marginTop: space[2],
  },
  cancelBtn: {
    flex: 1,
  },
  confirmBtn: {
    flex: 2,
  },
});
