import * as tls from "node:tls";
import type { SourceFinding, TiSource } from "../../types";
import { errorMessage, isTimeout } from "../../http";
import { RESOLVERS, answers, dohQuery } from "../../dns/doh";

const CF = RESOLVERS.cloudflare;
const CONNECT_TIMEOUT_MS = 6000;

/** True when `pattern` (a cert CN or SAN entry, possibly a `*.` wildcard)
 *  covers `host`. A wildcard covers exactly one label, matching the browser
 *  rule rather than a loose suffix check (`*.example.com` must not cover
 *  `a.b.example.com`). */
export function certNameCovers(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase();
  const h = host.toLowerCase();
  if (!p.startsWith("*.")) return p === h;
  const rest = h.split(".").slice(1).join(".");
  const firstLabel = h.split(".")[0];
  return Boolean(firstLabel) && rest === p.slice(2);
}

/** SAN + CN entries from a peer certificate, deduped. `subjectaltname` comes
 *  back as `"DNS:a.com, DNS:b.com, IP Address:1.2.3.4"`; only DNS entries
 *  name a hostname. */
// Node types a Subject/Issuer field as string | string[] since it can in
// theory repeat; every cert seen in practice has exactly one, so the first
// suffices.
function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function certNames(cert: tls.PeerCertificate): string[] {
  const names = new Set<string>();
  const cn = firstOf(cert.subject?.CN);
  if (cn) names.add(cn);
  for (const part of cert.subjectaltname?.split(",") ?? []) {
    const m = /^\s*DNS:(.+)$/.exec(part);
    if (m) names.add(m[1].trim());
  }
  return [...names];
}

export interface CertProbe {
  matches: boolean;
  authorized: boolean;
  names: string[];
  issuer?: string;
  validTo?: string;
}

/** Open a raw TLS connection to `ip` with SNI set to `domain`, and read back
 *  whatever certificate the server presents — `rejectUnauthorized: false` so
 *  an untrusted/self-signed/wrong-host cert is inspected rather than thrown
 *  away, since "what does this IP claim to be" is the finding itself, not an
 *  error case. `authorized` still reports Node's own chain-of-trust verdict
 *  as a separate signal from the hostname check. */
export function probeCertificate(
  ip: string,
  domain: string,
  signal: AbortSignal,
): Promise<CertProbe> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: ip,
      port: 443,
      servername: domain,
      rejectUnauthorized: false,
      timeout: CONNECT_TIMEOUT_MS,
    });

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      socket.removeAllListeners();
    };
    const onAbort = () => {
      cleanup();
      socket.destroy();
      reject(new DOMException("The operation was aborted.", "TimeoutError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const names = certNames(cert);
      cleanup();
      socket.end();
      resolve({
        matches: names.some((n) => certNameCovers(n, domain)),
        authorized: socket.authorized,
        names,
        issuer: firstOf(cert.issuer?.CN),
        validTo: cert.valid_to,
      });
    });
    socket.once("timeout", () => {
      cleanup();
      socket.destroy();
      reject(new DOMException("TLS connect timed out", "TimeoutError"));
    });
    socket.once("error", (err) => {
      cleanup();
      reject(err);
    });
  });
}

/** The first A record for `domain`, or undefined when it does not resolve.
 *  Deliberately a single lightweight lookup rather than the multi-resolver
 *  consensus dnsGeoSource runs: this source only needs *an* IP currently
 *  serving the name to probe, not a voted-on one. */
async function firstResolvedIp(domain: string, signal: AbortSignal): Promise<string | undefined> {
  const res = await dohQuery(CF, domain, "A", signal);
  return answers(res)[0];
}

/**
 * TLS Cert Match: connects to the domain's currently-resolved IP with the
 * domain as SNI and checks whether the certificate presented actually covers
 * it. This is independent of DNS consensus entirely — a DNS hijack that every
 * resolver agrees on (cache poisoning at a shared upstream, a compromised
 * registrar changing the real records) still fails this, because the
 * attacker's IP cannot present a certificate covering the domain. Weighted
 * modestly rather than treated as a hard listing: a mismatch also has benign
 * explanations (no HTTPS on this host, a misconfigured default vhost), so it
 * nudges the score rather than pinning "malicious" on its own.
 */
export const tlsCertSource: TiSource = {
  meta: {
    id: "tls-cert",
    name: "TLS Cert Match",
    url: "https://cloudflare-dns.com",
    category: "reputation",
    requiresKey: false,
    weight: 0.35,
    timeoutMs: CONNECT_TIMEOUT_MS + 2000,
  },
  isEnabled: () => true,
  async check(domain, signal): Promise<SourceFinding> {
    try {
      const ip = await firstResolvedIp(domain, signal);
      if (!ip) {
        return { status: "ok", summary: "No resolved IP to probe" };
      }

      let probe: CertProbe;
      try {
        probe = await probeCertificate(ip, domain, signal);
      } catch (err) {
        if (isTimeout(err)) throw err;
        // Connection refused, no TLS on 443, reset, etc: not a finding, this
        // host simply isn't serving HTTPS on the IP we resolved.
        return { status: "ok", summary: `No TLS service observed on ${ip}` };
      }

      if (probe.matches) {
        return {
          status: "ok",
          summary: probe.authorized
            ? `Certificate on ${ip} covers ${domain} and chains to a trusted root`
            : `Certificate on ${ip} covers ${domain} but does not chain to a trusted root`,
          details: { ip, names: probe.names, issuer: probe.issuer, validTo: probe.validTo },
        };
      }

      return {
        status: "ok",
        score: 55,
        summary: `Certificate on ${ip} does not cover ${domain} (covers ${probe.names.join(", ") || "no names"} instead)`,
        details: { ip, names: probe.names, issuer: probe.issuer, validTo: probe.validTo },
      };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
