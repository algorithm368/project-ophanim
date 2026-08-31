import { extractIps } from "@/lib/ioc";
import { bulkGeolocate } from "@/lib/ti/geo";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One ip-api /batch request, bounded below at 8s; headroom above it.
export const maxDuration = 15;

/**
 * Bulk geolocation: POST { ips: string } (free-form list) or { ips: string[] }.
 * Returns { results: GeoRow[] }. Geo-only — no threat-intel scoring, cache, or
 * history. Invalid/private/reserved/duplicate entries are dropped by extractIps.
 */
/**
 * The `ips` field as one newline-separated blob, however it arrived.
 *
 * A client may send the textarea's contents verbatim or an already-split array;
 * both reduce to the same thing the extractor downstream wants. Anything else
 * is not an answer to "which addresses", and returns null so the caller can
 * reject it rather than silently geolocating nothing.
 */
function readIpsField(val: unknown): string | null {
  if (typeof val === "string") return val;
  if (!Array.isArray(val)) return null;
  return val.filter((x): x is string => typeof x === "string").join("\n");
}

async function bulkGeo(request: Request) {
  let raw: string | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    raw = readIpsField(body.ips);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!raw) {
    return Response.json({ error: "Missing 'ips' parameter" }, { status: 400 });
  }

  const ips = extractIps(raw);
  if (ips.length === 0) {
    return Response.json(
      { error: "No valid, routable IP addresses found." },
      { status: 400 },
    );
  }

  try {
    // One ip-api /batch request; 8s is generous for up to 100 IPs.
    const results = await bulkGeolocate(ips, AbortSignal.timeout(8000));
    return Response.json({ results });
  } catch (err) {
    console.error("[ti] geo lookup failed:", err);
    return Response.json(
      { error: "The geolocation lookup failed. Please try again." },
      { status: 502 },
    );
  }
}

// The second lock. proxy.ts already refuses anonymous callers; this is what
// still refuses if the proxy's matcher is ever edited out from under us.
export async function POST(request: Request) {
  return (await requireSession()) ?? bulkGeo(request);
}
