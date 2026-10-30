/**
 * An interactive map-based location picker with Google Maps-style in-map search.
 *
 * Requirements:
 * - Map is the sole location selection method (no manual coordinate typing).
 * - Floating search bar inside the map with autocomplete suggestions.
 * - Center pin marker with drop feedback.
 * - Floating GPS button for device location.
 * - Bottom confirmation card showing chosen place details.
 *
 * ★ THE PICTURE MUST FOLLOW THE FINGER CONTINUOUSLY.
 *
 * The 3x3 tile grid is re-derived from the centre every render, so the only thing
 * that can show a sub-tile drag is the grid's translation — `tileOffsetFor`. That
 * offset used to be the centre's fractional position inside its FLOORED tile,
 * which is continuous everywhere except at a tile boundary, where it wraps from
 * ~1 to ~0 and the grid snaps a full tile backwards. That snap is the "map ticks
 * back while dragging" report. It is now measured from the NEAREST tile, whose
 * domain is `[-0.5, 0.5)` and has no discontinuity; see `map-pan.ts`.
 *
 * ★ THE OFFSET IS DERIVED, NOT STORED.
 *
 * It used to be a piece of state written by `commitCentre`, seeded once from the
 * initial centre and re-derived on every zoom. Three copies of one fact, and the
 * copy that drifted was the one the picture used — a zoom followed by a drag
 * painted one frame at the old zoom's scale before correcting itself, which is a
 * second tick. It is now computed from `lat`/`lng`/`zoom` during render, so it
 * cannot disagree with them.
 *
 * ★ THE SEARCH IS DEBOUNCED ON THE QUERY ALONE.
 *
 * The effect listed `lat`/`lng` as dependencies to bias results near the visible
 * area — but those change on every frame of a drag, so the 300 ms timer was reset
 * continuously and the request never fired. Panning the map once was enough to
 * make search stop working entirely, which is the reported "no results, whatever
 * I search". The bias is read from a ref at fire time instead.
 *
 * ★ AND A FAILED SEARCH IS A VISIBLE STATE.
 *
 * The old `catch` set the results to an empty array, so a 404, a 500 and "this
 * place does not exist" were indistinguishable. The custom pin is a first-class
 * path in this product, so an unavailable provider says so and offers it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
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
  MIN_SEARCH_LENGTH,
  searchPlaces,
  type PlaceResult,
} from '@/src/features/venues/services/place-search';
import { haptics } from '@/src/platform/haptics';
import { useLayoutDirection } from '@/src/platform/use-layout-direction';
import {
  MAP_TILE_SIZE,
  centreTileFor,
  formatCoordinates,
  gridOriginFor,
  gridSpanFor,
  tileOffsetFor,
  translateCentre,
} from '@/src/components/ui/map-pan';
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

/**
 * One tile's edge, for the tile itself.
 *
 * ★ IT IS THE SAME NUMBER THE GEOMETRY MODULE USES, NOT A LOCAL COPY.
 *
 * A second 256 here would let the drawn tile and the computed grid disagree the
 * day either is tuned, and the symptom would be seams — the defect this file has
 * already paid for once.
 */
