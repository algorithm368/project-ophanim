import { describe, expect, it } from "vitest";
import { invalidCsv, toCsv, toJson } from "./export";
import type { RowSummary } from "./types";

const rows: RowSummary[] = [
  { id: 0, indicator: "1.2.3.4", kind: "ip", state: "partial", bucket: "C", verdict: "clean", riskScore: 3, pending: [], missing: ["virustotal", "abuseipdb"], checkedAt: "2026-10-07T01:00:00Z" },
  { id: 1, indicator: "xn--y3ctai2b.com", display: "หีหอม.com", kind: "domain", state: "feed-only", pending: [], missing: [], note: "Not in feeds, unchecked" },
  { id: 2, indicator: "-evil.com", kind: "domain", state: "internal", pending: [], missing: [], note: "Internal name, not sent to any source" },
];

describe("export", () => {
  it("writes a CSV with depth, display and note, and defuses formula cells", () => {
    const lines = toCsv(rows).trim().split("\n");
    expect(lines[0]).toBe("indicator,display,kind,verdict,risk_score,depth,state,bucket,missing,note,checked_at");
    expect(lines[1]).toBe("1.2.3.4,,ip,clean,3,free,partial,C,virustotal;abuseipdb,,2026-10-07T01:00:00Z");
    expect(lines[2]).toBe("xn--y3ctai2b.com,หีหอม.com,domain,,,feed,feed-only,,,\"Not in feeds, unchecked\",");
    expect(lines[3].startsWith("'-evil.com,")).toBe(true);
  });

  it("writes JSON rows with depth and without results", () => {
    expect(JSON.parse(toJson(rows))[0]).toEqual({
      indicator: "1.2.3.4", kind: "ip", verdict: "clean", riskScore: 3, depth: "free", state: "partial", bucket: "C", missing: ["virustotal", "abuseipdb"], checkedAt: "2026-10-07T01:00:00Z",
    });
  });

  it("writes the invalid list", () => {
    expect(invalidCsv([{ input: "=x", reason: "Not an IP or domain" }])).toBe("input,reason\n'=x,Not an IP or domain\n");
  });
});
