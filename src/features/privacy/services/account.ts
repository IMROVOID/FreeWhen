/**
 * The account-deletion client (Plan 09 Task 10).
 *
 * One call, one irreversible outcome — so the confirmation lives in the UI
 * (`DeleteAccountAction`), and this module does nothing but transport it.
 */

import { apiRequest } from '@/src/lib/api';

export interface AccountDeletionResult {
  deleted: true;
  /** Events the person organised, which were removed with the account. */
  events_deleted: number;
}

/** Deletes the caller's account. Irreversible — confirm before calling. */
export async function deleteAccount(userId: string | null): Promise<AccountDeletionResult> {
  const { data } = await apiRequest<AccountDeletionResult>('/api/account', {
    method: 'DELETE',
    userId,
  });

  return data;
}
