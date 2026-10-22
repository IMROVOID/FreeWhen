/**
 * The pending-write queue.
 *
 * ★ WHY THIS EXISTS AT ALL.
 *
 * Two flows discard the page state without asking: a language switch, which
 * reloads, and an account deletion, which revokes the session. A write the
 * network has not accepted yet survives neither. This is the seam that lets
 * those flows drain first — and the reason AC-18.8.1 can be asserted rather
 * than hoped for.
 *
 * ★ IT IS A SEAM, NOT AN OFFLINE STORE.
 *
 * Registrations are held in memory. A durable outbox is a larger feature with
 * its own conflict rules, and building it here would mean shipping a
 * half-finished one. What a caller can rely on is the CONTRACT: whatever has
 * been registered as pending runs before the flush resolves, and a failure in
 * one writer does not stop the others.
 */

/** A unit of deferred work. Resolving means the write reached the server. */
export type PendingWrite = () => Promise<void>;

const writers = new Set<PendingWrite>();

/**
 * Registers work that must complete before the page is discarded.
 *
 * Returns an unsubscribe, so a caller that finishes its write can drop the
 * registration rather than leave a stale closure behind.
 */
export function registerPendingWrite(write: PendingWrite): () => void {
  writers.add(write);
  return () => {
    writers.delete(write);
  };
}

/** How many writes are waiting. Used by tests and by the flush's own logging. */
export function pendingWriteCount(): number {
  return writers.size;
}

/**
 * Runs every registered write, then clears the registry.
 *
 * A writer that throws is dropped rather than retried forever: the page is
 * about to reload, so a rejected write would be attempted again on the next
 * visit through its own path. The first error is still surfaced, because a
 * caller that ignores a failed flush is choosing to lose data silently.
 */
export async function flushPendingWrites(): Promise<void> {
  const pending = [...writers];
  writers.clear();

  const results = await Promise.allSettled(pending.map((write) => write()));

  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected) throw rejected.reason;
}

/** Drops every registration without running it. Tests call this between cases. */
export function clearPendingWrites(): void {
  writers.clear();
}
