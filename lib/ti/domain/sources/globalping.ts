import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout, postJson } from "../../http";
import { ipConsensus, type ResolverVote } from "../../dns/consensus";

const API = "https://api.globalping.io/v1/measurements";
const POLL_INTERVAL_MS = 500;
// Globalping's own guidance: allow the probe-side timeout (up to 30s) plus
// headroom for probe-to-API communication before giving up client-side.
const MEASUREMENT_TIMEOUT_MS = 20000;

// One probe per continent: broad geographic spread for a single "test" under
// the free, unauthenticated tier (250 measurements/hour, 50 probes/measurement
// — six probes costs nothing extra over one). A continent with no available
// probe just contributes fewer results, not an error.
const LOCATIONS = [
  { continent: "EU", limit: 1 },
  { continent: "NA", limit: 1 },
  { continent: "AS", limit: 1 },
  { continent: "SA", limit: 1 },
  { continent: "AF", limit: 1 },
  { continent: "OC", limit: 1 },
];

interface GlobalpingProbe {
  continent?: string;
  country?: string;
  city?: string;
}

interface GlobalpingAnswer {
  type?: string;
  value?: string;
}

interface GlobalpingResult {
  probe: GlobalpingProbe;
  result: {
    status: string;
    statusCodeName?: string;
    answers?: GlobalpingAnswer[];
  };
}

interface GlobalpingMeasurement {
  id: string;
  status: string;
  probesCount: number;
  results: GlobalpingResult[];
}

interface CreateMeasurementResponse {
  id: string;
  probesCount: number;
}

function probeLabel(probe: GlobalpingProbe): string {
  return [probe.city, probe.country].filter(Boolean).join(", ") || probe.continent || "unknown probe";
}

/** The resolved A-record IPs from one probe's DNS test, or null when the test
 *  itself failed (timeout, refused, etc.) — a non-vote, the same convention
 *  ipConsensus already uses for a resolver that never answered. NXDOMAIN and
 *  similar are answered-but-empty, not a non-vote: a probe unanimous on "this
 *  name doesn't resolve here" is still a real, countable agreement. */
function ipsFrom(result: GlobalpingResult["result"]): string[] | null {
  if (result.status !== "finished") return null;
  return (result.answers ?? [])
    .filter((a) => a.type === "A")
    .map((a) => a.value)
    .filter((v): v is string => Boolean(v));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("The operation was aborted.", "TimeoutError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Poll per Globalping's client guideline: wait 500ms *after* each response
 *  rather than on a fixed interval, since a large measurement's own request
 *  can itself take a few hundred ms. */
async function pollUntilDone(id: string, signal: AbortSignal): Promise<GlobalpingMeasurement> {
  const deadline = Date.now() + MEASUREMENT_TIMEOUT_MS;
  for (;;) {
    const { ok, status, data } = await getJson<GlobalpingMeasurement>(`${API}/${id}`, signal);
    if (!ok) throw new Error(`Globalping poll failed: HTTP ${status}`);
    if (data && data.status !== "in-progress") return data;
    if (Date.now() > deadline) {
      throw new DOMException("Globalping measurement did not finish in time", "TimeoutError");
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
}

/**
 * Globalping: resolves the domain's A record from real probes spread across
 * every continent, the one axis none of the other new sources cover — they
 * all vary *which resolver* answers, but ask from this one server's single
 * network location. A split here (one region seeing a materially different
 * IP/country than the rest) can be entirely benign GeoDNS/CDN routing, or it
 * can be regional split-horizon DNS, censorship, or a localized hijack — the
 * two are not distinguishable from this data alone, so this stays
 * context-only (weight 0) and reports the ballot for a human to read rather
 * than asserting which case it is.
 *
 * Reuses ipConsensus (lib/ti/dns/consensus.ts) treating each probe as a
 * "resolver," so the vote-counting logic is the same one already covering
 * the DNS-resolver pool, just fed by geography instead of resolver identity.
 */
export const globalpingSource: TiSource = {
  meta: {
    id: "globalping",
    name: "Globalping (multi-region DNS)",
    url: "https://globalping.io",
    category: "context",
    requiresKey: false,
    weight: 0,
    timeoutMs: MEASUREMENT_TIMEOUT_MS + 5000,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const created = await postJson<CreateMeasurementResponse>(API, signal, {
        type: "dns",
        target: domain,
        locations: LOCATIONS,
        measurementOptions: { query: { type: "A" } },
      });
      if (created.status === 429) {
        return { status: "rate_limited", error: "Globalping asked us to back off" };
      }
      if (!created.ok || !created.data?.id) {
        return { status: "error", error: `Globalping create failed: HTTP ${created.status}` };
      }

      const measurement = await pollUntilDone(created.data.id, signal);
      const votes: ResolverVote[] = measurement.results.map((r) => ({
        resolver: probeLabel(r.probe),
        ips: ipsFrom(r.result),
      }));
      const consensus = ipConsensus(votes);

      if (consensus.respondingResolvers === 0) {
        return {
          status: "ok",
          summary: "No Globalping probe returned a usable answer",
          details: { probes: votes },
        };
      }

      const summary =
        consensus.bucket === "high"
          ? `${consensus.respondingResolvers} of ${consensus.respondingResolvers} global probes agree on ${consensus.consensusIps.join(", ") || "no A record (NXDOMAIN/empty)"}`
          : `Global probes split on the resolved IP(s): ${consensus.agreeCount} of ${consensus.respondingResolvers} agree on ${consensus.consensusIps.join(", ") || "no A record"}`;

      return {
        status: "ok",
        summary,
        details: { consensus, probes: votes },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
