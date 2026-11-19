import { describe, expect, it } from "vitest";
import { panelRows } from "@/lib/ti/panel-rows";
import type { SourceMeta, SourceResult } from "@/lib/ti/types";

function meta(id: string, weight = 1): SourceMeta {
  return { id, name: id, weight } as SourceMeta;
}

function answer(id: string, weight = 1): SourceResult {
  return { source: meta(id, weight), status: "ok", score: 0 } as SourceResult;
}

describe("panelRows", () => {
  it("keeps registry order, whatever order the answers came in", () => {
    const { detectors } = panelRows(
      [meta("feodo"), meta("vt"), meta("abuseipdb")],
      [answer("abuseipdb"), answer("feodo")],
    );
    expect(detectors.map((r) => r.meta.id)).toEqual(["feodo", "vt", "abuseipdb"]);
    expect(detectors.map((r) => r.result?.source.id)).toEqual(["feodo", undefined, "abuseipdb"]);
  });

  it("splits detectors from context by weight", () => {
    const { detectors, context } = panelRows(
      [meta("ip-api", 0), meta("vt"), meta("rdns", 0)],
      [],
    );
    expect(detectors.map((r) => r.meta.id)).toEqual(["vt"]);
    expect(context.map((r) => r.meta.id)).toEqual(["ip-api", "rdns"]);
  });

  // sourceWeight reads a meta with no weight as full weight, and so must this,
  // or a cached meta missing the field would vanish from the detectors.
  it("reads a meta with no weight as a detector", () => {
    const bare = { id: "old", name: "old" } as SourceMeta;
    expect(panelRows([bare], []).detectors).toHaveLength(1);
  });

  it("still lists an answer from a source the panel did not name", () => {
    const { detectors, context } = panelRows([meta("vt")], [answer("vt"), answer("new", 0)]);
    expect(detectors.map((r) => r.meta.id)).toEqual(["vt"]);
    expect(context.map((r) => r.meta.id)).toEqual(["new"]);
    expect(context[0].result?.source.id).toBe("new");
  });

  it("is empty before the panel is known", () => {
    expect(panelRows([], [])).toEqual({ detectors: [], context: [] });
  });
});
