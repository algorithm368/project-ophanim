import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceMeta, SourceResult } from "../types";
import type { BulkRow, RowSummary } from "./types";

const runAll = vi.fn();
const runSource = vi.fn();
vi.mock("../orchestrate", () => ({ runAll: (...a: unknown[]) => runAll(...a), runSource: (...a: unknown[]) => runSource(...a) }));
const reserveBulk = vi.fn();
const markExhausted = vi.fn();
vi.mock("./quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./quota")>()),
  reserveBulk: (...a: unknown[]) => reserveBulk(...a),
  markExhausted: (...a: unknown[]) => markExhausted(...a),
}));
const readSharedFull = vi.fn();
const readBulkRow = vi.fn();
const writeBulkRow = vi.fn();
vi.mock("./row-cache", () => ({
  readSharedFull: (...a: unknown[]) => readSharedFull(...a),
  readBulkRow: (...a: unknown[]) => readBulkRow(...a),
  writeBulkRow: (...a: unknown[]) => writeBulkRow(...a),
}));

const e = await import("./engine");
const NOW = new Date("2026-10-07T10:00:30Z");

function res(id: string, weight: number, extra: Partial<SourceResult> = {}): SourceResult {
  const meta: SourceMeta = { id, name: id, url: "", category: "blocklist", requiresKey: false, weight };
  return { source: meta, enabled: true, durationMs: 1, status: "ok", ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  readSharedFull.mockResolvedValue(null);
  readBulkRow.mockResolvedValue(null);
  delete process.env.VIRUSTOTAL_API_KEY_BULK;
});

describe("newRow", () => {
  it("starts internal items finished, never to be looked up", () => {
    expect(e.newRow(1, { indicator: "fs01", kind: "domain", internal: true })).toMatchObject({ state: "internal", note: "Internal name, not sent to any source" });
    expect(e.newRow(2, { indicator: "a.com", kind: "domain", display: "á.com", note: "n" })).toMatchObject({ state: "pending", display: "á.com", note: "n" });
  });
});

