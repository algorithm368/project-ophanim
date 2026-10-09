import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as d from "./run-dir";
import type { BulkRow } from "./types";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bulk-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const state = (): d.RunState => ({
  v: 1, id: "r1", createdAt: "2026-10-07T00:00:00Z", phase: "pass0", includeWeak: false, concurrency: 5, confirmed: false,
  invalid: [{ input: "10.0.0.1", reason: "Non-routable address, private" }], duplicates: 2,
});
const row = (id: number, over: Partial<BulkRow> = {}): BulkRow => ({ id, indicator: `1.1.1.${id}`, kind: "ip", state: "pending", results: [], pending: [], missing: [], ...over });

describe("run directory", () => {
  it("lives under ~/.ophanim/bulk by default and resolves an id or a path", () => {
    expect(d.defaultRoot()).toBe(join(homedir(), ".ophanim", "bulk"));
    expect(d.resolveRunDir("r1", root)).toBe(join(root, "r1"));
    expect(d.resolveRunDir("/abs/dir", root)).toBe("/abs/dir");
  });

  it("round-trips state, items and rows, the last row line winning", () => {
    const dir = join(root, "r1");
    d.initRunDir(dir, state(), [{ indicator: "1.1.1.0", kind: "ip" }, { indicator: "1.1.1.1", kind: "ip" }]);
    d.appendRows(dir, [row(0, { state: "pass1" }), row(1, { state: "feed-only" })]);
    d.appendRows(dir, [row(0, { state: "full" })]);
    d.saveState(dir, { ...state(), phase: "pass2" });
    const loaded = d.loadRunDir(dir);
    expect(loaded.state.phase).toBe("pass2");
    expect(loaded.items).toHaveLength(2);
    expect(loaded.rows.get(0)?.state).toBe("full");
    expect(loaded.rows.get(1)?.state).toBe("feed-only");
  });

  it("loads a run with no rows yet", () => {
    const dir = join(root, "r2");
    d.initRunDir(dir, state(), []);
    expect(d.loadRunDir(dir).rows.size).toBe(0);
  });

  it("calls a row a hit when listed or not quiet", () => {
    expect(d.isHit({ ...row(0), listedBy: ["ipsum"] })).toBe(true);
    expect(d.isHit({ ...row(0), verdict: "suspicious" })).toBe(true);
    expect(d.isHit({ ...row(0), verdict: "clean" })).toBe(false);
    expect(d.isHit({ ...row(0), verdict: "unknown", listedBy: [] })).toBe(false);
  });

  it("writes results, hits, invalid and a summary", () => {
    const dir = join(root, "r1");
    d.initRunDir(dir, state(), []);
    const text = d.writeOutputs(dir, [row(0, { state: "feed-only" }), row(1, { state: "full", verdict: "malicious", bucket: "A" })], state());
    expect(readFileSync(join(dir, "results.csv"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(readFileSync(join(dir, "hits.csv"), "utf8").trim().split("\n")).toHaveLength(2);
    expect(readFileSync(join(dir, "invalid.csv"), "utf8")).toContain("10.0.0.1");
    expect(text).toContain("2 indicators");
    expect(text).toContain("feed 1");
    expect(text).toContain("full 1");
    expect(text).toContain("malicious 1");
    expect(text).toContain("Non-routable address 1");
  });

  it("says none when nothing was invalid", () => {
    const dir = join(root, "r3");
    const clean = { ...state(), invalid: [] };
    d.initRunDir(dir, clean, []);
    expect(d.writeOutputs(dir, [], clean)).toContain("invalid: none");
  });
});
