/**
 * Deadlines for a download that several callers share.
 *
 * The feed loaders collapse concurrent callers onto one request, which is
 * right. What is not right is building that request from whichever caller
 * happened to arrive first: its `AbortSignal` is a per-source budget, so when
 * it fires it cancels the download for everyone queued behind it, including
 * callers that still had most of their own budget left.
 *
 * Two pieces, used together:
 *
 *   - `feedSignal()` gives the shared work a lifetime of its own, so no one
 *     caller's deadline can end it.
 *   - `withDeadline()` lets each caller enforce its own deadline against that
 *     work, so a caller that runs out of time reports a timeout and leaves the
 *     download running for the others.
 */

/**
 * The shared download's own budget. Deliberately longer than the longest
 * per-source budget (20s, crt.sh), because the thing it guards is shared and
 * so worth more than any one request waiting on it.
 */
export const FEED_TIMEOUT_MS = 30_000;

/** A lifetime for the shared work, owned by no caller. */
export function feedSignal(): AbortSignal {
  return AbortSignal.timeout(FEED_TIMEOUT_MS);
}

/**
 * Why the caller stopped waiting, in the shape `isTimeout` understands, so a
 * caller that gives up on the shared download still reports `"timeout"` rather
 * than a bare error.
 */
function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

/**
 * Settle with `work`, or reject as soon as `signal` aborts, whichever comes
 * first. Rejecting here abandons the caller's interest in `work`, it does not
 * cancel it: that is the entire point.
 */
export function withDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });

    // Drop the listener in the same turn the work settles, rather than a
    // microtask later: a caller that has already been answered must not still
    // be holding a reference to a signal that may outlive it.
    const settle = <A,>(done: (value: A) => void, value: A) => {
      signal.removeEventListener("abort", onAbort);
      done(value);
    };
    work.then(
      (value) => settle(resolve, value),
      (err) => settle(reject, err),
    );
  });
}

/** A download shared between concurrent callers, each with its own deadline. */
export interface SharedLoader<T> {
  (callerSignal: AbortSignal): Promise<T>;
  /** Tests only: forget any in-flight request. */
  reset(): void;
}

/**
 * Collapse concurrent callers onto one download.
 *
 * The download runs on `feedSignal()`, so it belongs to the loader rather than
 * to whoever asked first, and every caller waits on it through `withDeadline`,
 * so giving up is a private act. The in-flight slot is cleared when the
 * download settles and not when a caller stops waiting, otherwise an impatient
 * caller would send the next one off to start a second copy of a download that
 * is already running.
 *
 * Freshness is not this function's business: the caller keeps its own cache and
 * TTL, and only reaches here on a miss.
 */
export function sharedLoader<T>(
  download: (signal: AbortSignal) => Promise<T>,
): SharedLoader<T> {
  let inflight: Promise<T> | null = null;

  const load = (callerSignal: AbortSignal): Promise<T> => {
    inflight ??= download(feedSignal()).finally(() => {
      inflight = null;
    });
    return withDeadline(inflight, callerSignal);
  };

  load.reset = () => {
    inflight = null;
  };
  return load;
}