describe("runPass1", () => {
  it("never looks up an internal row", async () => {
    const row = e.newRow(0, { indicator: "fs01", kind: "domain", internal: true });
    expect(await e.runPass1(row, NOW)).toBe(row);
    expect(readSharedFull).not.toHaveBeenCalled();
    expect(runAll).not.toHaveBeenCalled();
  });

  it("finishes from a fresh /check result without running anything", async () => {
    readSharedFull.mockResolvedValue({ results: [res("feodo", 1, { score: 100, malicious: true })], riskScore: 90, verdict: "malicious", checkedAt: NOW.toISOString() });
    const row = await e.runPass1(e.newRow(0, { indicator: "1.2.3.4", kind: "ip" }), NOW);
    expect(row).toMatchObject({ state: "cached", verdict: "malicious", pending: [] });
    expect(runAll).not.toHaveBeenCalled();
  });

  it("reuses a cached bulk row under the new id, keeping the parse note", async () => {
    readBulkRow.mockResolvedValue({ ...e.newRow(9, { indicator: "1.2.3.4", kind: "ip" }), state: "full", verdict: "clean" });
    const row = await e.runPass1(e.newRow(3, { indicator: "1.2.3.4", kind: "ip", note: "Read as" }), NOW);
    expect(row).toMatchObject({ id: 3, state: "full", note: "Read as" });
  });

  it("keeps the cached row's note when the new item has none", async () => {
    readBulkRow.mockResolvedValue({ ...e.newRow(9, { indicator: "1.2.3.4", kind: "ip", note: "Old" }), state: "full" });
    expect(await e.runPass1(e.newRow(3, { indicator: "1.2.3.4", kind: "ip" }), NOW)).toMatchObject({ id: 3, note: "Old" });
  });

  it("drops sources bulk no longer asks from a cached row's queue", async () => {
    const old = { ...e.newRow(9, { indicator: "1.2.3.4", kind: "ip" as const }), state: "pass1" as const, bucket: "C" as const };
    readBulkRow.mockResolvedValue({ ...old, pending: ["greynoise", "otx", "virustotal"] });
    expect(await e.runPass1(e.newRow(3, { indicator: "1.2.3.4", kind: "ip" }), NOW)).toMatchObject({ state: "pass1", pending: ["otx"] });
    readBulkRow.mockResolvedValue({ ...old, pending: ["virustotal"] });
    expect(await e.runPass1(e.newRow(3, { indicator: "1.2.3.4", kind: "ip" }), NOW)).toMatchObject({ state: "full", pending: [] });
    readBulkRow.mockResolvedValue({ ...old, pending: ["abuseipdb"] });
    expect(await e.runPass1(e.newRow(3, { indicator: "1.2.3.4", kind: "ip" }), NOW)).toMatchObject({ state: "pass1", pending: ["abuseipdb"] });
    readBulkRow.mockResolvedValue({ ...old, bucket: undefined, pending: ["virustotal"] });
    expect(await e.runPass1(e.newRow(3, { indicator: "1.2.3.4", kind: "ip" }), NOW)).toMatchObject({ pending: ["virustotal"] });
  });

  it("queues a quiet IP for the metered sources bulk asks", async () => {
    runAll.mockResolvedValue([res("dnsbl", 0.5, { score: 0 })]);
    const row = await e.runPass1(e.newRow(0, { indicator: "1.2.3.4", kind: "ip" }), NOW);
    expect(row).toMatchObject({ state: "pass1", bucket: "C", pending: ["abuseipdb", "otx"] });
    expect(writeBulkRow).toHaveBeenCalledWith(row);
  });

  it("asks only family-capable sources for an IPv6", async () => {
    runAll.mockResolvedValue([]);
    await e.runPass1(e.newRow(0, { indicator: "2001:4860:4860::8888", kind: "ip" }), NOW);
    expect(runAll.mock.calls[0][0].map((s: { meta: SourceMeta }) => s.meta.id)).not.toContain("ipsum");
  });

  it("finishes a vouched domain at pass 1 with a note", async () => {
    runAll.mockResolvedValue([res("tranco", 0, { allowlisted: true })]);
    const row = await e.runPass1(e.newRow(0, { indicator: "google.com", kind: "domain" }), NOW);
    expect(row).toMatchObject({ state: "full", bucket: "D", pending: [], note: "Not escalated, vouched by tranco" });
  });
});

describe("escalationQueue and estimate", () => {
  const mk = (id: number, bucket: "A" | "B" | "C", kind: "ip" | "domain" = "ip"): RowSummary => ({
    id, indicator: `x${id}`, kind, state: "pass1", bucket, missing: [],
    pending: kind === "ip" ? ["virustotal", "abuseipdb"] : ["safebrowsing", "virustotal"],
  });

  it("orders B, then C, then A, stable by id, and skips finished rows", () => {
    const rows = [mk(0, "A"), mk(1, "C"), mk(2, "B"), mk(3, "C"), { ...mk(4, "B"), state: "full" as const }];
    expect(e.escalationQueue(rows).map((r) => r.id)).toEqual([2, 1, 3, 0]);
  });

  it("ranks a row with no bucket last", () => {
    const none = (id: number): RowSummary => ({ ...mk(id, "A"), bucket: undefined });
    expect(e.escalationQueue([none(0), mk(1, "A"), none(2)]).map((r) => r.id)).toEqual([1, 0, 2]);
  });

  it("totals an estimate with an empty entry", () => {
    expect(e.estimateTotal({ virustotal: 2, otx: undefined })).toBe(2);
  });

  it("counts pending calls per source", () => {
    const est = e.estimate([mk(0, "B"), mk(1, "C", "domain")]);
    expect(est).toEqual({ virustotal: 2, abuseipdb: 1, safebrowsing: 1 });
    expect(e.estimateTotal(est)).toBe(4);
  });
});

