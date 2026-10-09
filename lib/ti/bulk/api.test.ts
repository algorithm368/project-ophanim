import { afterEach, describe, expect, it } from "vitest";
import { confirmAt, ndjsonStream, needsConfirmation, readRowIds } from "./api";
import type { BulkRun } from "./types";

afterEach(() => delete process.env.TI_BULK_CONFIRM_AT);

describe("readRowIds", () => {
  it("accepts a short list of non-negative integers", () => {
    expect(readRowIds({ rowIds: [0, 3] }, 25)).toEqual([0, 3]);
  });
  it("refuses anything else", () => {
    for (const body of [{ rowIds: [] }, { rowIds: [1.5] }, { rowIds: [-1] }, { rowIds: Array.from({ length: 26 }, (_, i) => i) }, null]) {
      expect(readRowIds(body, 25)).toBeNull();
    }
  });
});

describe("needsConfirmation", () => {
  const run = (pending: number, confirmed?: boolean): BulkRun => ({
    v: 1, id: "r", owner: "o", createdAt: "", invalid: [], duplicates: 0, confirmed,
    rows: Array.from({ length: pending }, (_, i) => ({ id: i, indicator: `x${i}`, kind: "ip" as const, state: "pass1" as const, bucket: "C" as const, pending: ["virustotal" as const], missing: [] })),
  });
  it("asks above the threshold, once", () => {
    process.env.TI_BULK_CONFIRM_AT = "3";
    expect(confirmAt()).toBe(3);
    expect(needsConfirmation(run(3))).toBe(false);
    expect(needsConfirmation(run(4))).toBe(true);
    expect(needsConfirmation(run(4, true))).toBe(false);
  });
  it("defaults to 50", () => {
    process.env.TI_BULK_CONFIRM_AT = "x";
    expect(confirmAt()).toBe(50);
  });
});

describe("ndjsonStream", () => {
  it("streams events and closes", async () => {
    const res = ndjsonStream(async (emit) => emit({ v: 1, type: "done" }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(await res.text()).toBe('{"v":1,"type":"done"}\n');
  });
  it("turns a throw into an error event", async () => {
    const res = ndjsonStream(async () => {
      throw new Error("boom");
    });
    expect(await res.text()).toBe('{"v":1,"type":"error","error":"boom"}\n');
  });
  it("stringifies a thrown non-Error", async () => {
    const res = ndjsonStream(async () => {
      throw "plain"; // NOSONAR: the branch under test is a non-Error throw
    });
    expect(await res.text()).toBe('{"v":1,"type":"error","error":"plain"}\n');
  });
});
