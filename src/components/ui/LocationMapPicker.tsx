/**
 * An interactive map-based location picker with Google Maps-style in-map search.
 *
 * Requirements:
 * - Map is the sole location selection method (no manual coordinate typing).
 * - Tapping anywhere on the map drops the pin at that point.
 * - Floating search bar inside the map with autocomplete suggestions.
 * - Floating GPS button for device location.
 * - Bottom confirmation card showing chosen place details.
 * - Light/dark basemap following the app theme, in the app's accent, at 3D pitch.
 *
 * ★ THIS FILE USED TO DRAW ITS OWN MAP. IT NO LONGER DOES.
 *
 * It carried a hand-rolled grid of CARTO raster tiles: `centreTileFor`,
 * `tileOffsetFor`, `gridSpanFor`, `gridOriginFor`, a `PanResponder` that unwound
 * its own cumulative deltas, a `ResizeObserver` to re-measure the frame, and two
 * composited label layers to keep place names white on the dark theme. Six pieces
 * of geometry, three of which had already shipped a defect (a tick at every tile
 * boundary, a seam wherever the fixed grid ended, a grid drawn off-frame in
 * Persian because its inset was logical rather than physical).
 *
 * A real map library does all of that correctly, natively, with a camera the user
 * controls. `InteractiveMap` is the seam; this file is now the picker's own
 * concerns — search, the degraded state, the confirm card and the pin.
 *
 * ★ THE SEARCH IS STILL DEBOUNCED ON THE QUERY ALONE.
 *
 * The effect used to list the centre as a dependency to bias results near the
 * visible area — but the centre changes on every frame of a drag, so the 300 ms
 * timer was reset continuously and the request never fired. Panning once was
 * enough to break search completely, which is the reported "no results, whatever
 * I search". The bias is read from a ref at fire time instead, and that rule is
 * unchanged by the map swap: it was never about tiles.
 *
 * ★ AND A FAILED SEARCH IS A VISIBLE STATE.
 *
 * A 404, a 500 and "this place does not exist" were once all the same empty array.
 * The custom pin is a first-class path in this product, so an unavailable provider
 * says so and offers it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { InteractiveMap } from '@/src/components/ui/InteractiveMap';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import {
  MIN_SEARCH_LENGTH,
  searchPlaces,
  type PlaceResult,
} from '@/src/features/venues/services/place-search';
import type { MapMarker } from '@/src/components/ui/InteractiveMap';
import { hasMapbox } from '@/src/features/map/mapbox-token';
import { mapAppearance } from '@/src/features/map/appearance';
import { DEFAULT_MAP_CENTRE } from '@/src/features/map/projection';
import { haptics } from '@/src/platform/haptics';
import { useLayoutDirection } from '@/src/platform/use-layout-direction';
import { formatCoordinates } from '@/src/components/ui/map-pan';
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

const MAP_HEIGHT = 380;
const DEBOUNCE_MS = 300;

/** The shared fallback centre, so every map agrees which city "no bias" means. */
const DEFAULT_CENTRE = DEFAULT_MAP_CENTRE;

/** The resting zoom for a picker: a neighbourhood, not a city, not a rooftop. */
const PICKER_ZOOM = 15;