const TILE_SIZE = MAP_TILE_SIZE;
const MAP_HEIGHT = 380;
const DEBOUNCE_MS = 300;

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
  const rtl = useLayoutDirection();

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [zoom, setZoom] = useState(14);
  const [placeName, setPlaceName] = useState(initialName);
  const [placeAddress, setPlaceAddress] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  /**
   * ★ A TILE THAT CANNOT LOAD IS A VISIBLE STATE, NOT AN EMPTY FRAME.
   *
   * The tiles come from CARTO's basemap CDN, keyed by `EXPO_PUBLIC_CARTO_API_KEY`.
   * If that key is ever absent from a build every request fails — and there was no
   * `onError`, so each `<Image>` simply painted nothing: the frame stayed a blank
   * rectangle, no error was thrown, and the runtime log was clean. The user could not
   * tell "loading" from "broken" and had no retry.
   */
  const [tilesFailed, setTilesFailed] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  const searchRequestId = useRef(0);

  /**
   * ★ THE PAN CANNOT CLOSE OVER `lat`/`lng`/`zoom`.
   *
   * The responder below is built once, in a `useRef`, so every value it captures
   * is frozen at the first render for the life of the mount. It therefore reads
   * the view from this ref, which `commitCentre` writes on every change, and the
   * zoom from `zoomRef`.
   */
  const centreRef = useRef({ lat: initialLat, lng: initialLng });
  const zoomRef = useRef(zoom);
  const lastPan = useRef({ x: 0, y: 0 });

  /**
   * The bias for a search, read at FIRE time.
   *
   * A ref, so the debounce effect does not depend on the centre: panning must not
   * cancel a search that is already pending.
   */
  const biasRef = useRef({ lat: initialLat, lng: initialLng });

  const commitCentre = (next: { lat: number; lng: number }) => {
    centreRef.current = next;
    biasRef.current = next;
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

  /**
   * ★ THE MAP ONLY CLAIMS A GESTURE IT CAN ACTUALLY PAN WITH.
   *
   * `true` on both of these made the map a black hole for touch: EVERY gesture
   * starting on it became a map drag, including a vertical swipe meant for the
   * page. Tapping the map, then trying to scroll the sheet it sits in, did
   * nothing — the map claimed the responder and held it.
   *
   * The map still takes any deliberate drag: a press that moves is a pan. What
   * it no longer takes is the tap, so a tap falls through to the page.
   *
   * `onPanResponderTerminationRequest` keeps it from locking the page out: even
   * mid-drag the parent scroll view may ask for the responder back, and this one
   * yields rather than fights it — the gesture ends cleanly instead of leaving
   * `isDragging` stuck true.
   */
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
      onPanResponderTerminationRequest: () => true,
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

  // Search places, debounced on the QUERY alone — see the note at the top.
  useEffect(() => {
    const term = searchQuery.trim();

    if (term.length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      setShowResults(false);
      setSearchUnavailable(false);
      return;
    }

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

  /**
   * The grid, re-derived from the centre — and the translation with it.
   *
   * `centreTileFor` is the NEAREST tile and `tileOffsetFor` the continuous
   * distance from its origin, so both change together and neither can wrap.
   */
  const centreTile = useMemo(() => centreTileFor(lat, lng, zoom), [lat, lng, zoom]);
  const tileOffset = useMemo(() => tileOffsetFor(lat, lng, zoom), [lat, lng, zoom]);

  const maxTile = 2 ** zoom - 1;

  /**
   * The measured frame, so the grid can be centred on it and made large enough.
   *
   * Before the first layout pass this is zero, and `gridSpanFor` treats that as
   * one tile-span — the previous behaviour — so the pre-measure frame does not
   * collapse or jump.
   */
  const [canvas, setCanvas] = useState({ canvasWidth: 0, canvasHeight: 0 });

  /**
   * ★ THE MEASUREMENT IS TAKEN FROM THE REAL ELEMENT, NOT ONLY FROM `onLayout`.
   *
   * `onLayout` is the sanctioned RN path, but on the web build this canvas is a
   * `height: 100%` box inside a frame whose height is being resolved by the sheet
   * around it, so the callback either arrives with the pre-stretch size or not at
   * all — measured: nine tiles for a frame that needed twenty-five, and an 18 px
   * strip of background left along the bottom edge.
   *
   * The ref is used to re-read the box after mount and on every resize, so the
   * grid can never be sized from a stale measurement. `onLayout` stays for
   * native, where it is the only signal.
   */
  const canvasRef = useRef<ComponentRef<typeof View> | null>(null);

  const measureCanvas = useCallback(() => {
    const node = canvasRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.getBoundingClientRect !== 'function') return;

    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    setCanvas((prev) =>
      prev.canvasWidth === rect.width && prev.canvasHeight === rect.height
        ? prev
        : { canvasWidth: rect.width, canvasHeight: rect.height },
    );
  }, []);

  /**
   * Re-read the box after mount and whenever it changes size.
   *
   * A one-shot read is not enough: the sheet animates open, and on the web build
   * the frame's height is settled by that animation. `ResizeObserver` is present
   * wherever `getBoundingClientRect` is, so the web build gets every change and
   * native simply relies on `onLayout` — the observer is guarded, not assumed.
   */
  useEffect(() => {
    measureCanvas();

    const node = canvasRef.current as unknown as HTMLElement | null;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => measureCanvas());
    observer.observe(node);

    return () => observer.disconnect();
  }, [measureCanvas]);

  const grid = useMemo(
    () =>
      gridSpanFor({ canvasWidth: canvas.canvasWidth, canvasHeight: canvas.canvasHeight }),
    [canvas.canvasWidth, canvas.canvasHeight],
  );

  const gridOrigin = useMemo(
    () =>
      gridOriginFor({ canvasWidth: canvas.canvasWidth, canvasHeight: canvas.canvasHeight }),
    [canvas.canvasWidth, canvas.canvasHeight],
  );

  /** The columns of the grid, as offsets from the centre tile, centred on it. */
  const tileOffsets = useMemo(() => {
    const middle = Math.floor(grid.count / 2);
    return Array.from({ length: grid.count }, (_, i) => i - middle);
  }, [grid.count]);

  /**
   * ★ THE BASE AND ITS LABELS ARE TWO LAYERS.
   *
   * `dark_all` is a label-composited basemap whose place names are drawn in a
   * mid grey — legible on CARTO's own dark canvas, and all but invisible once the
   * picker's own dark frame is behind it. The request is "turn the place titles
   * white on the dark theme".
   *
   * CARTO publishes the two halves separately: `dark_nolabels` (canvas, no ink)
   * and `dark_only_labels` (transparent, white ink). Compositing the second over
   * the first gives white place names on the dark canvas by construction, rather
   * than hoping a single style's ink happens to be light enough.
   *
   * The light theme keeps `voyager`, whose labels are dark on a light canvas and
   * were never part of the report.
   */
  const cartoKey = process.env.EXPO_PUBLIC_CARTO_API_KEY;
  const isDark = themeName === 'dark';

  const baseStyle = isDark ? 'dark_nolabels' : 'voyager';
  const labelsStyle = isDark ? 'dark_only_labels' : null;

  const tileUri = (style: string, tx: number, ty: number): string =>
    `https://a.basemaps.cartocdn.com/rastertiles/${style}/${zoom}/${tx}/${ty}.png${
      cartoKey ? `?key=${cartoKey}` : ''
    }`;

  /**
   * ★ THE GRID'S COLUMNS AND ROWS COME FROM THE MEASURED FRAME.
   *
   * They used to be hardcoded to `[-1, 0, 1]` around the centre tile, i.e. always
   * three tiles — 768 px — whatever the frame was. On a 480 px frame that left
   * 294 px with no tile, and on 350 px, 246 px, so the placeholder showed through
   * in rectangles and the boundary moved as the grid was dragged. `tileOffsets`
   * is now sized by `gridSpanFor`, which accounts for the frame AND for the
   * half-tile the drag can travel.
   *
   * Columns wrap over the antimeridian; rows clamp at the poles.
   */
  const columns = tileOffsets.map((ox) => (centreTile.x + ox + 2 ** zoom) % 2 ** zoom);
  const rows = tileOffsets.map((oy) => Math.max(0, Math.min(maxTile, centreTile.y + oy)));

  /**
   * ★ THE GRID IS CENTRED ON THE FRAME, AND THE DRAG MOVES IT FROM THERE.
   *
   * The layer used to be pinned at a constant `-TILE_SIZE`, which only fits a
   * frame that is exactly one tile-span. `gridOrigin` places the grid's own
   * centre on the frame's centre; the translate then carries the sub-tile travel,
   * so the picture follows the finger and the frame stays covered at both
   * extremes instead of running off an edge.
   */
  const tileLayerPosition = useMemo(
    () => ({
      left: gridOrigin.left, // rtl-ok: a tile-grid offset, not a text-direction inset
      top: gridOrigin.top,
    }),
    [gridOrigin.left, gridOrigin.top],
  );

  /**
   * ★ THE GRID SLIDES UNDER THE PIN; THE PIN DOES NOT MOVE.
   *
   * The pin stays at the frame's centre and the centre coordinate is what a drag
   * changes, so the tiles have to carry the travel.
   */
  const tileLayerTranslate = {
    transform: [{ translateX: -tileOffset.x }, { translateY: -tileOffset.y }],
  };

  const renderGrid = (
    style: string,
    keyPrefix: string,
    /** Only the base layer reports failure: a missing label tile is cosmetic. */
    reportFailure = false,
  ) => (
    <View
      style={[styles.tileLayer, tileLayerPosition, tileLayerTranslate]}
      key={keyPrefix}
    >
      {rows.map((ty, rowIndex) => (
        <View key={`${keyPrefix}-row-${rowIndex}`} style={styles.tileRow}>
          {columns.map((tx) => (
            <Image
              key={`${keyPrefix}-${zoom}-${tx}-${ty}`}
              source={{ uri: tileUri(style, tx, ty) }}
              style={styles.tile}
              resizeMode="cover"
              onError={reportFailure ? () => setTilesFailed(true) : undefined}
              // A successful load clears the flag, so one dropped tile does not
              // leave the map declared unavailable for the life of the mount.
              onLoad={reportFailure ? () => setTilesFailed(false) : undefined}
            />
          ))}
        </View>
      ))}
    </View>
  );

  const searchTextDirection = rtl ? 'rtl' : 'ltr';

  return (
    <View style={styles.container} testID={testID}>
      {/* Map View Frame */}
      <View style={[styles.mapFrame, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        <View
          ref={canvasRef}
          style={styles.tileCanvas}
          {...panResponder.panHandlers}
          onLayout={measureCanvas}
        >
          {renderGrid(baseStyle, 'base', true)}

          {/*
            ★ THE LABELS GO ON TOP, AND THEY CANNOT SET `tilesFailed`.
            A missing label tile is a cosmetic loss, not a broken map — reporting
            it would show "the map is unavailable" over a map that works.
          */}
          {labelsStyle ? (
            <View style={styles.labelLayer} pointerEvents="none">
              {renderGrid(labelsStyle, 'labels')}
            </View>
          ) : null}
        </View>

        {/* ★ A BLANK FRAME IS NOT A FAILURE STATE. */}
        {tilesFailed && (
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

        {/* Center Target Pin */}
        <View style={styles.centerPinContainer} pointerEvents="none">
          <View style={[styles.pinIconWrapper, isDragging && styles.pinLifted]}>
            <MapPin size={38} color={theme.brand} weight="fill" />
          </View>
          <View style={[styles.pinShadow, { backgroundColor: theme.line }]} />
        </View>

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
              ) : (
                /* ★ AN UNAVAILABLE SEARCH SAYS SO, AND POINTS AT THE PIN.
                   The custom pin is a first-class path in this product — an
                   informal corner no POI database carries is the common case
                   here — so a provider failure is not an error, it is a
                   redirect to that path. */
                <View style={styles.unavailableBody} testID={testID ? `${testID}-search-unavailable` : undefined}>
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
  tileCanvas: {
    width: '100%',
    height: '100%',
    // The layer inside is translated, so the canvas only has to clip it.
    overflow: 'hidden',
  },
  /**
   * ★ THE GRID ANCHORS ON THE FRAME'S TOP-LEFT, NOT ON ITS MIDDLE.
   *
   * A centred grid fights the translate: `justifyContent: 'center'` re-centres
   * the rows on every render, so the sub-tile offset was absorbed by the layout
   * and the picture did not move. Pinned by explicit insets, the translate is the
   * only thing positioning the layer.
   *
   * ★ THE INSETS THEMSELVES ARE COMPUTED, NOT CONSTANTS.
   *
   * They used to be `-TILE_SIZE`, which is right only when the frame is exactly
   * one tile-span. `gridOriginFor` centres the grid on the frame's measured size,
   * so the frame is covered edge to edge at any width or height and at any drag —
   * the seam that appeared wherever the fixed 768 px grid ended.
   */
  tileLayer: {
    position: 'absolute',
    // A PHYSICAL `left`/`top`, applied at the call site.
    //
    // `start` compiles to `inset-inline-start`, which react-native-web resolves against
    // the DOCUMENT direction. `app/+html.tsx` puts `dir` on `<html>`, so in Persian this
    // inset the grid 256px from the RIGHT edge instead of the left — carrying the whole
    // picture out of the frame. Every tile request still succeeded and CARTO still
    // answered `200 image/png`, which is why a blank map looked like "the tiles did not
    // load" rather than "the tiles are somewhere else".
    //
    // The shift is a statement about a pixel grid, not about reading direction, so it
    // has to be physical. `left`/`top` arrive from `gridOriginFor`.
    left: 0, // rtl-ok: replaced by the computed grid origin at the call site
    top: 0, // rtl-ok: replaced by the computed grid origin at the call site
  },
  /** The labels ride the same geometry as the base; they must not drift from it. */
  labelLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0, // rtl-ok: full-bleed inset, symmetric so there is nothing to mirror
    right: 0,
  },
  tileRow: {
    flexDirection: 'row',
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
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
