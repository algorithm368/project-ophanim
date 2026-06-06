import { Resolver } from "node:dns/promises";
import type { SourceFinding, TiSource } from "../../types";

// Quad9 is a security-filtering resolver: it returns NXDOMAIN for domains on its
// malicious-domain blocklist. Comparing it against a non-filtering control
// resolver (Cloudflare) tells us whether a domain is *blocked* vs simply absent.
const QUAD9_SERVERS = ["9.9.9.9", "149.112.112.112"];
const CONTROL_SERVERS = ["1.1.1.1", "1.0.0.1"];

export type Outcome = "resolves" | "nxdomain" | "error";

/**
 * Turn the two resolver outcomes into a finding. Blocked = a real domain (the
 * control answers) that Quad9 refuses to resolve. Everything else is clean or
 * inconclusive. Pure: no network.
 */
export function quad9Verdict(quad9: Outcome, control: Outcome): SourceFinding {
  if (quad9 === "error" && control === "error") {
    return {
      status: "error",
      error: "Both resolvers failed to respond; no verdict obtained.",
    };
  }

  const details = { quad9, control };

  if (control === "resolves" && quad9 === "nxdomain") {
    return {
      status: "ok",
      malicious: true,
      score: 80,
      categories: ["dns-blocked"],
      summary:
        "On Quad9 protective-DNS blocklist. Control resolver returns valid A-records but Quad9 withholds resolution. Assessment: known-malicious infrastructure; recommend blocking at resolver/egress.",
      details,
    };
  }

  if (control === "nxdomain") {
    return {
      status: "ok",
      score: 0,
      summary:
        "Inconclusive: domain unresolvable on the control resolver, so no Quad9 verdict can be drawn.",
      details,
    };
  }

  return {
    status: "ok",
    score: 0,
    summary:
      "Not on Quad9's blocklist. Resolves cleanly on both protective and control resolvers; no threat-DNS signal.",
    details,
  };
}

async function resolveWith(
  servers: string[],
  host: string,
  timeoutMs: number,
): Promise<Outcome> {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  resolver.setServers(servers);
  try {
    const addrs = await resolver.resolve4(host);
    return addrs.length > 0 ? "resolves" : "nxdomain";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return "nxdomain";
    return "error";
  }
}

/** Quad9 - security-filtering DNS; NXDOMAIN where a control resolver answers = blocked (no key). */
export const quad9Source: TiSource = {
  meta: {
    id: "quad9",
    name: "Quad9",
    url: "https://quad9.net",
    category: "blocklist",
    requiresKey: false,
    weight: 0.8,
  },
  isEnabled: () => true,
  async check(domain): Promise<SourceFinding> {
    const [quad9, control] = await Promise.all([
      resolveWith(QUAD9_SERVERS, domain, 4000),
      resolveWith(CONTROL_SERVERS, domain, 4000),
    ]);

    return quad9Verdict(quad9, control);
  },
};
