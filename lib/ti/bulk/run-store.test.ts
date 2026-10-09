import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = new Map<string, unknown>();
const fake = {
  get: vi.fn(async (k: string) => kv.get(k) ?? null),
  set: vi.fn(async (k: string, v: unknown) => {
    kv.set(k, v);
    return "OK";
  }),
};
let redis: typeof fake | null = fake;
vi.mock("../cache", () => ({ getRedis: () => redis }));
const readBulkRowAny = vi.fn();
// engine.ts (imported via newRow) also reads from row-cache, so the mock
// names every export even though only readBulkRowAny is exercised here.
vi.mock("./row-cache", () => ({
  readBulkRowAny: (...a: unknown[]) => readBulkRowAny(...a),
  readBulkRow: vi.fn(),
  readSharedFull: vi.fn(),
  writeBulkRow: vi.fn(),
}));
const s = await import("./run-store");

const parsed = {
  items: [{ indicator: "1.1.1.1", kind: "ip" as const }, { indicator: "fs01", kind: "domain" as const, internal: true }],
  invalid: [],
  duplicates: 1,
};

beforeEach(() => {
  kv.clear();
  redis = fake;
  readBulkRowAny.mockReset();
});

describe("run store", () => {
  it("creates numbered rows and keeps only summaries in the record", () => {
    const { run, rows } = s.createRun("me@x.com", parsed, "r1", new Date("2026-10-07T00:00:00Z"));
    expect(run).toMatchObject({ v: 1, id: "r1", owner: "me@x.com", duplicates: 1 });
    expect(run.rows.map((r) => [r.id, r.state])).toEqual([[0, "pending"], [1, "internal"]]);
    expect("results" in run.rows[0]).toBe(false);
    expect(rows[0].results).toEqual([]);
  });

  it("generates an id when none is given", () => {
    expect(s.createRun("me@x.com", parsed).run.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("saves and loads for the owner only", async () => {
    const { run } = s.createRun("me@x.com", parsed, "r1");
    expect(await s.saveRun(run)).toBe(true);
    expect(await s.loadRun("r1", "me@x.com")).toEqual(run);
    expect(await s.loadRun("r1", "other@x.com")).toBeNull();
    expect(await s.loadRun("nope", "me@x.com")).toBeNull();
  });

  it("merges rows by id as summaries", () => {
    const { run, rows } = s.createRun("me@x.com", parsed, "r1");
    const merged = s.mergeRows(run, [{ ...rows[0], state: "full", results: [{} as never] }]);
    expect(merged.rows.map((r) => r.state)).toEqual(["full", "internal"]);
    expect("results" in merged.rows[0]).toBe(false);
  });

  it("hydrates a summary from the row cache, or starts it over", async () => {
    const { run } = s.createRun("me@x.com", parsed, "r1");
    readBulkRowAny.mockResolvedValueOnce({ ...run.rows[0], id: 99, state: "pass1", results: ["x"] });
    expect(await s.hydrate({ ...run.rows[0], state: "pass1" })).toMatchObject({ id: 0, state: "pass1", results: ["x"] });
    readBulkRowAny.mockResolvedValueOnce(null);
    expect(await s.hydrate({ ...run.rows[0], state: "pass1" })).toMatchObject({ state: "pending", results: [] });
  });

  it("degrades without Redis and on errors", async () => {
    const { run } = s.createRun("me@x.com", parsed, "r1");
    redis = null;
    expect(await s.saveRun(run)).toBe(false);
    expect(await s.loadRun("r1", "me@x.com")).toBeNull();
    redis = fake;
    fake.set.mockRejectedValueOnce(new Error("down"));
    expect(await s.saveRun(run)).toBe(false);
    fake.get.mockRejectedValueOnce(new Error("down"));
    expect(await s.loadRun("r1", "me@x.com")).toBeNull();
  });
});
