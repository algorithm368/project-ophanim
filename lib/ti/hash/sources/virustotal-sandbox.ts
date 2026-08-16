import type { HashContext, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

/**
 * VirusTotal v3 file *behaviour summary* — the aggregated sandbox detonation
 * report (`GET /files/{id}/behaviour_summary`). This is a SECOND VT request on
 * top of the main `virustotal` source's one file GET; it lives in its own
 * context-only adapter (weight 0) so a behaviour 404 / rate-limit can fail
 * without touching the detection result, and so the main source stays at one
 * request under the free key's 500/day, 4/min budget. Verified to return 200 on
 * the free/public key (2026-07-19).
 *
 * It contributes only `hashContext`: readable actions + ATT&CK into the fields
 * the File identity card already renders, plus a grouped runtime readout
 * (`sandboxBehavior`) of what the sample actually did when detonated.
 */

interface VtSignatureMatch {
  id?: string;
  name?: string;
  description?: string;
}
interface VtMitreTechnique {
  id?: string;
  severity?: string;
  signature_description?: string;
  refs?: { ref?: string; value?: string }[];
}
interface VtFileDropped {
  path?: string;
}
interface VtRegistryKey {
  key?: string;
  value?: string;
}
interface VtDnsLookup {
  hostname?: string;
}
interface VtIpTraffic {
  destination_ip?: string;
  destination_port?: number;
}
export interface VtBehaviourSummary {
  data?: {
    tags?: string[];
    signature_matches?: VtSignatureMatch[];
    mitre_attack_techniques?: VtMitreTechnique[];
    command_executions?: string[];
    processes_created?: string[];
    files_dropped?: VtFileDropped[];
    files_written?: string[];
    registry_keys_set?: VtRegistryKey[];
    dns_lookups?: VtDnsLookup[];
    ip_traffic?: VtIpTraffic[];
    memory_pattern_urls?: string[];
  };
  error?: { message?: string; code?: string };
}

/** Per-group cap for the runtime readout — VT returns hundreds; keep it legible. */
const GROUP_CAP = 8;
/** How many ATT&CK techniques to surface after severity ranking. */
const MITRE_CAP = 12;

/**
 * A string made up only of VT template tokens (`%SAMPLEPATH%`, `<CURRENT_DIR>`,
 * `<HKLM>`, ...) and separators — no concrete evidence, so it is dropped. A token
 * with real content around it (`%TEMP%\taskdl.exe`) is kept.
 */
export function isPlaceholder(s: string): boolean {
  return /^([%<][^%<>]*[%>][\\/ ]*)+$/.test(s.trim());
}

/**
 * Distinct, evidence-bearing strings: trimmed, placeholder-only dropped, deduped,
 * capped. Preserves VT's own ordering (roughly relevance / first-seen).
 */
function distinct(values: (string | undefined | null)[], cap = GROUP_CAP): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s || seen.has(s) || isPlaceholder(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Registry key → normalized, key only (the value is dropped: it overflows the
 * card and the persistence/config signal is in the key). Hive placeholders and
 * long `HKEY_*` names collapse to short forms for consistency.
 */
export function normalizeRegKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const hives: [RegExp, string][] = [
    [/^<?HKEY_LOCAL_MACHINE>?/i, "HKLM"],
    [/^<?HKLM>?/i, "HKLM"],
    [/^<?HKEY_CURRENT_USER>?/i, "HKCU"],
    [/^<?HKCU>?/i, "HKCU"],
    [/^<?HKEY_USERS>?/i, "HKU"],
    [/^<?HKEY_CLASSES_ROOT>?/i, "HKCR"],
  ];
  let k = key.trim();
  for (const [re, rep] of hives) {
    if (re.test(k)) {
      k = k.replace(re, rep);
      break;
    }
  }
  return k || undefined;
}

/**
 * Ubiquitous benign keys nearly every process touches (the shell-folder path
 * lookups). They add rows without evidence, so they are dropped from the readout.
 */
export function isBenignRegKey(key: string): boolean {
  return /\\(User )?Shell Folders\\/i.test(key);
}

/**
 * OS / CDN / dev-library domains that sandboxes hit as background noise, not
 * the sample's own C2 or distribution. A host matches when it equals one of
 * these or is a subdomain of one.
 *
 * This was a single 35-branch alternation with nested optional groups, which
 * Sonar scored at complexity 54 against a limit of 20 (typescript:S5843). The
 * groups are expanded here: `microsoft(\.com)?` was two domains, and
 * `(global)?g?cdn\.co` was four. A set of plain strings is also the thing you
 * can actually add an entry to without re-reading the whole pattern.
 */
const BENIGN_NET_DOMAINS = new Set([
  // Microsoft / Windows telemetry and update endpoints.
  "microsoft", "microsoft.com", "windows.com", "windowsupdate.com",
  "msftconnecttest.com", "msftncsi.com", "msn.com", "bing.com", "office.com",
  "live.com", "azureedge.net", "azure.com",
  // Google.
  "google", "google.com", "gstatic.com", "googleapis.com", "gvt1.com",
  // Developer ecosystem.
  "github.com", "githubusercontent.com", "python.org", "pythonhosted.org",
  "stackoverflow.com", "mozilla.org",
  // Certificate authorities and revocation checking.
  "digicert.com", "sectigo.com", "letsencrypt.org", "lencr.org",
  "verisign.com",
  // CDNs and resolvers.
  "cloudflare.com", "cloudflare-dns.com", "fastly.net", "akamai.net",
  "akamaiedge.net", "akamaitechnologies.net", "akadns.net", "akahost.net",
  "edgekey.net", "edgesuite.net", "cloudfront.net", "amazonaws.com",
  "cdn.co", "gcdn.co", "globalcdn.co", "globalgcdn.co",
  // Infrastructure zones.
  "in-addr.arpa", "root-servers.net",
]);

/** True when `host` is one of BENIGN_NET_DOMAINS or sits underneath one. Walks
 *  the parent domains rather than testing a regex, so cost is one set lookup
 *  per label. */
function isBenignDomain(host: string): boolean {
  let rest = host;
  for (;;) {
    if (BENIGN_NET_DOMAINS.has(rest)) return true;
    const dot = rest.indexOf(".");
    if (dot === -1) return false;
    rest = rest.slice(dot + 1);
  }
}

export function isBenignNetHost(urlOrHost: string | undefined): boolean {
  if (!urlOrHost) return false;
  const host = urlOrHost
    .replace(/^[a-z]+:\/\//i, "")
    .split(/[/:?#]/)[0]
    .toLowerCase();
  return isBenignDomain(host);
}

/** VT severity string → rank (higher = more severe) for ordering techniques. */
export function severityRank(severity: string | undefined): number {
  switch (severity) {
    case "IMPACT_SEVERITY_CRITICAL":
      return 5;
    case "IMPACT_SEVERITY_HIGH":
      return 4;
    case "IMPACT_SEVERITY_MEDIUM":
      return 3;
    case "IMPACT_SEVERITY_LOW":
      return 2;
    case "IMPACT_SEVERITY_INFO":
      return 1;
    default:
      return 0;
  }
}

/**
 * Readable sandbox actions (CAPA `signature_matches`) → capabilities, each tagged
 * with the ATT&CK technique that cites it. A match's technique is recovered from
 * `mitre_attack_techniques[].refs` (`{ ref: "#signature_matches", value: "<idx>" }`).
 */
/** Signature index → the technique ids citing it, from
 *  `mitre_attack_techniques[].refs` (`{ ref: "#signature_matches", value }`). */
function techniquesBySignature(
  b: VtBehaviourSummary["data"],
): Map<string, string[]> {
  const bySig = new Map<string, string[]>();
  for (const t of b?.mitre_attack_techniques ?? []) {
    if (!t.id) continue;
    for (const r of t.refs ?? []) {
      if (r.ref !== "#signature_matches" || r.value === undefined) continue;
      const ids = bySig.get(r.value) ?? [];
      if (!ids.includes(t.id)) ids.push(t.id);
      bySig.set(r.value, ids);
    }
  }
  return bySig;
}

export function sandboxCapabilities(
  b: VtBehaviourSummary["data"],
  cap = MITRE_CAP,
): { label: string; mitre?: string[] }[] {
  const matches = b?.signature_matches ?? [];
  if (matches.length === 0) return [];

  const techBySig = techniquesBySignature(b);
  const seen = new Set<string>();
  const out: { label: string; mitre?: string[] }[] = [];
  for (const m of matches) {
    const label = m.name?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const mitre = m.id !== undefined ? techBySig.get(m.id) : undefined;
    out.push(mitre?.length ? { label, mitre } : { label });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * `mitre_attack_techniques` → deduped techniques ranked by severity, capped.
 * `name` uses the sandbox `signature_description` (VT gives no official ATT&CK
 * technique name here); id is the T-number the card renders.
 */
export function sandboxMitre(
  b: VtBehaviourSummary["data"],
  cap = MITRE_CAP,
): { id: string; name?: string }[] {
  const techs = (b?.mitre_attack_techniques ?? []).filter(
    (t): t is VtMitreTechnique & { id: string } => Boolean(t.id),
  );
  const byId = new Map<string, VtMitreTechnique & { id: string }>();
  for (const t of techs) {
    const prev = byId.get(t.id);
    if (!prev || severityRank(t.severity) > severityRank(prev.severity)) {
      byId.set(t.id, t);
    }
  }
  return [...byId.values()]
    .sort((a, b2) => severityRank(b2.severity) - severityRank(a.severity))
    .slice(0, cap)
    .map((t) => ({
      id: t.id,
      name: t.signature_description?.trim() || undefined,
    }));
}

/** Grouped runtime readout (processes/commands, files, registry, network). */
export function sandboxRuntime(
  b: VtBehaviourSummary["data"],
): HashContext["sandboxBehavior"] | undefined {
  if (!b) return undefined;
  const commands = distinct([
    ...(b.command_executions ?? []),
    ...(b.processes_created ?? []),
  ]);
  const files = distinct([
    ...(b.files_dropped ?? []).map((f) => f.path),
    ...(b.files_written ?? []),
  ]);
  const registry = distinct(
    (b.registry_keys_set ?? []).map((r) => {
      const k = normalizeRegKey(r.key);
      return k && !isBenignRegKey(k) ? k : undefined;
    }),
  );
  // Balance the network readout across kinds (few of each) so pivotable
  // domains/IPs always get slots instead of being crowded out by URLs, and drop
  // benign OS/CDN/library hosts (github, python.org, microsoft, ...) that are
  // sandbox noise, not the sample's own traffic. Contacted infra also appears on
  // the Connections card; this stays small and complementary.
  const dns = distinct(
    (b.dns_lookups ?? [])
      .map((d) => d.hostname)
      .filter((h) => h && !isBenignNetHost(h)),
    3,
  ).map((h) => `dns ${h}`);
  const ips = distinct(
    (b.ip_traffic ?? []).map((t) => {
      if (!t.destination_ip) return undefined;
      const port = t.destination_port ? `:${t.destination_port}` : "";
      return `${t.destination_ip}${port}`;
    }),
    3,
  ).map((x) => `ip ${x}`);
  const urls = distinct(
    (b.memory_pattern_urls ?? []).filter((u) => u && !isBenignNetHost(u)),
    3,
  ).map((u) => `url ${u}`);
  const network = [...urls, ...ips, ...dns];

  if (!commands.length && !files.length && !registry.length && !network.length) {
    return undefined;
  }
  return {
    commands: commands.length ? commands : undefined,
    files: files.length ? files : undefined,
    registry: registry.length ? registry : undefined,
    network: network.length ? network : undefined,
  };
}

export const virusTotalSandboxSource: TiSource = {
  meta: {
    id: "virustotal-sandbox",
    name: "VirusTotal Sandbox",
    url: "https://www.virustotal.com",
    category: "context",
    requiresKey: true,
    weight: 0,
    keyEnv: "VIRUSTOTAL_API_KEY",
  },
  isEnabled: () => Boolean(process.env.VIRUSTOTAL_API_KEY),
  async check(hash, signal): Promise<SourceFinding> {
    const key = process.env.VIRUSTOTAL_API_KEY;
    if (!key) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<VtBehaviourSummary>(
        `https://www.virustotal.com/api/v3/files/${hash}/behaviour_summary`,
        signal,
        { "x-apikey": key },
      );

      // 404 = VT has the file but no sandbox report. Not an error, just no data.
      if (status === 404) {
        return { status: "ok", summary: "No sandbox behaviour report" };
      }
      if (!ok) {
        return {
          status: "error",
          error: data?.error?.message ?? `HTTP ${status}`,
        };
      }
      // A 2xx with no usable payload (common for archives/scripts) is also just
      // "no report", not an error.
      const b = data?.data;
      if (!b) {
        return { status: "ok", summary: "No sandbox behaviour report" };
      }
      const capabilities = sandboxCapabilities(b);
      const mitreTechniques = sandboxMitre(b);
      const runtime = sandboxRuntime(b);
      // Real (pre-cap) totals for the source summary, so it reflects the sample
      // instead of always printing the display cap.
      const totalBehaviours = new Set(
        (b.signature_matches ?? [])
          .map((m) => m.name?.trim().toLowerCase())
          .filter(Boolean),
      ).size;
      const totalTechniques = new Set(
        (b.mitre_attack_techniques ?? []).map((t) => t.id).filter(Boolean),
      ).size;
      // High-level behaviour tags (PERSISTENCE, CRYPTO, SELF_DELETE, ...) — a
      // one-glance summary of what the sample does, in VT's own vocabulary.
      const behaviorTags = distinct(b.tags ?? [], 16);

      const hashContext: HashContext = {
        capabilities: capabilities.length ? capabilities : undefined,
        mitreTechniques: mitreTechniques.length ? mitreTechniques : undefined,
        sandboxBehavior: runtime,
        behaviorTags: behaviorTags.length ? behaviorTags : undefined,
      };

      const groupCount = runtime
        ? [runtime.commands, runtime.files, runtime.registry, runtime.network].filter(
            Boolean,
          ).length
        : 0;

      return {
        status: "ok",
        summary:
          capabilities.length || groupCount
            ? `Sandbox: ${totalBehaviours} behaviours, ${totalTechniques} techniques`
            : "No sandbox behaviour report",
        hashContext,
        raw: data,
      };
    } catch (err) {
      return {
        status: isTimeout(err) ? "timeout" : "error",
        error: errorMessage(err),
      };
    }
  },
};
