import { type NextRequest } from "next/server";
import { getHistory, MAX_SNAPSHOTS, recordHistory } from "./history";
import type { HistorySnapshot, SourceResult, TiSource, Verdict } from "./types";

/** Either a validated, cleaned indicator value or an error Response to return. */
export type Validated<V> = { value: V } | { error: Response };

/** Result shape the handler needs to cache, snapshot for history, and stream. */
type IndicatorResult = {
  sources: SourceResult[];
  riskScore: number;
  verdict: Verdict;
  checkedAt: string;
};

interface RouteConfig<V, R extends IndicatorResult> {
  /** Body field / query param that carries the indicator (e.g. "ip"). */
  paramName: string;
  /** Used in error logs, e.g. "ip" -> "[ti] ip check failed". */
  label: string;
  /** Sources queried, for the stream's `start` event (count + metas). */
  sources: TiSource[];
  validate: (raw: string | null) => Validated<V>;
  getCached: (value: V) => Promise<R | null>;
  setCached: (value: V, result: R) => Promise<void>;
  run: (value: V, onSettled?: (r: SourceResult) => void) => Promise<R>;
}

const GENERIC_ERROR =
  "The threat-intel lookup failed unexpectedly. Please try again.";

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

const CACHE_HEADERS = {
  // A cached result is deterministic for the TTL window, so let the edge serve
  // repeat lookups. Embedded history can be at most s-maxage stale (acceptable
  // for an append-only timeline). Fresh and error responses stay uncached.
  //
  // This survives `export const dynamic = "force-dynamic"`, which the indicator
  // routes all declare. Measured, not assumed (#58): a route handler returning
  // this header under force-dynamic, served by `next start` off a production
  // build, answers with `cache-control: public, s-maxage=300,
  // stale-while-revalidate=86400` unchanged. Next's `private, no-cache,
  // no-store, max-age=0, must-revalidate` is written on its own responses (404,
  // middleware prefetch, actions) and never over a route handler's.
  //
  // `public` on a route behind auth is deliberate and not a leak: proxy.ts runs
  // before the CDN cache, so an anonymous request is refused before it can be
  // served a copy, and the body is threat-intel data identical for every
  // signed-in user.
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
};

function isTruthy(value: string | null): boolean {
  return value === "1" || value === "true";
}

/**
 * Builds the `GET`/`POST` handlers shared by every indicator route. GET and the
 * non-streaming POST return a single JSON result (cached or fresh); a POST that
 * accepts `application/x-ndjson` streams per-source progress.
 */
export function makeIndicatorRoute<V, R extends IndicatorResult>(
  config: RouteConfig<V, R>,
) {
  const snapshotOf = (result: R) => ({
    checkedAt: result.checkedAt,
    riskScore: result.riskScore,
    verdict: result.verdict,
  });

  /**
   * The response's history array after a write, without a second LRANGE.
   * `priorHistory` is the list as read before the fan-out (null when that read
   * never happened, i.e. a forced refresh); `written` is what recordHistory
   * just wrote, or null if it deduped the point. Appending locally reproduces
   * what a re-read would return: the only divergence is a concurrent write
   * from another request, which the 30-entry window and the one-hour dedupe
   * already make uninteresting.
   */
  function nextHistory(
    priorHistory: HistorySnapshot[] | null,
    written: HistorySnapshot | null,
    histKey: string,
  ): Promise<HistorySnapshot[]> | HistorySnapshot[] {
    if (priorHistory === null) return getHistory(config.label, histKey);
    return written ? [...priorHistory, written].slice(-MAX_SNAPSHOTS) : priorHistory;
  }

  /**
   * `cacheable` is the GET path. CDNs do not cache POST responses, so sending
   * CACHE_HEADERS there would be inert, and an inert header reads as a claim
   * about caching that is broader than the one being made.
   */
  async function jsonResult(
    value: V,
    refresh: boolean,
    cacheable: boolean,
  ): Promise<Response> {
    const histKey = String(value);
    // null (rather than an empty array) marks "never read", so a forced
    // refresh below falls back to a fresh LRANGE instead of appending onto
    // nothing.
    let priorHistory: HistorySnapshot[] | null = null;
    if (!refresh) {
      // Speculatively read cache + history together; kept on a miss, since
      // the write below appends onto it instead of re-reading.
      const [cached, history] = await Promise.all([
        config.getCached(value),
        getHistory(config.label, histKey),
      ]);
      if (cached) {
        return Response.json(
          { ...cached, cached: true, history },
          cacheable ? { headers: CACHE_HEADERS } : undefined,
        );
      }
      priorHistory = history;
    }

    try {
      const result = await config.run(value);
      // setCached is independent of the history write; overlap them.
      const [, written] = await Promise.all([
        config.setCached(value, result),
        recordHistory(config.label, histKey, snapshotOf(result)),
      ]);
      const history = await nextHistory(priorHistory, written, histKey);
      return Response.json({ ...result, cached: false, history });
    } catch (err) {
      console.error(`[ti] ${config.label} check failed:`, err);
      return Response.json({ error: GENERIC_ERROR }, { status: 502 });
    }
  }

  function streamResult(value: V, refresh: boolean): Response {
    const encoder = new TextEncoder();
    const histKey = String(value);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

        try {
          let priorHistory: HistorySnapshot[] | null = null;
          if (!refresh) {
            const [cached, history] = await Promise.all([
              config.getCached(value),
              getHistory(config.label, histKey),
            ]);
            if (cached) {
              send({
                type: "done",
                result: { ...cached, cached: true, history },
              });
              return;
            }
            priorHistory = history;
          }

          const total = config.sources.length;
          send({ type: "start", total, sources: config.sources.map((s) => s.meta) });

          let done = 0;
          const result = await config.run(value, (r) => {
            done += 1;
            send({ type: "source", result: r, done, total });
          });
          // setCached is independent of the history write; overlap them.
          const [, written] = await Promise.all([
            config.setCached(value, result),
            recordHistory(config.label, histKey, snapshotOf(result)),
          ]);
          const history = await nextHistory(priorHistory, written, histKey);
          send({ type: "done", result: { ...result, cached: false, history } });
        } catch (err) {
          console.error(`[ti] ${config.label} check failed:`, err);
          send({ type: "error", error: GENERIC_ERROR });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: STREAM_HEADERS });
  }

  async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const v = config.validate(params.get(config.paramName));
    if ("error" in v) return v.error;
    return jsonResult(v.value, isTruthy(params.get("refresh")), true);
  }

  async function POST(request: NextRequest) {
    let raw: string | null = null;
    let refresh = false;
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const val = body[config.paramName];
      raw = typeof val === "string" ? val : null;
      refresh = body.refresh === true;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const v = config.validate(raw);
    if ("error" in v) return v.error;

    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("application/x-ndjson")) {
      return streamResult(v.value, refresh);
    }
    return jsonResult(v.value, refresh, false);
  }

  return { GET, POST };
}