export function LocationMapPicker({
  initialLat = DEFAULT_CENTRE.lat,
  initialLng = DEFAULT_CENTRE.lng,
  initialName = '',
  onSelect,
  onCancel,
  testID,
}: LocationMapPickerProps) {
  const { t } = useTranslation();
  const { t: theme, name: themeName } = useTheme();
  const rtl = useLayoutDirection();

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [zoom, setZoom] = useState(PICKER_ZOOM);
  const [placeName, setPlaceName] = useState(initialName);
  const [placeAddress, setPlaceAddress] = useState('');

  /**
   * ★ A BASEMAP THAT CANNOT DRAW IS A VISIBLE STATE, NOT AN EMPTY FRAME.
   *
   * Two ways to reach it, and they are the same state to the reader: this build
   * has no token (`hasMapbox()` false, checked once at mount), or the renderer
   * reported that it could not draw (`onUnavailable`). Before there was a flag the
   * frame stayed a blank rectangle, nothing threw, and the runtime log was clean —
   * the user could not tell "loading" from "broken" and had no retry.
   */
  const [basemapFailed, setBasemapFailed] = useState(() => !hasMapbox());

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  const searchRequestId = useRef(0);

  /**
   * The bias for a search, read at FIRE time.
   *
   * A ref, so the debounce effect does not depend on the centre: panning must not
   * cancel a search that is already pending.
   */
  const biasRef = useRef({ lat: initialLat, lng: initialLng });

  const commitCentre = useCallback((next: { lat: number; lng: number }) => {
    biasRef.current = next;
    setLat(next.lat);
    setLng(next.lng);
  }, []);

  /**
   * ★ ZOOM IS CLAMPED HERE BECAUSE BOTH RENDERERS NEED A SENSIBLE RANGE.
   *
   * Beyond 20 the MapBox style has no data and the frame goes blank; below 3 the
   * whole world is one screen and a pin is meaningless.
   */
  const changeZoom = (delta: number) => {
    setZoom((current) => Math.max(3, Math.min(20, current + delta)));
  };

  /**
   * A tap on the map moves the pin.
   *
   * This is the "click anywhere to select the location" path. The name is cleared
   * only when the previous one came from a search result, so a place the user
   * typed a name for is not silently renamed by a stray tap.
   */
  const handlePress = (coordinate: { lat: number; lng: number }) => {
    commitCentre(coordinate);
    setPlaceAddress('');
    setPlaceName((current) =>
      current === '' || current === t('location.currentPosition')
        ? current
        : t('proposals.place.customPin'),
    );
    haptics.impact('light');
  };

  // Search places, debounced on the QUERY alone — see the note at the top.
  useEffect(() => {
    const term = searchQuery.trim();

    if (term.length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      setShowResults(false);
      setSearchUnavailable(false);
      return;
    }

    // ★ A CAMERA MOVE DOES NOT CANCEL A PENDING SEARCH, BUT A NEW QUERY DOES.
    //
    // The map no longer re-renders the effect on every drag frame — its camera is
    // the library's, not this component's state — so this dependency list is
    // honest rather than defensive. It is kept explicit because the defect it
    // prevents is invisible: a debounce that never fires looks like a broken API.
    const timer = setTimeout(async () => {
      const mine = ++searchRequestId.current;
      setIsSearching(true);
      setSearchUnavailable(false);

      try {
        const outcome = await searchPlaces(term, biasRef.current);
        if (mine !== searchRequestId.current) return;

        setSearchResults(outcome.results);
        // A degraded provider is a STATE, not an empty list: the custom pin is
        // the product's first-class answer to a place no database carries.
        setSearchUnavailable(outcome.degraded);
        setShowResults(true);
      } catch {
        if (mine !== searchRequestId.current) return;
        setSearchResults([]);
        setSearchUnavailable(true);
        setShowResults(true);
      } finally {
        if (mine === searchRequestId.current) setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchQuery]);

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
        setPlaceAddress('');
        haptics.impact('medium');
      }
    } catch {
      // Permission denied or GPS unavailable: the pin stays where it was, and the
      // reader can still place it by hand. Silence is correct here — a refusal is
      // an answer, not a failure.
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

  const appearance = mapAppearance(themeName, theme.primary);

  /**
   * One marker, at the centre.
   *
   * The marker IS the selection, so its label is the chosen place's name — an
   * unlabelled dot is silent to a screen reader.
   */
  const markers: MapMarker[] = basemapFailed
    ? []
    : [
        {
          id: 'picked',
          coordinate: { lat, lng },
          color: theme.primary,
          selected: true,
          label: placeName || t('proposals.place.customPin'),
        },
      ];

  const searchTextDirection = rtl ? 'rtl' : 'ltr';

  return (
    <View style={styles.container} testID={testID}>
      {/* Map View Frame */}
      <View style={[styles.mapFrame, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        {!basemapFailed && (
          <InteractiveMap
            camera={{
              centre: { lat, lng },
              zoom,
              pitch: appearance.pitch,
              bearing: 0,
            }}
            markers={markers}
            theme={appearance.mode}
            accent={appearance.accent}
            onPress={handlePress}
            onCameraChange={(camera) => commitCentre(camera.centre)}
            onUnavailable={() => setBasemapFailed(true)}
            testID={testID ? `${testID}-surface` : undefined}
          />
        )}

        {/* ★ A BLANK FRAME IS NOT A FAILURE STATE. */}
        {basemapFailed && (
          <View
            pointerEvents="none"
            style={[styles.tileFailure, { backgroundColor: theme.surface2 }]}
            testID={testID ? `${testID}-unavailable` : undefined}
          >
            <Text variant="caption" color={theme.textMuted} align="center">
              {t('map.unavailableOnWeb')}
            </Text>
            <Text variant="caption" color={theme.textFaint} align="center">
              {t('map.unavailableOnWebBody')}
            </Text>
          </View>
        )}

        {/* Top Floating Search Bar (Google Maps style) */}
        <View style={styles.searchBarWrapper}>
          <View style={[styles.searchBar, { backgroundColor: theme.surface1 }]}>
            <MagnifyingGlass size={20} color={theme.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('proposals.place.searchPlaceholder')}
              placeholderTextColor={theme.textFaint}
              style={[
                styles.searchInput,
                { color: theme.text, writingDirection: searchTextDirection },
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
          {showResults && (searchResults.length > 0 || searchUnavailable) && (
            <Card variant="raised" style={styles.dropdownCard}>
              {searchResults.length > 0 ? (
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
                        <MapPin size={18} color={theme.primary} />
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
              ) : (
                /* ★ AN UNAVAILABLE SEARCH SAYS SO, AND POINTS AT THE PIN.
                   The custom pin is a first-class path in this product — an
                   informal corner no POI database carries is the common case
                   here — so a provider failure is not an error, it is a
                   redirect to that path. */
                <View
                  style={styles.unavailableBody}
                  testID={testID ? `${testID}-search-unavailable` : undefined}
                >
                  <Text variant="body" color={theme.text} align="start">
                    {t('proposals.place.degraded')}
                  </Text>
                  <Text variant="caption" color={theme.textMuted} align="start">
                    {t('proposals.place.pickOnMap')}
                  </Text>
                </View>
              )}
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
  /**
   * The failure state, over the frame.
   *
   * A PHYSICAL inset on all four edges: it covers the frame symmetrically, so
   * there is no reading edge to mirror.
   */
  tileFailure: {
    position: 'absolute',
    top: 0,
    left: 0, // rtl-ok: full-bleed inset, symmetric so there is nothing to mirror
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[5],
    gap: space[1],
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
    /**
     * ★ NO BORDER.
     *
     * An outlined pill floating over a map reads as a form field dropped on top of
     * it rather than a control belonging to it, and the hairline is the one thing
     * on screen with a hard edge. The fill alone lifts it off the basemap.
     */
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
  unavailableBody: {
    gap: space[1],
    padding: space[2],
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
    /**
     * ★ THE CONFIRM BUTTON NEEDED AIR ABOVE IT.
     *
     * At the card's own gap it sat directly under the coordinate line, so the one
     * action that commits the location read as part of the label block.
     */
    marginTop: space[2],
  },
  cancelBtn: {
    flex: 1,
  },
  confirmBtn: {
    flex: 2,
  },
});
