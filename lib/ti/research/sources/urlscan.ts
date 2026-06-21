import type { IOCType } from "@/lib/ioc";
import { errorMessage, getJson, isTimeout } from "../../http";
import type {
  ResearchFinding,
  ResearchProvider,
  UrlScanItem,
} from "../types";

/** Default number of recent scans to surface. */
const MAX_ITEMS = 8;

interface UrlScanSearchResult {
  _id?: string;
  task?: { time?: string; url?: string };
  page?: {
    url?: string;
    ip?: string;
    country?: string;
    asn?: string;
  };
  screenshot?: string;
}

interface UrlScanSearchResponse {
  results?: UrlScanSearchResult[];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** Map a URLScan search response into normalized scan items (pure). */
export function parseUrlScan(payload: unknown, limit = MAX_ITEMS): UrlScanItem[] {
  const results = (payload as UrlScanSearchResponse | null)?.results;
  if (!Array.isArray(results)) return [];

  const items: UrlScanItem[] = [];
  for (const r of results) {
    const id = str(r?._id);
    if (!id) continue;
    const page = r.page ?? {};
    items.push({
      scanUrl: `https://urlscan.io/result/${id}/`,
      pageUrl: str(page.url) ?? str(r.task?.url) ?? "",
      screenshot:
        str(r.screenshot) ?? `https://urlscan.io/screenshots/${id}.png`,
      time: str(r.task?.time),
      ip: str(page.ip),
      country: str(page.country),
      asn: str(page.asn),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** The URLScan field to match on for each indicator type. */
function queryFor(indicator: string, kind: IOCType): string {
  return kind === "ip" ? `ip:${indicator}` : `domain:${indicator}`;
}

/** URLScan.io public submissions search (no key). Surfaces recent scans of the
 *  indicator plus page screenshots, which no scored source provides. */
export const urlScanProvider: ResearchProvider = {
  meta: {
    id: "urlscan",
    name: "URLScan",
    url: "https://urlscan.io",
  },
  supports: ["ip", "domain"],
  isEnabled: () => true,
  async check(indicator, kind, signal): Promise<ResearchFinding> {
    try {
      const q = encodeURIComponent(queryFor(indicator, kind));
      const { ok, status, data } = await getJson<UrlScanSearchResponse>(
        `https://urlscan.io/api/v1/search/?q=${q}&size=${MAX_ITEMS}`,
        signal,
      );
      if (status === 429) {
        return { status: "error", error: "URLScan rate limit reached" };
      }
      if (!ok) {
        return { status: "error", error: `URLScan HTTP ${status}` };
      }
      const scans = parseUrlScan(data);
      if (scans.length === 0) {
        return { status: "empty", summary: "No public scans found" };
      }
      return {
        status: "ok",
        summary: `${scans.length} recent scan${scans.length === 1 ? "" : "s"}`,
        link: `https://urlscan.io/search/#${encodeURIComponent(queryFor(indicator, kind))}`,
        data: { type: "urlscan", scans },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
