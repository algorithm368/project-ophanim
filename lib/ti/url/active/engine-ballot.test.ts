import { describe, expect, it } from "vitest";
import type { ScanDetail } from "@/lib/ti/url/active/detail";
import { agreementLevel, ballotSplits, engineBallots } from "@/lib/ti/url/active/engine-ballot";
import type { ScanEngine } from "@/lib/ti/url/active/engines";
import type { ActiveScan } from "@/lib/ti/url/active/types";

function scan(
  engine: ScanEngine,
  detail: Partial<ScanDetail> | null,
  target = "https://example.test/",
  status: ActiveScan["status"] = "done",
): ActiveScan {
  return {
    engine,
    target,
    status,
    ...(detail
      ? {
          detail: {
            requestCount: 0,
            verdicts: { overall: { malicious: false } },
            absent: [],
            ...detail,
          },
        }
      : {}),
  } as ActiveScan;
}

const field = (ballot: ReturnType<typeof engineBallots>[number], key: string) =>
  ballot.fields.find((f) => f.key === key);

describe("engineBallots", () => {
  it("marks a field everyone answered alike as a win for each", () => {
    const [b] = engineBallots([
      scan("urlscan", { httpStatus: "200", ip: "1.1.1.1" }),
      scan("cloudflare", { httpStatus: "200", ip: "1.1.1.1" }),
    ]);
    expect(b.engines).toEqual(["urlscan", "cloudflare"]);
    expect(field(b, "HTTP status")?.cells).toEqual({
      urlscan: { status: "win" },
      cloudflare: { status: "win" },
    });
    expect(field(b, "Verdict")?.cells.urlscan).toEqual({ status: "win" });
  });

  it("gives neither of two disagreeing engines the win", () => {
    const [b] = engineBallots([
      scan("urlscan", { ip: "104.26.11.242" }),
      scan("cloudflare", { ip: "172.67.70.54" }),
    ]);
    expect(field(b, "Serving IP")?.cells).toEqual({
      urlscan: { status: "dissent", value: "104.26.11.242" },
      cloudflare: { status: "dissent", value: "172.67.70.54" },
    });
  });

  it("lets the most common answer win when there is one", () => {
    const [b] = engineBallots([
      scan("urlscan", { server: "nginx" }),
      scan("cloudflare", { server: "nginx" }),
      scan("cloudflare", { server: "apache" }),
    ]);
    const cells = field(b, "Server")?.cells;
    // The second Cloudflare reading overwrites the first under the same key,
    // which is what a grid keyed by engine can show.
    expect(cells?.urlscan).toEqual({ status: "win" });
    expect(cells?.cloudflare).toEqual({ status: "dissent", value: "apache" });
  });

  it("calls an engine that said nothing silent, not dissenting", () => {
    const [b] = engineBallots([
      scan("urlscan", { title: "Home" }),
      scan("cloudflare", {}),
    ]);
    expect(field(b, "Page title")?.cells).toEqual({
      urlscan: { status: "win" },
      cloudflare: { status: "absent" },
    });
  });

  it("draws no ballot for a URL only one engine finished", () => {
    expect(
      engineBallots([
        scan("urlscan", { httpStatus: "200" }),
        scan("cloudflare", null, "https://example.test/", "running"),
        scan("cloudflare", null, "https://other.test/"),
      ]),
    ).toEqual([]);
  });

  it("keeps one ballot per URL", () => {
    const ballots = engineBallots([
      scan("urlscan", {}, "http://1.2.3.4/"),
      scan("cloudflare", {}, "http://1.2.3.4/"),
      scan("urlscan", {}, "https://1.2.3.4/"),
      scan("cloudflare", {}, "https://1.2.3.4/"),
    ]);
    expect(ballots.map((b) => b.target)).toEqual(["http://1.2.3.4/", "https://1.2.3.4/"]);
  });
});

describe("agreementLevel", () => {
  it("is nothing without a ballot", () => {
    expect(agreementLevel([])).toBeUndefined();
  });

  it("agrees when no field split", () => {
    const ballots = engineBallots([scan("urlscan", { httpStatus: "200" }), scan("cloudflare", { httpStatus: "200" })]);
    expect(ballotSplits(ballots)).toBe(0);
    expect(agreementLevel(ballots)).toBe("Agree");
  });

  it("counts the split fields across every ballot", () => {
    const ballots = engineBallots([
      scan("urlscan", { ip: "1.1.1.1", title: "a" }, "http://h/"),
      scan("cloudflare", { ip: "2.2.2.2", title: "b" }, "http://h/"),
      scan("urlscan", { ip: "1.1.1.1" }, "https://h/"),
      scan("cloudflare", { ip: "1.1.1.1", verdicts: { overall: { malicious: true } } }, "https://h/"),
    ]);
    expect(ballotSplits(ballots)).toBe(3);
    expect(agreementLevel(ballots)).toBe("3 splits");
  });

  it("says one split in the singular", () => {
    const ballots = engineBallots([scan("urlscan", { ip: "1.1.1.1" }), scan("cloudflare", { ip: "2.2.2.2" })]);
    expect(agreementLevel(ballots)).toBe("1 split");
  });
});