describe("runPass2", () => {
  const start = (): BulkRow => ({
    ...e.newRow(0, { indicator: "1.2.3.4", kind: "ip" }),
    state: "pass1", bucket: "C", results: [res("dnsbl", 0.5, { score: 0 })], pending: ["abuseipdb", "virustotal"],
  });
  const echo = async (s: { meta: SourceMeta }) => res(s.meta.id, 1, { score: 0 });

  it("runs every pending source, by key env, and ends full", async () => {
    reserveBulk.mockResolvedValue("ok");
    runSource.mockImplementation(echo);
    const { row, waitMs } = await e.runPass2(start(), NOW);
    expect(reserveBulk.mock.calls.map((c) => c[0])).toEqual(["ABUSEIPDB_API_KEY", "VIRUSTOTAL_API_KEY"]);
    expect(waitMs).toBeUndefined();
    expect(row).toMatchObject({ state: "full", pending: [], missing: [] });
  });

  it("pauses at the minute cap, saving progress to the row cache", async () => {
    reserveBulk.mockResolvedValueOnce("ok").mockResolvedValueOnce("minute");
    runSource.mockImplementation(echo);
    const { row, waitMs } = await e.runPass2(start(), NOW);
    expect(waitMs).toBe(30_000);
    expect(row).toMatchObject({ state: "pass1", pending: ["virustotal"] });
    expect(writeBulkRow).toHaveBeenCalledWith(row);
  });

  it("names why each wanted source is missing", async () => {
    reserveBulk.mockResolvedValueOnce("spent").mockResolvedValueOnce("unavailable");
    const { row } = await e.runPass2(start(), NOW);
    expect(row).toMatchObject({ state: "partial", missing: ["abuseipdb", "virustotal"] });
    expect(row.results.slice(-2).map((r) => r.summary)).toEqual(["Bulk quota reached", "No quota ledger, Redis not configured"]);
  });

  it("says when it is the bulk key that is spent, and when there is no key", async () => {
    process.env.VIRUSTOTAL_API_KEY_BULK = "own";
    reserveBulk.mockResolvedValueOnce("nokey").mockResolvedValueOnce("spent");
    const { row } = await e.runPass2(start(), NOW);
    expect(row.results.slice(-2).map((r) => r.summary)).toEqual(["No API key", "Bulk key quota reached"]);
  });

  it("marks a provider quota hit exhausted in the bulk lane, and missing", async () => {
    reserveBulk.mockResolvedValue("ok");
    runSource.mockResolvedValueOnce(res("abuseipdb", 1, { status: "error", error: "HTTP 429" })).mockResolvedValueOnce(res("virustotal", 1, { score: 0 }));
    const { row } = await e.runPass2(start(), NOW);
    expect(markExhausted).toHaveBeenCalledWith("ABUSEIPDB_API_KEY", "bulk", NOW);
    expect(row).toMatchObject({ state: "partial", missing: ["abuseipdb"] });
  });

  it("reports a source the kind has no adapter for as missing, without reserving", async () => {
    const row: BulkRow = { ...e.newRow(0, { indicator: "a.com", kind: "domain" }), state: "pass1", bucket: "C", pending: ["greynoise"] };
    const done = (await e.runPass2(row, NOW)).row;
    expect(reserveBulk).not.toHaveBeenCalled();
    expect(done).toMatchObject({ state: "partial", missing: ["greynoise"] });
    expect(done.results[0]).toMatchObject({ status: "skipped", summary: "No API key", source: { id: "greynoise", weight: 0 } });
  });

  it("re-scores on the merged results", async () => {
    reserveBulk.mockResolvedValue("ok");
    runSource.mockImplementation(async (s: { meta: SourceMeta }) => res(s.meta.id, 1, { score: 100, malicious: true }));
    expect((await e.runPass2(start(), NOW)).row.verdict).toBe("malicious");
  });
});
