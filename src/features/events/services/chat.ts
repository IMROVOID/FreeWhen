/**
 * The chat client transport (D23 — PRD-06 FR-6.7b).
 *
 * ★ THE BODY IS USER-GENERATED TEXT, AND THIS MODULE IS THE CLIENT HALF OF THE
 * RULE THAT KEEPS IT OUT OF LOGS.
 *
 * Nothing here logs. A failed send reports a catalogue key; the sentence the
 * participant typed is never in the error, the analytics event, or the state a
 * crash reporter would capture. The composer even keeps the draft on failure —
 * the text the user cannot get back is the thing worth preserving.
 *
 * ★ THE PURE RULES LIVE IN `chat-rules.ts`.
 *
 * The length bound and the thread deduplication are what need tests, and this
 * module imports `apiRequest`, which imports `expo-constants` — a native module
 * the Node runner cannot load. Keeping them apart is what makes them testable.
 */

import { apiRequest } from '@/src/lib/api';

import type { ChatMessage } from './chat-rules';

export {
  MESSAGE_BODY_MAX,
  MESSAGE_BODY_MIN,
  appendMessage,
  canSend,
  remaining,
  type ChatMessage,
} from './chat-rules';

export interface ListMessagesResponse {
  messages: ChatMessage[];
  my_participant_id?: string;
}

export interface ListMessagesResult {
  messages: ChatMessage[];
  myParticipantId?: string;
}

/** Reads the thread, oldest first. */
export async function listMessages(
  eventId: string,
  userId: string | null,
): Promise<ListMessagesResult> {
  const { data } = await apiRequest<ListMessagesResponse>(
    `/api/events/${eventId}/messages`,
    { userId },
  );

  return {
    messages: data.messages,
    myParticipantId: data.my_participant_id,
  };
}

export interface PostMessageResponse {
  message: ChatMessage;
}

/**
 * Posts one message.
 *
 * `body` is sent trimmed: the server trims the same way, so what is stored is
 * what the server accepted rather than what the client hoped.
 */
export async function postMessage(
  eventId: string,
  body: string,
  userId: string | null,
): Promise<ChatMessage> {
  const { data } = await apiRequest<PostMessageResponse>(
    `/api/events/${eventId}/messages`,
    { method: 'POST', userId, body: { body: body.trim() } },
  );

  return data.message;
}

/**
 * Edits an existing message.
 */
export async function editMessage(
  messageId: string,
  body: string,
  userId: string | null,
): Promise<ChatMessage> {
  const { data } = await apiRequest<PostMessageResponse>(
    `/api/messages/${messageId}`,
    { method: 'PATCH', userId, body: { body: body.trim() } },
  );

  return data.message;
}

/**
 * Deletes a message.
 */
export async function deleteMessage(
  messageId: string,
  userId: string | null,
): Promise<void> {
  await apiRequest(`/api/messages/${messageId}`, {
    method: 'DELETE',
    userId,
  });
}

/**
 * Files a report against one message (Apple §1.2).
 *
 * The reason is optional on purpose: requiring an explanation before a
 * participant can flag abuse is friction on exactly the person already having a
 * bad time.
 */
export async function reportMessage(
  messageId: string,
  userId: string | null,
  reason?: string,
): Promise<void> {
  await apiRequest(`/api/messages/${messageId}/report`, {
    method: 'POST',
    userId,
    body: reason ? { reason } : {},
  });
}
