import { describe, expect, it, vi } from "vitest";
import { runResearch } from "./run";
import type { ResearchProvider } from "./types";

function provider(over: Partial<ResearchProvider>): ResearchProvider {
  return {
    meta: { id: "urlscan", name: "Test", url: "https://t.test" },
    supports: ["ip", "domain"],
    isEnabled: () => true,
    check: async () => ({ status: "ok", summary: "hit" }),
    ...over,
  };
}

describe("runResearch", () => {
  it("only runs providers that support the indicator kind", async () => {
    const ipOnly = vi.fn(async () => ({ status: "ok" as const }));
    const domainOnly = vi.fn(async () => ({ status: "ok" as const }));
    const results = await runResearch("1.2.3.4", "ip", [
      provider({ supports: ["ip"], check: ipOnly }),
      provider({ supports: ["domain"], check: domainOnly }),
    ]);

    expect(results).toHaveLength(1);
    expect(ipOnly).toHaveBeenCalledOnce();
    expect(domainOnly).not.toHaveBeenCalled();
  });

  it("marks a disabled provider as skipped without calling check", async () => {
    const check = vi.fn(async () => ({ status: "ok" as const }));
    const [r] = await runResearch("evil.com", "domain", [
      provider({ isEnabled: () => false, check }),
    ]);

    expect(r.status).toBe("skipped");
    expect(check).not.toHaveBeenCalled();
  });

  it("turns a thrown provider into an error result", async () => {
    const [r] = await runResearch("evil.com", "domain", [
      provider({
        check: async () => {
          throw new Error("boom");
        },
      }),
    ]);

    expect(r.status).toBe("error");
    expect(r.error).toBe("boom");
  });

  it("invokes onSettled once per applicable provider as it resolves", async () => {
    const seen: string[] = [];
    await runResearch(
      "evil.com",
      "domain",
      [
        provider({
          meta: { id: "urlscan", name: "A", url: "u" },
          supports: ["domain"],
        }),
        provider({
          meta: { id: "crtsh", name: "B", url: "u" },
          supports: ["domain"],
        }),
        provider({ meta: { id: "wayback", name: "C", url: "u" }, supports: ["ip"] }),
      ],
      (r) => seen.push(r.provider.id),
    );

    expect(seen.sort()).toEqual(["crtsh", "urlscan"]);
  });

  it("stamps provider meta and timing on a successful finding", async () => {
    const [r] = await runResearch("evil.com", "domain", [
      provider({
        meta: { id: "crtsh", name: "crt.sh", url: "https://crt.sh" },
        check: async () => ({ status: "ok", summary: "2 certs" }),
      }),
    ]);

    expect(r.provider.id).toBe("crtsh");
    expect(r.summary).toBe("2 certs");
    expect(typeof r.durationMs).toBe("number");
  });
});
