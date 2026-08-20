import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clamavNames,
  ruleNames,
  yaraifyFinding,
  yaraifySource,
} from "@/lib/ti/hash/sources/yaraify";
import { postJson } from "@/lib/ti/http";

/** The shape the live API returned for the WannaCry sample. */
const wannacry = {
  query_status: "ok",
  data: {
    metadata: {
      first_seen: "2022-12-16 12:39:02 UTC",
      last_seen: "2023-07-03 10:09:29 UTC",
      sightings: 2,
      imphash: "9ecee117164e0b870a53dd187cdd7174",
      sha3_384: "7c6c39f43597afe297bbf69dc76216fa",
    },
    tasks: [
      {
        static_results: [
          { rule_name: "Contains_Bitcoin_Address", author: "Didier Stevens" },
          { rule_name: "malware_shellcode_hash", author: "JPCERT/CC" },
          { rule_name: "meth_get_eip", author: "Willi Ballenthin" },
        ],
        clamav_results: ["Win.Exploit.Doublepulsar-7427328-0", "Win.Malware.Djwy-6775897-0"],
      },
    ],
  },
};

describe("ruleNames", () => {
  it("dedupes across tasks and preserves first-seen order", () => {
    expect(
      ruleNames([
        { static_results: [{ rule_name: "b" }, { rule_name: "a" }] },
        { static_results: [{ rule_name: "A" }, { rule_name: "c" }] },
      ]),
    ).toEqual(["b", "a", "c"]);
  });

  it("caps the list", () => {
    const many = [{ static_results: Array.from({ length: 30 }, (_, i) => ({ rule_name: `r${i}` })) }];
    expect(ruleNames(many)).toHaveLength(8);
  });

  it("is empty when nothing matched", () => {
    expect(ruleNames([{ static_results: [] }])).toEqual([]);
    expect(ruleNames(undefined)).toEqual([]);
  });
});

describe("clamavNames", () => {
  it("dedupes and caps", () => {
    expect(clamavNames([{ clamav_results: ["x", "X", "y"] }])).toEqual(["x", "y"]);
  });

  it("tolerates a null result set", () => {
    expect(clamavNames([{ clamav_results: null }])).toEqual([]);
  });
});

describe("yaraifyFinding", () => {
  it("names the rules that matched, which is what a count cannot do", () => {
    const f = yaraifyFinding(wannacry);
    expect(f.summary).toContain("3 YARA rules matched");
    expect(f.summary).toContain("2 ClamAV signatures");
    expect(f.details).toMatchObject({
      yaraRules: ["Contains_Bitcoin_Address", "malware_shellcode_hash", "meth_get_eip"],
    });
  });

  it("never scores, because abuse.ch already votes three times", () => {
    // MalwareBazaar, ThreatFox and URLhaus all draw on the same organisation's
    // corpus and all carry weight.
    const f = yaraifyFinding(wannacry);
    expect(f.score).toBeUndefined();
    expect(f.malicious).toBeUndefined();
  });

  it("contributes file identity and dates to the hash context", () => {
    const f = yaraifyFinding(wannacry);
    expect(f.hashContext).toMatchObject({
      firstSeen: "2022-12-16 12:39:02 UTC",
      lastSeen: "2023-07-03 10:09:29 UTC",
      imphash: "9ecee117164e0b870a53dd187cdd7174",
    });
    expect(f.lastSeen).toBe("2023-07-03 10:09:29 UTC");
  });

  it("handles a sample with a record but no rule matches", () => {
    const f = yaraifyFinding({
      query_status: "ok",
      data: { metadata: { sightings: 1 }, tasks: [{ static_results: [] }] },
    });
    expect(f.summary).toContain("1 sighting");
    expect(f.categories).toBeUndefined();
  });

  it("reports a miss as a miss, not an error", () => {
    expect(yaraifyFinding({ query_status: "no_result" }).summary).toBe(
      "No YARAify record for this file",
    );
  });
});

vi.mock("@/lib/ti/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ti/http")>();
  return { ...actual, postJson: vi.fn() };
});

describe("yaraifySource.check", () => {
  const signal = () => new AbortController().signal;
  const KEY = "THREATFOX_API_KEY";
  const original = process.env[KEY];
  afterEach(() => {
    vi.mocked(postJson).mockReset();
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("skips without an abuse.ch key rather than erroring", async () => {
    delete process.env[KEY];
    expect((await yaraifySource.check("a".repeat(64), signal())).status).toBe("skipped");
    expect(yaraifySource.isEnabled()).toBe(false);
  });

  it("passes a live hit through to the finding", async () => {
    process.env[KEY] = "test-key";
    vi.mocked(postJson).mockResolvedValue({ ok: true, status: 200, data: wannacry, text: "" });
    const f = await yaraifySource.check("a".repeat(64), signal());
    expect(f.summary).toContain("3 YARA rules matched");
  });

  it("reports the abuse.ch fair-use limit as a rate limit", async () => {
    process.env[KEY] = "test-key";
    vi.mocked(postJson).mockResolvedValue({ ok: false, status: 429, data: null, text: "" });
    expect((await yaraifySource.check("a".repeat(64), signal())).status).toBe("rate_limited");
  });

  it("never throws out of check()", async () => {
    process.env[KEY] = "test-key";
    vi.mocked(postJson).mockResolvedValue({ ok: false, status: 500, data: null, text: "" });
    expect((await yaraifySource.check("a".repeat(64), signal())).status).toBe("error");
    vi.mocked(postJson).mockRejectedValue(new Error("boom"));
    expect((await yaraifySource.check("a".repeat(64), signal())).status).toBe("error");
    vi.mocked(postJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await yaraifySource.check("a".repeat(64), signal())).status).toBe("timeout");
  });
});
