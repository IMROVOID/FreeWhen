/**
 * How far a finger must travel before the map's native interceptor claims the touch.
 *
 * ★ BELOW THIS, THE TOUCH MUST REACH THE MAP.
 *
 * The interceptor is a NATIVE gesture over the `WebView`. While it is active the
 * WebView receives nothing — so a claim taken at the first pixel would pan the map
 * by the allowance and then hand the finger back, which is exactly the reported
 * "the map only moves about a centimetre and I have to drag again". Claiming on the
 * FIRST MOVE (`minDistance(0)`) is what makes every drag after that one the map's.
 */
export const MAP_GESTURE_ALLOWANCE = 6;

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
 * ★ AND A REACT `PanResponder` CANNOT WIN THAT RACE.
 *
 * The first attempt forwarded the claim with `injectJavaScript` and raised a
 * `PanResponder` on that report. It cannot work: the report is asynchronous, and
 * the `ScrollView`'s native gesture has already claimed the drag by the time it
 * arrives — so most drags scrolled the page, and the ones that did not moved the
 * map only until the finger left the WebView's own recogniser. A native gesture
 * on the ANCESTOR is the only thing that competes at the right moment: the
 * gesture-handler dispatcher resolves the claim natively, before the scroll view's
 * recogniser sees the touch. So the interceptor lives in `InteractiveMap.native`.
 *
 * This file keeps the decision, so "does this gesture belong to the map?" stays a
 * question with a testable answer, and so the web half can ask the same one.
 */

/**
 * Whether a gesture of this size belongs to the map.
 *
 * A tap belongs to the map too — `onPress` is how the picker drops its pin — so
 * there is no threshold here: any touch that moves at all is the map's, in either
 * direction.
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
