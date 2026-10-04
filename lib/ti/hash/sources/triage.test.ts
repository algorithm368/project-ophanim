import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bareHost,
  extractTriageCapabilities,
  extractTriageMitre,
  extractTriageRelations,
  triageSource,
} from "./triage";
import * as http from "../../http";

describe("extractTriageRelations", () => {
  it("merges extracted config C2 with target IOCs, typed and deduped", () => {
    const rels = extractTriageRelations({
      extracted: [{ config: { c2: ["http://45.9.148.0:443/gate"] } }],
      targets: [
        {
          iocs: {
            domains: ["evil.example.com", "evil.example.com"],
            ips: ["203.0.113.5", "45.9.148.0"], // 45.9.148.0 dup of the c2 host
          },
        },
      ],
    });
    // config-derived C2 is the confirmed tier; sandbox iocs are observed.
    expect(rels).toEqual([
      {
        value: "45.9.148.0",
        type: "ip",
        relation: "contacts",
        sources: ["triage"],
        tier: "confirmed",
      },
      {
        value: "evil.example.com",
        type: "domain",
        relation: "contacts",
        sources: ["triage"],
        tier: "observed",
      },
      {
        value: "203.0.113.5",
        type: "ip",
        relation: "contacts",
        sources: ["triage"],
        tier: "observed",
      },
    ]);
  });

  it("drops non-routable sandbox noise (loopback / private)", () => {
    const rels = extractTriageRelations({
      targets: [{ iocs: { ips: ["127.0.0.1", "10.0.0.5", "8.8.8.8"] } }],
    });
    // private/loopback removed; the public resolver is kept as a network contact
    expect(rels).toEqual([
      {
        value: "8.8.8.8",
        type: "ip",
        relation: "contacts",
        sources: ["triage"],
        tier: "observed",
      },
    ]);
  });

  it("is empty when there are no extracted configs or target IOCs", () => {
    expect(extractTriageRelations({})).toEqual([]);
  });
});

describe("bareHost", () => {
  it("returns a bare hostname unchanged", () => {
    expect(bareHost("evil.com")).toBe("evil.com");
  });

  it("strips scheme and path", () => {
    expect(bareHost("https://evil.com/c2/gate.php")).toBe("evil.com");
  });

  it("strips a trailing :port from host:port", () => {
    expect(bareHost("evil.com:8080")).toBe("evil.com");
    expect(bareHost("http://1.2.3.4:443/x")).toBe("1.2.3.4");
  });

  it("unwraps a bracketed IPv6 (with or without a port)", () => {
    expect(bareHost("[2001:db8::1]:443")).toBe("2001:db8::1");
  });

  it("leaves an unbracketed IPv6 (multiple colons) intact", () => {
    expect(bareHost("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("triageSource.check", () => {
  it("emits fileNames from sample.target and targets[].target, deduped", async () => {
    vi.stubEnv("TRIAGE_API_KEY", "test-key");
    vi.spyOn(http, "getJson")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: [{ id: "sample-123", status: "done" }] },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          sample: { target: "invoice.doc" },
          targets: [
            { target: "invoice.doc" },
            { target: "stage2.exe" },
          ],
        },
      } as never);
    const finding = await triageSource.check("aabbccdd" + "00112233" + "44556677" + "8899aabb", new AbortController().signal);
    expect(finding.hashContext?.fileNames).toEqual(["invoice.doc", "stage2.exe"]);
  });
});

describe("extractTriageCapabilities / extractTriageMitre", () => {
  const data = {
    targets: [
      {
        signatures: [
          { name: "Downloads executable", ttp: ["T1105"] },
          { name: "Modifies run key", ttp: ["T1547"] },
          { name: "Downloads executable", ttp: ["T1105"] }, // dup
        ],
      },
      { signatures: [{ name: "Contacts C2", ttp: ["T1071", "T1105"] }] },
    ],
  };

  it("dedupes capabilities by label and carries their ttp", () => {
    expect(extractTriageCapabilities(data)).toEqual([
      { label: "Downloads executable", mitre: ["T1105"] },
      { label: "Modifies run key", mitre: ["T1547"] },
      { label: "Contacts C2", mitre: ["T1071", "T1105"] },
    ]);
  });

  it("dedupes MITRE ids across all signatures, uppercased", () => {
    expect(extractTriageMitre(data)).toEqual([
      { id: "T1105" },
      { id: "T1547" },
      { id: "T1071" },
    ]);
  });

  it("returns empty arrays when no signatures carry behavior", () => {
    expect(extractTriageCapabilities({ targets: [{}] })).toEqual([]);
    expect(extractTriageMitre({})).toEqual([]);
  });
});

