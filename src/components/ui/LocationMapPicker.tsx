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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  NavigationArrow,
  X,
} from 'phosphor-react-native';

import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { InteractiveMap } from '@/src/components/ui/InteractiveMap';
import { Pressy } from '@/src/components/ui/Pressy';
import { Text } from '@/src/components/ui/Text';
import type { MapSurfaceHandle } from '@/src/components/ui/map-imperative';
import {
  MIN_SEARCH_LENGTH,
  searchPlaces,
  type PlaceResult,
} from '@/src/features/venues/services/place-search';
import type { MapCamera, MapMarker } from '@/src/components/ui/InteractiveMap';
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

/** The zoom range the basemap has data for. Beyond it the frame goes blank. */
const MIN_ZOOM = 3;
const MAX_ZOOM = 20;
function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}


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

  /**
   * Whether a completed search found nothing, as distinct from failing.
   *
   * ★ "NO PLACE MATCHES THAT" AND "NOBODY COULD BE ASKED" ARE TWO STATES.
   *
   * They both arrived as an empty list, so a misspelled street read as broken
   * search — and so did the deployment's own invalid key, which is how the real
   * cause survived a report that said only "search returns no results at all".
   */
  const [searchEmpty, setSearchEmpty] = useState(false);

  const searchRequestId = useRef(0);

  /**
   * The bias for a search, read at FIRE time.
   *
   * A ref, so the debounce effect does not depend on the centre: panning must not
   * cancel a search that is already pending.
   */
  const biasRef = useRef({ lat: initialLat, lng: initialLng });

  /**
   * ★ THE PIN AND THE CAMERA ARE TWO FACTS, AND CONFLATING THEM WAS THE BUG.
   *
   * There was one `commitCentre`, wired to BOTH the map's press handler and its
   * `onCameraChange`. So every settled camera move — every drag, every pinch —
   * rewrote the selection, and the pin jumped to whatever was under the middle of
   * the screen. The reported defect is exactly that: "when I move the map, the pin
   * automatically moves to the centre; it should only move to where the user
   * clicks, and never change by itself".
   *
   * `selectPoint` is the only writer of the selection. `noteCamera` records where
   * the map is looking for the search bias, and deliberately does nothing else.
   */
  const selectPoint = useCallback((next: { lat: number; lng: number }) => {
    biasRef.current = next;
    setLat(next.lat);
    setLng(next.lng);
  }, []);

  /**
   * The pose this component has ASKED the map to show.
   *
   * ★ ONLY A DELIBERATE ACTION MOVES THE CAMERA; A GESTURE NEVER DOES.
   *
   * Choosing a search result, using locate-me and pressing +/- all write here, and
   * the map is moved to exactly that. A drag or a pinch does not — which is what
   * makes the camera the user's own once they touch it, and is the fix for a
   * pinch or a tilt reverting the moment the gesture ended.
   */
  const [framing, setFraming] = useState<{ centre: { lat: number; lng: number }; zoom: number }>(
    () => ({ centre: { lat: initialLat, lng: initialLng }, zoom: PICKER_ZOOM }),
  );

  /** Moves the map on purpose, and takes the selection with it. */
  const flyTo = useCallback(
    (next: { lat: number; lng: number }, zoom?: number) => {
      selectPoint(next);
      setFraming((current) => ({ centre: next, zoom: clampZoom(zoom ?? current.zoom) }));
    },
    [selectPoint],
  );

  const noteCamera = useCallback((camera: MapCamera) => {
    // ★ THE ONLY THING A CAMERA MOVE IS ALLOWED TO DO IS RE-BIAS THE SEARCH.
    //
    // It used to also commit the centre as the selection, which is what made the
    // pin jump to the middle of the screen on every drag. It does not touch
    // `framing` either: writing the reported pose back would undo a pinch or a
    // tilt, which is the other half of the same reported defect.
    biasRef.current = camera.centre;
  }, []);

  /** The live map surface, so the zoom controls can ask it rather than write state. */
  const mapRef = useRef<MapSurfaceHandle | null>(null);

  /**
   * ★ ZOOM IS IMPERATIVE, AND THAT IS WHAT STOPS THE MAP RETURNING TO THE PIN.
   *
   * The `+`/`−` pair lives in the map's corner now (`controls`), and it asks the
   * SURFACE to zoom through `mapRef`. The old version wrote `framing` — the CAMERA
   * PROP — so pressing a button re-framed the map onto `framing.centre`, which is
   * where the pin was placed: the reported "when I zoom, it returns to the selected
   * location, like the pin is the pivot". A pinch never does that, and so neither
   * does this. See `map-imperative.ts`.
   */

  /**
   * A tap on the map moves the pin.
   *
   * This is the "click anywhere to select the location" path. The name is cleared
   * only when the previous one came from a search result, so a place the user
   * typed a name for is not silently renamed by a stray tap.
   */
  const handlePress = (coordinate: { lat: number; lng: number }) => {
    selectPoint(coordinate);
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
      setSearchEmpty(false);
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
        // the product's first-class answer to a place no database carries. A
        // provider that answered with nothing is a third state — see `searchEmpty`.
        setSearchUnavailable(outcome.degraded);
        setSearchEmpty(!outcome.degraded && outcome.results.length === 0);
        setShowResults(true);
      } catch {
        if (mine !== searchRequestId.current) return;
        setSearchResults([]);
        setSearchUnavailable(true);
        setSearchEmpty(false);
        setShowResults(true);
      } finally {
        if (mine === searchRequestId.current) setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectSearchResult = (result: PlaceResult) => {
    flyTo({ lat: result.lat, lng: result.lng });
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
        flyTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
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
   * ★ THE CAMERA IS AN ASK, NOT A MIRROR.
   *
   * It used to be built from the live selection and the live zoom, so every value
   * the map reported came straight back in and the gesture undid itself: a pinch
   * settled and was reverted, a tilt settled and was reverted. It is built from
   * `framing` instead — a value only THIS component writes, and only when it
   * deliberately wants the map somewhere else: on mount, when a search result is
   * chosen, when locate-me returns, and when the +/- buttons are pressed.
   *
   * A drag or a pinch never touches `framing`, so nothing pushes it back.
   */
  const camera: MapCamera = useMemo(
    () => ({
      centre: framing.centre,
      zoom: framing.zoom,
      pitch: appearance.pitch,
      bearing: 0,
    }),
    [framing, appearance.pitch],
  );

  /**
   * One marker, at the selection.
   *
   * The marker IS the selection, so its label is the chosen place's name — an
   * unlabelled pin is silent to a screen reader — and it sits on the point the
   * user chose, which a camera move no longer changes.
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
            ref={mapRef}
            camera={camera}
            markers={markers}
            theme={appearance.mode}
            accent={appearance.accent}
            // The zoom pair lives in the map's own corner, so it moves with the map
            // and is drawn by the same document on both platforms.
            controls
            onPress={handlePress}
            onCameraChange={noteCamera}
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
          {showResults && (searchResults.length > 0 || searchUnavailable || searchEmpty) && (
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
              ) : searchEmpty ? (
                /* ★ NO MATCH IS NOT AN OUTAGE.
                   The provider was asked and had nothing. Saying "search is
                   unavailable" here told a user who typed a wrong street name
                   that the product was broken — and, on the deployment whose
                   provider key was for another service, said the same thing for
                   the opposite reason, which is what hid the real cause. */
                <View
                  style={styles.unavailableBody}
                  testID={testID ? `${testID}-search-empty` : undefined}
                >
                  <Text variant="body" color={theme.text} align="start">
                    {t('proposals.place.noResults')}
                  </Text>
                  <Text variant="caption" color={theme.textMuted} align="start">
                    {t('proposals.place.pickOnMap')}
                  </Text>
                </View>
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

        {/* ★ ONE CONTROL: LOCATE ME — AND NO AUTO-PIN.
            The `+`/`−` pair is drawn inside the map now (`controls`), in the same
            corner on both platforms, so it moves with the map instead of over it.
            What is deliberately NOT here is a control that re-frames the map onto
            the selection: the pin is where the user put it, and pressing a button
            to fly back to it is the same "the pin is the pivot" behaviour the zoom
            controls were reported for. Dropping a new pin is a tap on the map. */}
        <View style={styles.floatingControls}>
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
