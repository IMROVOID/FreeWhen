/**
 * The chat rules that hold without a transport (D23 — PRD-06 FR-6.7b).
 *
 * ★ SPLIT FROM `chat.ts` FOR THE SAME REASON `mute.ts` IS SPLIT.
 *
 * `chat.ts` imports `apiRequest`, which imports `expo-constants`, which pulls a
 * native module the Node test runner cannot load. The composer's bound and the
 * thread's deduplication are exactly the rules that need a failing test — an
 * off-by-one makes the 500th character unsendable, and a missing dedupe shows a
 * sender their own message twice on a live connection. Neither needs a network,
 * so neither should drag one in.
 */

/** The stored bound, mirroring `event_message.body` in migration 009. */
export const MESSAGE_BODY_MIN = 1;
export const MESSAGE_BODY_MAX = 500;

export interface ChatMessage {
  id: string;
  event_id: string;
  participant_id: string;
  /** The display name at the time of sending, snapshotted by the server. */
  sender_name: string;
  body: string;
  message_type: 'chat' | 'system';
  created_at: string;
}

/**
 * Whether a draft may be sent.
 *
 * Whitespace-only drafts are not sendable: the column accepts them, but a bubble
 * containing three spaces says nothing and the server trims to empty anyway.
 * The bound is measured AFTER trimming, which is the order the server uses — so
 * the composer cannot disable a send the server would have accepted.
 */
export function canSend(draft: string): boolean {
  const trimmed = draft.trim();
  return trimmed.length >= MESSAGE_BODY_MIN && trimmed.length <= MESSAGE_BODY_MAX;
}

/** Characters remaining, floored at zero for the counter. */
export function remaining(draft: string): number {
  return Math.max(0, MESSAGE_BODY_MAX - draft.trim().length);
}

/**
 * Appends a message unless it is already present.
 *
 * ★ THE REALTIME ECHO IS WHY THIS EXISTS.
 *
 * A sender sees their own message twice: once as the POST result and once when
 * the realtime change arrives. Deduplicating by id makes the two paths converge
 * on one bubble, which is what the participant expects and what keeps ordering
 * stable while the thread is live.
 */
export function appendMessage(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
): ChatMessage[] {
  if (messages.some((entry) => entry.id === incoming.id)) return [...messages];

  return [...messages, incoming].sort((a, b) => {
    const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
    // Ties break by id so two devices order the same pair identically.
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}
