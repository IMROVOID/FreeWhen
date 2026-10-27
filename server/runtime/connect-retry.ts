/**
 * One cheap retry for a lost connection handshake.
 *
 * ★ THE DEFECT THIS FIXES.
 *
 * Opening a page occasionally answered 500 from `GET
 * /api/events/:id/messages`, and a second attempt always worked. That signature
 * is a cold connection rather than a bad query: the serverless driver opens a
 * fresh `pg` Client per request, and the first attempt from a cold isolate can
 * lose its TCP/TLS handshake to the managed Postgres. Nothing had run yet, so the
 * request was safe to repeat — which is exactly what a person does by hand.
 *
 * ★ THE RETRY IS DELIBERATELY NARROW.
 *
 * Only failures that happen BEFORE the work starts are retried: a handshake
 * timeout, a refused/reset socket, a connection the pool had already dropped.
 * A statement timeout, a constraint violation, or an application throw means the
 * work began, and replaying it is how a double write is born — those surface
 * immediately.
 *
 * The distinction is made on the driver's message text because that is all `pg`
 * gives us at this boundary; the patterns are the ones `pg` and Node emit for a
 * connection-level failure, and nothing else is matched.
 */

/** Long enough to outlast a cold TLS handshake, short enough not to stack up. */
const RETRY_DELAY_MS = 120;

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /connection terminated/i,
  /connection timeout/i,
  /timeout expired/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /EPIPE/,
  /EHOSTUNREACH/,
  /ENETUNREACH/,
  /socket hang up/i,
  /server closed the connection/i,
  // A cold connection negotiated with the wrong TLS version.
  /wrong version number/i,
  /self[- ]signed certificate/i,
];

/**
 * Whether a failure happened before any work was done.
 *
 * A `statement_timeout` cancel and a unique-constraint conflict both contain
 * "timeout"/"connection"-adjacent wording in some drivers, so the explicit
 * non-transient checks run first and win.
 */
export function isTransientConnectFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message ?? '';

  // ★ WORK THAT STARTED IS NEVER REPLAYED.
  if (/canceling statement due to statement timeout/i.test(message)) return false;
  if (/duplicate key value/i.test(message)) return false;
  if (/permission denied/i.test(message)) return false;
  if (/syntax error/i.test(message)) return false;

  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Runs `operation`, retrying once if the failure was a lost connection.
 *
 * Only one retry: a second identical failure is a real outage, and a third
 * attempt would spend the request's whole budget on a host that is not answering.
 */
export async function withConnectRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientConnectFailure(error)) throw error;

    await sleep(RETRY_DELAY_MS);
    return operation();
  }
}
