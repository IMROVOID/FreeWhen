/**
 * The chat parser's client (Plan 14 Task 4, PRD-07 FR-7.9).
 *
 * ★ A PARSE THAT FINDS NOTHING IS NOT AN ERROR HERE EITHER.
 *
 * The response always carries `recognised`, and the screen renders the raw text
 * plus a manual-entry prompt when it is false. This module therefore does not
 * throw on an empty list — only on a genuine transport or auth failure, where the
 * user does need to know something went wrong.
 */

import { apiRequest } from '@/src/lib/api';
import type { ParsedCandidate } from '@/src/features/parser/types';

export interface ParseResponse {
  candidates: ParsedCandidate[];
  recognised: boolean;
  limits: { maxChars: number };
}

export async function parseChatText(
  eventId: string,
  text: string,
  userId: string | null,
): Promise<ParseResponse> {
  const { data } = await apiRequest<ParseResponse>(`/api/events/${eventId}/parse`, {
    method: 'POST',
    body: { text },
    userId,
  });

  return data;
}
