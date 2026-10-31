/**
 * Who owns a drag that begins inside a map.
 *
 * ★ THE MAP IS A WEBVIEW ON A DEVICE, AND A WEBVIEW NEVER HANDS A TOUCH BACK.
 *
 * On iOS and Android the map is `react-native-webview` running the same
 * `mapbox-gl` document the browser runs. `scrollEnabled={false}` stops the
 * WebView scrolling itself, and `touch-action: none` inside the document stops the
 * DOCUMENT claiming a finger as a scroll — but neither of those reaches React
 * Native. A `WebView` is an opaque native view: it does not participate in RN's
 * responder negotiation, so an ancestor `ScrollView` is free to claim a vertical
 * drag that began on the map and scroll itself instead. That is exactly the
 * reported defect, and it is asymmetric for the same reason it always was: the
 * page's scroll view is VERTICAL, so only the vertical drag was stolen.
 *
 * ★ SO THE DOCUMENT TELLS THE APP WHEN A FINGER IS DOWN IN IT.
 *
 * The document already reports camera and press events over the bridge. It now
 * also reports the beginning and end of a touch, and the app's own wrapper — a
 * `View` with a `PanResponder` around the WebView — becomes the responder for as
 * long as that is true. Once this wrapper holds the responder, the ancestor
 * `ScrollView` has lost the negotiation and does not scroll; the touch goes on to
 * the WebView, which pans the map.
 *
 * ★ THE PREDICATE IS HERE, AND SHARED, BECAUSE IT IS THE RULE.
 *
 * `PullToSync` (web) asks the same question — "is this gesture the map's?" — and
 * answers it by walking up from the event target. Both platforms must agree, so
 * the rule lives in one function and both callers import it.
 */

/**
 * Whether a gesture of this size belongs to the map.
 *
 * A `0,0` move is a tap, and a tap is the map's too — `onPress` is how the picker
 * drops its pin. There is therefore no threshold here: any touch that begins
 * inside the map and moves at all is the map's, in either direction.
 *
 * `dx`/`dy` are in points and may be zero.
 */
export function claimsMapGesture(move: { dx: number; dy: number }): boolean {
  return Number.isFinite(move.dx) && Number.isFinite(move.dy);
}

/**
 * Whether a downward page pull must decline a gesture that began on a map.
 *
 * The web half of the same rule: `PullToSync` is a JS responder over the whole
 * page, and a drag on the map satisfies its direction test perfectly, so it has to
 * be told the gesture is not its own. Kept beside `claimsMapGesture` so the two
 * answers cannot drift.
 */
export function mapOwnsGesture(originIsMap: boolean): boolean {
  return originIsMap;
}