describe("triage helpers — sparse input", () => {
  it("tolerates configs and targets missing their parts", () => {
    expect(extractTriageRelations({ extracted: [{}, { config: { domains: ["a.example"], hosts: [7 as never] } }], targets: [{}] })).toEqual([
      expect.objectContaining({ value: "a.example", tier: "confirmed" }),
    ]);
  });

  it("skips nameless signatures and ones without techniques", () => {
    const data = { targets: [{ signatures: [{}, { name: "X" }] }, {}] };
    expect(extractTriageCapabilities(data)).toEqual([{ label: "X", mitre: undefined }]);
    expect(extractTriageMitre(data)).toEqual([]);
  });
});

describe("triageSource.check — remaining paths", () => {
  const signal = new AbortController().signal;
  const H = "a".repeat(64);
  const res = (data: unknown, status = 200) => ({ ok: status < 400, status, data, text: "" }) as never;
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is skipped without a key", async () => {
    vi.stubEnv("TRIAGE_API_KEY", "");
    expect(triageSource.isEnabled()).toBe(false);
    expect(await triageSource.check(H, signal)).toEqual({ status: "skipped" });
  });

  it("scales the analysis score and names families, behavior and contacts", async () => {
    vi.stubEnv("TRIAGE_API_KEY", "k");
    expect(triageSource.isEnabled()).toBe(true);
    vi.spyOn(http, "getJson")
      .mockResolvedValueOnce(res({ data: [{ id: "s1" }] }))
      .mockResolvedValueOnce(
        res({
          analysis: { score: 10, family: ["lumma"] },
          targets: [
            {
              family: ["stealer"],
              signatures: [{ name: "Steals creds", ttp: ["t1555"] }],
              iocs: { ips: ["5.6.7.8"] },
            },
          ],
        }),
      );
    const f = await triageSource.check(H, signal);
    expect(f).toMatchObject({
      malicious: true,
      score: 100,
      categories: ["lumma", "stealer", "Steals creds"],
      summary: "Triage score 10/10 (lumma, stealer)",
      hashContext: { mitreTechniques: [{ id: "T1555" }] },
    });
    expect(f.relations).toHaveLength(1);
  });

  it("falls back to the best target score, then to zero", async () => {
    vi.stubEnv("TRIAGE_API_KEY", "k");
    const spy = vi.spyOn(http, "getJson");
    spy
      .mockResolvedValueOnce(res({ data: [{ id: "s1" }] }))
      .mockResolvedValueOnce(res({ targets: [{ score: 4 }, {}] }));
    expect((await triageSource.check(H, signal)).summary).toBe("Triage score 4/10");
    spy.mockResolvedValueOnce(res({ data: [{ id: "s1" }] })).mockResolvedValueOnce(res({}));
    const f = await triageSource.check(H, signal);
    expect(f.score).toBe(0);
    expect(f.relations).toBeUndefined();
    expect(f.hashContext).toMatchObject({
      fileNames: undefined,
      capabilities: undefined,
      mitreTechniques: undefined,
    });
  });

  it("reports a missing report, and HTTP failures on either call", async () => {
    vi.stubEnv("TRIAGE_API_KEY", "k");
    const spy = vi.spyOn(http, "getJson");
    spy.mockResolvedValueOnce(res({ data: [] }));
    expect((await triageSource.check(H, signal)).summary).toBe("No Triage report for this file");
    spy.mockResolvedValueOnce(res(null, 401));
    expect((await triageSource.check(H, signal)).error).toBe("HTTP 401");
    spy.mockResolvedValueOnce(res({ data: [{ id: "s1" }] })).mockResolvedValueOnce(res(null, 500));
    expect((await triageSource.check(H, signal)).error).toBe("HTTP 500");
    spy.mockRejectedValueOnce(new DOMException("t", "TimeoutError"));
    expect((await triageSource.check(H, signal)).status).toBe("timeout");
    spy.mockRejectedValueOnce(new Error("boom"));
    expect((await triageSource.check(H, signal)).error).toBe("boom");
  });
});
