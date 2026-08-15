import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { hostOf, loadOpenphishFeed } from "../../feeds/openphish";

// The feed loader and its cache live in lib/ti/feeds/openphish.ts, shared with
// the URL-level source so one download serves both. Re-exported here because
// this module's tests, and its callers, already know hostOf by this path.
export { hostOf };

/** OpenPhish - community phishing URL feed (no key, cached download). */
export const openPhishSource: TiSource = {
  meta: {
    id: "openphish",
    name: "OpenPhish",
    url: "https://openphish.com",
    category: "blocklist",
    requiresKey: false,
    weight: 0.9,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const { hosts } = await loadOpenphishFeed(signal);
      if (!hosts.has(domain)) {
        return { status: "ok", score: 0, summary: "Not in the phishing feed" };
      }
      return {
        status: "ok",
        malicious: true,
        score: 90,
        categories: ["phishing"],
        summary: "Listed as an active phishing host",
        details: { feedSize: hosts.size },
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
