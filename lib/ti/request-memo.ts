import { AsyncLocalStorage } from "node:async_hooks";
import { feedSignal, withDeadline } from "./shared-feed";

/**
 * Identical upstream requests shared within one search.
 *
 * Sources run in parallel and never read one another's output, so on a domain
 * search several of them used to ask a resolver the very same question a few
 * milliseconds apart: dnsSource and dnsGeoSource each ran the same five-resolver
 * A-record vote, and rpki, fcrdns and cloud-range each asked Cloudflare for that
 * A record again. Inside a `withRequestMemo` scope those collapse onto one
 * request, which is cheaper and also means every source sees the same answer,
 * so two cards built from one lookup can no longer disagree on a GeoDNS name.
 *
 * The scope is one search: the per-type check orchestrators wrap their `runAll`
 * call in it. Not orchestrate.ts itself, because client components import that
 * module and `node:async_hooks` cannot be bundled for the browser. Nothing
 * outlives the scope, so this is deduplication, not caching: freshness is never
 * in question.
 *
 * The shared request runs on `feedSignal()` rather than on whichever caller
 * arrived first, and each caller waits through `withDeadline`, for the same
 * reason `sharedLoader` does: one source's per-source budget running out must
 * not cancel the request for the others still waiting on it.
 */
const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Run `fn` with a fresh memo, so requests it makes can be shared. */
export function withRequestMemo<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(new Map(), fn);
}

/**
 * Run `work` once per `key` within the current scope, every caller waiting on
 * its own deadline. Outside a scope it simply runs `work` on the caller's
 * signal, so a source used on its own behaves exactly as before.
 */
export function memoized<T>(
  key: string,
  callerSignal: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const memo = store.getStore();
  if (!memo) return work(callerSignal);

  let shared = memo.get(key) as Promise<T> | undefined;
  if (!shared) {
    shared = work(feedSignal());
    // Keep an unobserved rejection from surfacing as unhandled when every
    // caller has already stopped waiting; each caller still sees it below.
    shared.catch(() => {});
    memo.set(key, shared);
  }
  return withDeadline(shared, callerSignal);
}
