import { describe, it, expect } from "vitest";
import { buildGraphModel } from "./relation-graph";
import type { RelatedIndicator } from "@/lib/ti/types";

const focus = { value: "1.2.3.4", type: "ip" as const };

describe("buildGraphModel", () => {
  it("excludes the focus and dedupes neighbours by lowercased value", () => {
    const related: RelatedIndicator[] = [
      { value: "Evil.com", type: "domain", relation: "rDNS" },
      { value: "evil.com", type: "domain", relation: "host" }, // dup value
      { value: "1.2.3.4", type: "ip", relation: "A" }, // == focus
    ];
    const m = buildGraphModel(focus, related);
    const neighbours = m.nodes.filter((n) => !n.isFocus);
    expect(neighbours).toHaveLength(1);
    expect(neighbours[0].id).toBe("evil.com");
    expect(m.nodes.find((n) => n.isFocus)?.id).toBe("1.2.3.4");
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0]).toMatchObject({ from: "1.2.3.4", to: "evil.com" });
  });

  it("orders neighbours by RELATION_ORDER (A before NS before MX)", () => {
    const related: RelatedIndicator[] = [
      { value: "mx.example", type: "domain", relation: "MX" },
      { value: "5.6.7.8", type: "ip", relation: "A" },
      { value: "ns.example", type: "domain", relation: "NS" },
    ];
    const order = buildGraphModel(focus, related)
      .nodes.filter((n) => !n.isFocus)
      .map((n) => n.relation);
    expect(order).toEqual(["A", "NS", "MX"]);
  });
});
