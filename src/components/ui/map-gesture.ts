/**
 * How far a finger may travel before an ancestor may claim the gesture.
 *
 * ★ NOTHING ABOVE THE MAP CLAIMS ANY MORE, AND THAT IS THE FIX.
 *
 * Three attempts were measured on an emulator, and the third is why this file now
 * documents a NEGATIVE result rather than a mechanism:
 *
 *  1. A React `PanResponder` raised on a bridge report. Asynchronous, so the page's
 *     `ScrollView` had already taken the drag: most drags scrolled the page.
 *  2. The same, tightened. Some drags reached the map and then stopped after a few
 *     points, because the WebView's own recogniser gave the finger up.
 *  3. A `react-native-gesture-handler` `Gesture.Pan` on the map's wrapper, which
 *     resolves natively before the scroll view is consulted. Measured on an x86_64
 *     emulator against the installed APK: a TAP on the map's `+` control zoomed it
 *     (the screen changed), and a DRAG in the identical box did nothing at all —
 *     neither the map nor the page moved. The ancestor gesture swallows the drag
 *     before the `WebView`'s own recogniser sees it, and `cancelsTouchesInView(false)`
 *     does not change that: the handler still claims the movement.
 *
 * So no ancestor claims the touch. The `WebView` gets every touch in its box and
 * hands it to `mapbox-gl`, which is what the tap already proved works; and the page's
 * `ScrollView` is kept out of the way by the DOCUMENT instead — `nestedScrollEnabled`
 * off, and a map that calls `preventDefault` on its own touch events.
 *
 * The lesson is worth more than the constant: a gesture stacked on a `WebView` cannot
 * arbitrate with the page without also starving the map. Only one of the two can own
 * the finger, and it has to be the one that draws.
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
 * The answer is NOT an ancestor gesture — see `MAP_GESTURE_ALLOWANCE` for the three
 * measured attempts. `nestedScrollEnabled={false}` on the WebView is what tells the
 * native view not to hand its drags to a parent scroll view, and the document
 * consumes its own touch events so the page never sees them.
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

/**
 * The native prop written through `setNativeProps` to stand an ancestor down.
 *
 * ★ IT IS A NAME, NOT A MECHANISM, AND IT LIVES HERE TO BE SHARED.
 *
 * The map surface writes it and the test asserts it, so spelling it twice would
 * let the two disagree — the failure mode being "the lock was applied under a name
 * nobody reads", which looks exactly like the bug it was meant to fix.
 *
 * ★ WHY A LOCK AND NOT A GESTURE.
 *
 * On Android a `WebView` is an opaque native view: it takes no part in React
 * Native's responder negotiation, so an ancestor `ScrollView` intercepts a
 * vertical drag as soon as it passes `touchSlop` — before the WebView's own
 * recogniser sees the event. The page scrolls and the map receives
 * `ACTION_CANCEL`. That is the reported "the page scrolls instead of the map
 * moving", and it is asymmetric because the ancestor is vertical.
 *
 * `nestedScrollEnabled={false}` covers iOS (it is a `UIScrollView` behaviour) and
 * reaches nothing on Android. A `RCTScrollView` whose `scrollEnabled` is `false`
 * returns `false` from `onInterceptTouchEvent` unconditionally, which is the one
 * lever that makes the ancestor decline rather than compete. So the map stops
 * *asking* the ancestor and starts *disabling* it, for the duration of the touch.
 *
 * The three ancestor-gesture mechanisms that were measured and rejected are
 * documented on `MAP_GESTURE_ALLOWANCE`; this is not a fourth attempt at those,
 * because nothing above the map ever claims the finger.
 */
export const MAP_ANCESTOR_LOCK_KEY = 'scrollEnabled';
