import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";
import { currentLane } from "../../keys";
import { bulkTrancoFinding, loadTopList } from "../tranco-list";

interface TrancoResponse {
  domain?: string;
  ranks?: { date: string; rank: number }[];
}

const API = "https://tranco-list.eu/api/ranks/domain";

/**
 * How high a domain must rank before its popularity is treated as a vouch.
 *
 * Deliberately strict. Popularity is not safety: any site can be compromised,
 * and plenty of the top million exist to host user content. A thousand is the
 * band where a domain is a household name, and where a lone source flagging it
 * is far more likely to be a false positive than a discovery.
 */
export const VOUCH_RANK = 1000;

/** Ranks worth reporting at all. Below this the number says little. */
export const NOTABLE_RANK = 1_000_000;

/** Most recent rank in the series, which the API returns newest first. */
export function latestRank(ranks: TrancoResponse["ranks"]): number | undefined {
  const valid = (ranks ?? []).filter((r) => Number.isFinite(r.rank) && r.rank > 0);
  if (valid.length === 0) return undefined;
  return valid.reduce((best, r) => (r.date > best.date ? r : best), valid[0]).rank;
}

export function trancoFinding(data: TrancoResponse): SourceFinding {
  const rank = latestRank(data.ranks);
  if (rank === undefined || rank > NOTABLE_RANK) {
    // Absence is the common case and means nothing on its own: most domains are
    // not in the top million, including most perfectly ordinary ones.
    return { status: "ok", summary: "Not in the Tranco top million" };
  }

  const vouched = rank <= VOUCH_RANK;
  return {
    status: "ok",
    score: 0,
    allowlisted: vouched,
    categories: vouched ? ["popular-domain"] : undefined,
    summary: `Tranco rank ${rank.toLocaleString("en-US")}${
      vouched ? ", a top-ranked domain" : ""
    }`,
    details: { rank, vouched },
  };
}

/**
 * Tranco: research-grade domain popularity ranking (no key).
 *
 * The one thing this app has almost none of is evidence *for* an indicator.
 * Thirteen scoring sources answer "is this bad" and until recently exactly one
 * could say "this is fine", which is how a zero-byte file and a public research
 * scanner both come back malicious.
 *
 * Weight 0, and it never contributes a score. Its only effect is the allowlist
 * flag on a genuinely top-ranked domain, which aggregateRisk() reads to
 * withhold a *weak* floor. A strong listing still stands: a compromised major
 * site must remain reportable.
 *
 * Tranco is used rather than a raw Alexa-style list because it is built to
 * resist the manipulation those lists are prone to, which matters when the
 * ranking is being used as a trust signal.
 */
export const trancoSource: TiSource = {
  meta: {
    id: "tranco",
    name: "Tranco",
    url: "https://tranco-list.eu",
    category: "context",
    requiresKey: false,
    weight: 0,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    // Bulk asks about thousands of domains; the per-domain API rate-limits on
    // the second. The daily top list answers the only question that moves a
    // score (rank <= VOUCH_RANK) from memory.
    if (currentLane() === "bulk") {
      try {
        return bulkTrancoFinding(domain, await loadTopList(signal));
      } catch (err) {
        return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
      }
    }
    try {
      const { ok, status, data } = await getJson<TrancoResponse>(
        `${API}/${encodeURIComponent(domain)}`,
        signal,
      );
      if (status === 429) {
        return { status: "rate_limited", error: "Tranco rate limit" };
      }
      if (!ok || !data) return { status: "error", error: `HTTP ${status}` };
      return trancoFinding(data);
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
