import type { SourceFinding, TiSource } from "../types";
import { errorMessage, getJson, isTimeout } from "../http";

interface CensysLabel {
  value?: string;
}

interface CensysService {
  port?: number;
  protocol?: string;
  transport_protocol?: string;
  labels?: CensysLabel[];
}

/** Censys error envelope, e.g. `{ code, status, reason, message }` on a 401. */
interface CensysError {
  code?: number;
  status?: string;
  reason?: string;
  message?: string;
}

interface CensysResponse {
  error?: string | CensysError;
  detail?: string;
  /** Platform error envelope: `{ title, status, detail, errors: [{ message }] }`. */
  title?: string;
  errors?: { message?: string }[];
  result?: {
    resource?: {
      ip?: string;
      service_count?: number;
      services?: CensysService[];
      labels?: CensysLabel[];
      location?: { country?: string; city?: string };
      autonomous_system?: { asn?: number; name?: string };
    };
  };
}

/**
 * Pull the most specific human-readable reason from a Censys error body.
 * The Platform API puts the useful text in `errors[].message` (e.g.
 * "insufficient balance" on a 422), while `detail`/`title` are generic.
 */
export function censysErrorMessage(
  data: CensysResponse | null,
  status: number,
): string {
  const err = data?.error;
  const fromError =
    typeof err === "string" ? err : (err?.message ?? err?.reason);
  return (
    fromError ??
    data?.errors?.map((e) => e?.message).find(Boolean) ??
    data?.detail ??
    data?.title ??
    `HTTP ${status}`
  );
}

/**
 * True when a Censys error signals a spent credit balance / quota rather than
 * a genuine failure. The Platform API charges credits per lookup and returns
 * 429, or a 422 whose message is "insufficient balance", once they run out.
 */
export function isCensysQuota(message: string, status: number): boolean {
  return (
    status === 429 || /insufficient balance|limit|quota|too many/i.test(message)
  );
}

const RISKY_LABELS = new Set([
  "remote_access",
  "database",
  "iot",
  "open_dir",
  "open_directory",
  "login_page",
  "tarpit",
  "honeypot",
]);

/** Censys Platform: host scan data: open services, ASN, location (Personal Access Token). */
export const censysSource: TiSource = {
  meta: {
    id: "censys",
    name: "Censys",
    url: "https://platform.censys.io",
    category: "scanner",
    requiresKey: true,
    weight: 0.5,
    keyEnv: "CENSYS_API_SECRET",
  },
  isEnabled: () => Boolean(process.env.CENSYS_API_SECRET),
  async check(ip, signal): Promise<SourceFinding> {
    const token = process.env.CENSYS_API_SECRET;
    if (!token) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<CensysResponse>(
        `https://api.platform.censys.io/v3/global/asset/host/${ip}`,
        signal,
        { Authorization: `Bearer ${token}` },
      );

      if (status === 404) {
        return { status: "ok", score: 0, summary: "Host not found in Censys" };
      }
      if (!ok || !data?.result?.resource) {
        const message = censysErrorMessage(data, status);
        // A spent credit balance is a quota state, not a red error card.
        if (isCensysQuota(message, status)) {
          return { status: "rate_limited", summary: message };
        }
        return { status: "error", error: message };
      }

      const r = data.result.resource;
      const services = r.services ?? [];
      const ports = services.map((s) => s.port).filter(Boolean) as number[];
      const labels = Array.from(
        new Set(
          [
            ...(r.labels ?? []),
            ...services.flatMap((s) => s.labels ?? []),
          ]
            .map((l) => l.value)
            .filter((v): v is string => Boolean(v)),
        ),
      );
      const risky = labels.filter((l) => RISKY_LABELS.has(l.toLowerCase()));

      let score = 0;
      if (services.length) score += Math.min(30, services.length * 3);
      if (risky.length) score += 25;
      score = Math.min(100, score);

      return {
        status: "ok",
        score,
        categories: labels.slice(0, 12),
        summary: services.length
          ? `${services.length} exposed service(s)${
              risky.length ? ` · ${risky.join(", ")}` : ""
            }`
          : "No exposed services",
        details: {
          ports,
          services: services
            .map((s) => (s.port ? `${s.port}/${s.protocol ?? "?"}` : null))
            .filter(Boolean),
          labels,
          asn: r.autonomous_system?.asn,
          asName: r.autonomous_system?.name,
          country: r.location?.country,
          city: r.location?.city,
        },
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
