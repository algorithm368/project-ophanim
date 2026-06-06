import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getText, isTimeout } from "../http";

/** Parse blocklist.de's "attacks: N<br />reports: M" plain-text body. */
export function parseBlocklistDe(text: string): {
  attacks: number;
  reports: number;
} {
  return {
    attacks: Number(/attacks:\s*(\d+)/i.exec(text)?.[1] ?? "0"),
    reports: Number(/reports:\s*(\d+)/i.exec(text)?.[1] ?? "0"),
  };
}

/** Attack count → 0-100 score (30 base + 5 per attack once any are seen). */
export function blocklistDeScore(attacks: number): number {
  return attacks > 0 ? Math.min(100, 30 + attacks * 5) : 0;
}

/** blocklist.de: aggregated abuse/attack reports from fail2ban reporters (no key). */
export const blocklistDeSource: TiSource = {
  meta: {
    id: "blocklist-de",
    name: "blocklist.de",
    url: "https://www.blocklist.de",
    category: "blocklist",
    requiresKey: false,
    weight: 0.6,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, text } = await getText(
        `https://api.blocklist.de/api.php?ip=${ip}`,
        signal,
      );
      if (!ok) return { status: "error", error: `HTTP ${status}` };

      // Response looks like: "attacks: 5<br />reports: 3"
      const { attacks, reports } = parseBlocklistDe(text);
      const score = blocklistDeScore(attacks);

      return {
        status: "ok",
        malicious: attacks >= 5,
        score,
        summary:
          attacks > 0
            ? `${attacks} attack(s), ${reports} report(s) in the last 48h`
            : "No recent attacks reported",
        details: { attacks, reports },
        raw: text.trim(),
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
