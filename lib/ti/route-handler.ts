import { type NextRequest } from "next/server";
import { getHistory, recordHistory } from "./history";
import type { SourceResult, TiSource, Verdict } from "./types";

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

  async function jsonResult(value: V, refresh: boolean): Promise<Response> {
    const histKey = String(value);
    if (!refresh) {
      const cached = await config.getCached(value);
      if (cached) {
        const history = await getHistory(config.label, histKey);
        return Response.json({ ...cached, cached: true, history });
      }
    }

    try {
      const result = await config.run(value);
      await config.setCached(value, result);
      await recordHistory(config.label, histKey, snapshotOf(result));
      const history = await getHistory(config.label, histKey);
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
          if (!refresh) {
            const cached = await config.getCached(value);
            if (cached) {
              const history = await getHistory(config.label, histKey);
              send({
                type: "done",
                result: { ...cached, cached: true, history },
              });
              return;
            }
          }

          const total = config.sources.length;
          send({ type: "start", total, sources: config.sources.map((s) => s.meta) });

          let done = 0;
          const result = await config.run(value, (r) => {
            done += 1;
            send({ type: "source", result: r, done, total });
          });
          await config.setCached(value, result);
          await recordHistory(config.label, histKey, snapshotOf(result));
          const history = await getHistory(config.label, histKey);
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
    return jsonResult(v.value, isTruthy(params.get("refresh")));
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
    return jsonResult(v.value, refresh);
  }

  return { GET, POST };
}
