import { extractIps } from "@/lib/ioc";
import { bulkGeolocate } from "@/lib/ti/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk geolocation: POST { ips: string } (free-form list) or { ips: string[] }.
 * Returns { results: GeoRow[] }. Geo-only — no threat-intel scoring, cache, or
 * history. Invalid/private/reserved/duplicate entries are dropped by extractIps.
 */
export async function POST(request: Request) {
  let raw: string | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const val = body.ips;
    raw =
      typeof val === "string"
        ? val
        : Array.isArray(val)
          ? val.filter((x): x is string => typeof x === "string").join("\n")
          : null;
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
