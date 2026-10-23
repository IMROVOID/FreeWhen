/**
 * The push-permission timing rule (Plan 10 Task 7 — FR-6.14, AC-6.2.1).
 *
 * ★ THE RULE IS ABOUT TIMING, NOT ABOUT ASKING AT ALL.
 *
 * A launch prompt is denied because it arrives before the user has any reason to
 * say yes — and on iOS a denial is expensive: the app gets one prompt and then
 * only Settings can undo it. So the request hangs off the first SUCCESSFUL vote.
 *
 * ★ WHY THIS IS NOT INSIDE THE HOOK.
 *
 * `usePushPermission` imports `react-native`, whose entry point is Flow-typed and
 * cannot be loaded by the Node test runner. The rule is the part that has to be
 * provable, so it lives in a module with no React Native import — the hook and
 * the screen both call it, and the test asserts it directly.
 */

export interface VoteOutcome {
  /** The server reported `previous: null` for this proposal — a first answer. */
  isFirstVote: boolean;
  /** True once this device has been prompted; a second ask is nagging. */
  hasAsked: boolean;
}

/**
 * Whether a completed vote should now ask for push permission.
 *
 * Both conditions are required, and the AND is the whole rule: the ask is
 * pointless before there is something worth notifying about, and a repeat ask
 * after a denial cannot succeed from inside the app.
 */
export function shouldRequestAfterVote({ isFirstVote, hasAsked }: VoteOutcome): boolean {
  if (hasAsked) return false;
  return isFirstVote;
}
