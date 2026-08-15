import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { loadOpenphishFeed } from "../../feeds/openphish";
import { parseUrl } from "@/lib/url";

/**
 * OpenPhish community phishing feed, matched on the exact URL (no key).
 *
 * The feed lines are full URLs, so this is the strong form of the claim the
 * domain-level source can only approximate. A host match is reported without a
 * score: one compromised site can serve a phishing page and a hundred innocent
 * ones, so "this host has been used for phishing" is context for the analyst,
 * not a verdict on the URL they pasted.
 */
export const openphishUrlSource: TiSource = {
  meta: {
    id: "openphish-url",
    name: "OpenPhish (URL)",
    url: "https://openphish.com",
    category: "blocklist",
    requiresKey: false,
    weight: 0.9,
  },
  isEnabled: () => true,
  async check(url, signal): Promise<SourceFinding> {
    try {
      const parsed = parseUrl(url);
      if (!parsed) return { status: "error", error: "Unparseable URL" };

      const { urls, hosts } = await loadOpenphishFeed(signal);
      if (urls.has(parsed.canonical)) {
        return {
          status: "ok",
          malicious: true,
          score: 90,
          categories: ["phishing"],
          summary: "Exact URL is on the OpenPhish feed",
          details: { feedSize: urls.size },
        };
      }
      if (hosts.has(parsed.host)) {
        return {
          status: "ok",
          score: 0,
          summary:
            "Not listed, though the host appears on the feed for other URLs",
        };
      }
      return { status: "ok", score: 0, summary: "Not on the OpenPhish feed" };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
