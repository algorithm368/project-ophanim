import { describe, expect, it } from "vitest";
import { groupSubdomains } from "@/lib/ti/domain/subdomain-groups";

const under = (apex: string, ...rels: string[]) => rels.map((r) => `${r}.${apex}`);

describe("groupSubdomains", () => {
  it("groups a zone with three names under it, and quiets the zone", () => {
    const groups = groupSubdomains(under("g.test", "b.cloud", "a.cloud", "x.eu.cloud", "www"), "g.test");
    expect(groups[0]).toEqual({
      kind: "zone",
      pattern: "*.cloud",
      names: [
        { full: "a.cloud.g.test", shown: "a", quiet: ".cloud" },
        { full: "b.cloud.g.test", shown: "b", quiet: ".cloud" },
        { full: "x.eu.cloud.g.test", shown: "x.eu", quiet: ".cloud" },
      ],
    });
    expect(groups[1]).toEqual({ kind: "other", pattern: "Other", names: [{ full: "www.g.test", shown: "www" }] });
  });

  it("leaves a zone with fewer than three names to the rest", () => {
    const groups = groupSubdomains(under("g.test", "a.corp", "b.corp"), "g.test");
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("other");
  });

  it("prefers the two-word family, then falls back to the first word", () => {
    const groups = groupSubdomains(
      under("t.test", "tmn-clf-a", "tmn-clf-b", "tmn-clf-c", "tmn-x-1", "tmn-y-1", "tmn-z"),
      "t.test",
    );
    expect(groups.map((g) => g.pattern)).toEqual(["tmn-*", "tmn-clf-*"]);
    expect(groups[1].names.map((n) => n.shown)).toEqual(["a", "b", "c"]);
    expect(groups[0].names.map((n) => n.shown)).toEqual(["x-1", "y-1", "z"]);
  });

  it("puts the bare word in its own family", () => {
    const [group] = groupSubdomains(under("t.test", "smart", "smart-dev", "smart-admin"), "t.test");
    expect(group.pattern).toBe("smart-*");
    expect(group.names.map((n) => n.shown)).toEqual(["admin", "dev", "smart"]);
  });

  it("orders groups largest first, ties by pattern, and Other last", () => {
    const groups = groupSubdomains(
      under("t.test", "b-1", "b-2", "b-3", "a-1", "a-2", "a-3", "z.q", "y.q", "x.q", "w.q", "lone", "solo"),
      "t.test",
    );
    expect(groups.map((g) => g.pattern)).toEqual(["*.q", "a-*", "b-*", "Other"]);
  });

  it("keeps a name outside the apex whole, in Other, and drops repeats", () => {
    const groups = groupSubdomains(["a.t.test", "a.t.test", "elsewhere.test"], "t.test");
    expect(groups).toEqual([
      {
        kind: "other",
        pattern: "Other",
        names: [
          { full: "a.t.test", shown: "a" },
          { full: "elsewhere.test", shown: "elsewhere.test" },
        ],
      },
    ]);
  });

  it("answers nothing for no names", () => {
    expect(groupSubdomains([], "t.test")).toEqual([]);
  });
});
