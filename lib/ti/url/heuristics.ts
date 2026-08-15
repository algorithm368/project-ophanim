import { parseUrl, type ParsedUrl } from "@/lib/url";
import type { SourceFinding, TiSource } from "../types";

/** One structural observation about a URL string. */
export interface HeuristicHit {
  id: string;
  label: string;
  score: number;
  category: string;
}

/**
 * Ceiling for the combined heuristic score, deliberately below MALICIOUS_AT
 * (70). Structure can raise suspicion but must never reach a malicious verdict
 * on its own: every rule here is a guess about shape, not a report of observed
 * behaviour.
 */
const SCORE_CAP = 65;

const BRANDS = [
  "paypal", "microsoft", "apple", "google", "amazon", "facebook", "netflix",
  "instagram", "whatsapp", "linkedin", "dhl", "fedex", "chase", "wellsfargo",
];

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "t.ly",
]);

const REDIRECT_PARAMS = new Set([
  "url", "next", "redirect", "redirect_uri", "return", "returnurl", "r", "u",
  "dest", "destination", "continue", "goto",
]);

const EXECUTABLE = /\.(exe|scr|hta|js|jar|bat|cmd|ps1|vbs|msi)$/i;
const DOUBLE_EXT = /\.(pdf|doc|docx|xls|xlsx|jpg|png|txt)\.[a-z0-9]{2,4}$/i;
const BLOB = /[A-Za-z0-9+/=]{40,}/;

/** Levenshtein distance. Inputs here are single DNS labels, so the quadratic
 *  table is bounded by 63 characters. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/** Host labels minus the public-suffix guess, split on separators, for brand
 *  comparison. "paypa1-secure.com" yields ["paypa1", "secure"]. */
function brandCandidates(host: string): string[] {
  return host
    .split(".")
    .slice(0, -1)
    .flatMap((label) => label.split(/[-_]/))
    .filter(Boolean);
}

/** Every structural observation about this URL, strongest intent first. */
export function urlHeuristics(parsed: ParsedUrl): HeuristicHit[] {
  const hits: HeuristicHit[] = [];
  const push = (id: string, label: string, score: number, category: string) =>
    hits.push({ id, label, score, category });

  if (parsed.host.split(".").some((label) => label.startsWith("xn--"))) {
    push(
      "punycode",
      "Host uses punycode, which can imitate another name",
      30,
      "homograph",
    );
  }
  if (parsed.isIpHost) {
    push(
      "ip-host",
      "Host is a raw IP address, with no domain behind it",
      20,
      "infrastructure",
    );
  }
  if (parsed.userinfo) {
    push("credentials", "Credentials embedded in the URL", 25, "phishing");
  }
  if (parsed.port) {
    push("odd-port", `Non-standard port ${parsed.port}`, 10, "infrastructure");
  }
  if (SHORTENERS.has(parsed.host)) {
    push(
      "shortener",
      "URL shortener, so the destination is not visible",
      15,
      "obfuscation",
    );
  }
  for (const candidate of brandCandidates(parsed.host)) {
    // An exact brand label is the brand's own domain, not an imitation of it.
    const near = BRANDS.find(
      (brand) =>
        candidate !== brand &&
        candidate.length >= 4 &&
        distance(candidate, brand) <= 2,
    );
    if (near) {
      push(
        "brand-lookalike",
        `Host resembles the brand "${near}"`,
        30,
        "typosquat",
      );
      break;
    }
  }
  const params = new URLSearchParams(parsed.query ?? "");
  for (const key of params.keys()) {
    if (
      REDIRECT_PARAMS.has(key.toLowerCase()) &&
      /https?:\/\//i.test(params.get(key) ?? "")
    ) {
      push(
        "open-redirect",
        `Parameter "${key}" carries another URL`,
        20,
        "redirect",
      );
      break;
    }
  }
  if (BLOB.test(parsed.path) || BLOB.test(parsed.query ?? "")) {
    push(
      "encoded-blob",
      "Long encoded blob in the path or query",
      10,
      "obfuscation",
    );
  }
  if (EXECUTABLE.test(parsed.path) || DOUBLE_EXT.test(parsed.path)) {
    push(
      "executable",
      "Path points at an executable or a double extension",
      25,
      "malware-delivery",
    );
  }
  return hits;
}

/**
 * Structural signal only. This never sets `malicious`, and its total is capped
 * below the malicious cutoff: computeFloor pins the score to 75 for any
 * weighted source that declares `malicious`, and a guess about URL shape has no
 * business reaching that gate.
 */
export function heuristicsFinding(parsed: ParsedUrl): SourceFinding {
  const hits = urlHeuristics(parsed);
  if (hits.length === 0) {
    return { status: "ok", score: 0, summary: "No structural red flags" };
  }
  const score = Math.min(
    SCORE_CAP,
    hits.reduce((sum, hit) => sum + hit.score, 0),
  );
  const strongest = [...hits].sort((a, b) => b.score - a.score)[0];
  return {
    status: "ok",
    score,
    categories: [...new Set(hits.map((hit) => hit.category))],
    summary:
      hits.length === 1
        ? hits[0].label
        : `${hits.length} structural red flags, strongest: ${strongest.label}`,
    details: { hits },
  };
}

/** Offline URL structure check. Low weight: it is evidence about shape, not
 *  about reputation, and it must not be able to carry a verdict alone. */
export const urlHeuristicsSource: TiSource = {
  meta: {
    id: "url-heuristics",
    name: "URL structure",
    url: "https://github.com/algorithm368/project-ophanim",
    category: "context",
    requiresKey: false,
    weight: 0.3,
  },
  isEnabled: () => true,
  async check(url): Promise<SourceFinding> {
    const parsed = parseUrl(url);
    if (!parsed) return { status: "error", error: "Unparseable URL" };
    return heuristicsFinding(parsed);
  },
};
