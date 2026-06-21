import { type NextRequest } from "next/server";
import type { IOCType } from "@/lib/ioc";
import { runResearch, researchMetasFor } from "@/lib/ti/research/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: IOCType[] = ["ip", "domain", "hash"];

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

/**
 * Live research lane: fetch free public-API context (URLScan, Wayback, crt.sh)
 * for an already-validated indicator. Deliberately separate from the scoring
 * routes — nothing here moves the risk score. With `Accept: application/x-ndjson`
 * it streams one event per provider as it settles (so the UI can show a per-
 * provider skeleton that fills in progressively); otherwise it returns one JSON
 * blob once every provider has resolved.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const indicator = params.get("indicator")?.trim();
  const kind = params.get("kind");

  if (!indicator) {
    return Response.json({ error: "Missing 'indicator'" }, { status: 400 });
  }
  if (!kind || !KINDS.includes(kind as IOCType)) {
    return Response.json({ error: "Invalid 'kind'" }, { status: 400 });
  }
  const iocKind = kind as IOCType;

  const wantsStream = (request.headers.get("accept") ?? "").includes(
    "application/x-ndjson",
  );

  if (!wantsStream) {
    try {
      const results = await runResearch(indicator, iocKind);
      return Response.json({ results });
    } catch (err) {
      console.error("[ti] research failed:", err);
      return Response.json({ error: "Research lookup failed" }, { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        send({ type: "start", providers: researchMetasFor(iocKind) });
        await runResearch(indicator, iocKind, undefined, (result) =>
          send({ type: "result", result }),
        );
        send({ type: "done" });
      } catch (err) {
        console.error("[ti] research stream failed:", err);
        send({ type: "error", error: "Research lookup failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
