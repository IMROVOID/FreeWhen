/**
 * Whether to offer the starting-point question on an event.
 *
 * ★ THE RULE IS A PARTICIPANT'S STATE, NOT THEIR ROLE.
 *
 * The prompt was only ever reached from the invite screen's post-join
 * navigation, so an organiser — who is a participant with a `'organizer'` row and
 * no start point, exactly like a member — was silently left out of every travel
 * estimate their own event produced. Checking `role` would have been the wrong
 * fix: joining and organising are two routes into the same question, and the
 * question is "have you answered?".
 *
 * ★ "none" IS TWO DIFFERENT FACTS.
 *
 * The server reports `'none'` both for a participant who was never asked and for
 * one who chose to skip, because skipping IS a start point of `'none'` — the
 * decision the taxonomy records. The device-side `asked` flag is what separates
 * them, so a skip is respected instead of nagged.
 *
 * ★ AN UNANSWERED LOAD IS NOT AN ANSWER.
 *
 * Before the event has loaded, `state` is unknown rather than `'none'`. Treating
 * that as "no start point" would flash the sheet at an organiser on every cold
 * open, before their own event had a chance to render.
 */

/** The three states the participant taxonomy reports. */
export type StartPointState = 'shared' | 'not_shared' | 'none';

export interface StartPointGateInput {
  state: StartPointState | string | null;
  /** The event payload has arrived and the participant is known. */
  ready: boolean;
  /** This mount has already offered the question, or the person chose to skip. */
  asked: boolean;
}

export function shouldOfferStartPoint({ state, ready, asked }: StartPointGateInput): boolean {
  if (!ready) return false;
  if (asked) return false;
  return state === 'none';
}
