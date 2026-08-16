import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface OnionooRelay {
  nickname?: string;
  flags?: string[];
  or_addresses?: string[];
  exit_addresses?: string[];
  country?: string;
  as_name?: string;
  last_seen?: string;
}

interface OnionooResponse {
  relays?: OnionooRelay[];
}

// Onionoo's `search` matches by prefix, so we must confirm an exact IP match.
export function hostMatches(list: string[] | undefined, ip: string): boolean {
  if (!list) return false;
  return list.some((entry) => {
    if (entry.startsWith("[")) return false; // IPv6 "[addr]:port"
    const host = entry.includes(":")
      ? entry.slice(0, entry.lastIndexOf(":"))
      : entry;
    return host === ip;
  });
}

/** Tor Project (Onionoo): is this IP a Tor relay or exit node? (no key) */
export const torSource: TiSource = {
  meta: {
    id: "tor-project",
    name: "Tor Project",
    url: "https://metrics.torproject.org",
    category: "reputation",
    requiresKey: false,
    weight: 0.4,
  },
  isEnabled: () => true,
  async check(ip, signal): Promise<SourceFinding> {
    try {
      const { ok, status, data } = await getJson<OnionooResponse>(
        `https://onionoo.torproject.org/details?search=${ip}&fields=nickname,flags,or_addresses,exit_addresses,country,as_name,last_seen`,
        signal,
      );
      if (!ok || !data) return { status: "error", error: `HTTP ${status}` };

      const matching = (data.relays ?? []).filter(
        (r) =>
          hostMatches(r.or_addresses, ip) || hostMatches(r.exit_addresses, ip),
      );

      if (matching.length === 0) {
        return {
          status: "ok",
          score: 0,
          summary: "Not a Tor relay or exit node",
        };
      }

      const isExit = matching.some((r) => (r.flags ?? []).includes("Exit"));
      const relay = matching[0];
      const named = relay.nickname ? ` (${relay.nickname})` : "";

      return {
        status: "ok",
        score: isExit ? 50 : 25,
        categories: ["tor", isExit ? "tor-exit" : "tor-relay"],
        lastSeen: relay.last_seen,
        summary: `${isExit ? "Tor exit node" : "Tor relay, non-exit"}${named}`,
        details: {
          role: isExit ? "exit" : "relay",
          nickname: relay.nickname,
          flags: relay.flags,
          country: relay.country,
          asName: relay.as_name,
          matchingRelays: matching.length,
        },
        raw: matching,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
