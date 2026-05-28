import { ImageResponse } from "next/og";
import { detectIOC } from "@/lib/ioc";
import { parseIPv4 } from "@/lib/ip";
import { parseDomain } from "@/lib/domain";
import { parseHash } from "@/lib/hash";
import {
  getCachedDomainResult,
  getCachedHashResult,
  getCachedResult,
} from "@/lib/ti/cache";
import type { Verdict } from "@/lib/ti/types";

export const runtime = "nodejs";
export const alt = "Project Ophanim threat-intel report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const VERDICT_META: Record<
  Verdict,
  { label: string; fg: string; bg: string }
> = {
  malicious: { label: "Malicious", fg: "#dc2626", bg: "rgba(220,38,38,0.12)" },
  suspicious: { label: "Suspicious", fg: "#ea580c", bg: "rgba(234,88,12,0.12)" },
  low: { label: "Low risk", fg: "#d97706", bg: "rgba(217,119,6,0.12)" },
  clean: { label: "Clean", fg: "#059669", bg: "rgba(5,150,105,0.12)" },
  unknown: { label: "Unknown", fg: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

const KIND_LABEL = {
  ip: "IP ADDRESS",
  domain: "DOMAIN",
  hash: "FILE HASH",
} as const;

async function lookup(value: string) {
  const kind = detectIOC(value);
  if (kind === "ip") {
    const p = parseIPv4(value);
    return { kind, result: p ? await getCachedResult(p.ip) : null };
  }
  if (kind === "domain") {
    const p = parseDomain(value);
    return { kind, result: p ? await getCachedDomainResult(p.domain) : null };
  }
  if (kind === "hash") {
    const p = parseHash(value);
    return { kind, result: p ? await getCachedHashResult(p.hash) : null };
  }
  return { kind: null, result: null };
}

export default async function Image({
  params,
}: {
  params: Promise<{ ioc: string }>;
}) {
  const { ioc } = await params;
  const value = decodeURIComponent(ioc);
  const { kind, result } = await lookup(value);
  const verdict = result?.verdict;
  const v = verdict ? VERDICT_META[verdict] : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          backgroundColor: "#FFFDF6",
          backgroundImage:
            "radial-gradient(rgba(73,73,73,0.10) 1.5px, transparent 1.5px)",
          backgroundSize: "32px 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#2b2b2b" />
            <path
              d="M4 16 C 9 8.5, 23 8.5, 28 16 C 23 23.5, 9 23.5, 4 16 Z"
              fill="none"
              stroke="#FFFDF6"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="16" r="5" fill="#f59e0b" />
            <circle cx="16" cy="16" r="1.9" fill="#2b2b2b" />
          </svg>
          <span style={{ fontSize: "40px", fontWeight: 700, color: "#353535" }}>
            Project Ophanim
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <span
            style={{ fontSize: "28px", letterSpacing: "2px", color: "#6b7280" }}
          >
            {kind ? KIND_LABEL[kind] : "INDICATOR"}
          </span>
          <span
            style={{
              fontSize: value.length > 44 ? "44px" : "64px",
              fontWeight: 700,
              color: "#353535",
              wordBreak: "break-all",
            }}
          >
            {value}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          {v ? (
            <>
              <span
                style={{
                  display: "flex",
                  fontSize: "34px",
                  fontWeight: 700,
                  color: v.fg,
                  backgroundColor: v.bg,
                  border: `3px solid ${v.fg}`,
                  borderRadius: "16px",
                  padding: "10px 28px",
                }}
              >
                {v.label}
              </span>
              <span style={{ fontSize: "34px", color: "#353535" }}>
                {result?.riskScore}/100 risk
              </span>
            </>
          ) : (
            <span style={{ fontSize: "32px", color: "#6b7280" }}>
              Threat-intelligence report across multiple sources
            </span>
          )}
        </div>
      </div>
    ),
    size,
  );
}
