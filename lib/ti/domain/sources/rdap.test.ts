import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson } from "../../http";

vi.mock("../../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../http")>();
  return { ...actual, getJson: vi.fn() };
});

import {
  delegationStatus,
  eventDate,
  registrarName,
  scoreForAge,
  rdapSource,
} from "./rdap";

describe("scoreForAge", () => {
  it("scores newer registrations higher, decaying to 0 by 90 days", () => {
    expect(scoreForAge(undefined)).toBe(0);
    expect(scoreForAge(3)).toBe(55);
    expect(scoreForAge(7)).toBe(40);
    expect(scoreForAge(29)).toBe(40);
    expect(scoreForAge(30)).toBe(20);
    expect(scoreForAge(89)).toBe(20);
    expect(scoreForAge(90)).toBe(0);
    expect(scoreForAge(1000)).toBe(0);
  });
});

describe("eventDate", () => {
  const events = [
    { eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" },
    { eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" },
  ];

  it("finds the date for a given action", () => {
    expect(eventDate(events, "registration")).toBe("2020-01-01T00:00:00Z");
  });

  it("returns undefined for a missing action or events", () => {
    expect(eventDate(events, "last changed")).toBeUndefined();
    expect(eventDate(undefined, "registration")).toBeUndefined();
  });
});

describe("registrarName", () => {
  it("reads the registrar entity's vCard 'fn' field", () => {
    const entities = [
      { roles: ["technical"] },
      {
        roles: ["registrar"],
        vcardArray: [
          "vcard",
          [
            ["version", {}, "text", "4.0"],
            ["fn", {}, "text", "GoDaddy.com, LLC"],
          ],
        ] as [string, unknown[]],
      },
    ];
    expect(registrarName(entities)).toBe("GoDaddy.com, LLC");
  });

  it("returns undefined when there is no registrar entity", () => {
    expect(registrarName([{ roles: ["registrant"] }])).toBeUndefined();
    expect(registrarName(undefined)).toBeUndefined();
  });
});

describe("delegationStatus", () => {
  // Absent and unsigned are different facts. RDAP that never reported
  // secureDNS tells us nothing, while an explicit false is the registry
  // saying the delegation is unsigned, and only the latter is a finding.
  it("distinguishes never-reported from explicitly unsigned", () => {
    expect(delegationStatus(undefined)).toBeUndefined();
    expect(delegationStatus(false)).toBe("unsigned");
    expect(delegationStatus(true)).toBe("signed");
  });
});

describe("rdapSource.check", () => {
  const signal = new AbortController().signal;
  const day = 86_400_000;
  const now = Date.UTC(2026, 5, 1);
  const iso = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
  const registrar = {
    roles: ["registrar"],
    vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar"]]] as [string, unknown[]],
  };
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getJson).mockReset();
  });

  it("needs no key", () => expect(rdapSource.isEnabled()).toBe(true));

  it("flags a days-old registration and a registry hold", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    reply({
      events: [{ eventAction: "registration", eventDate: iso(3) }],
      entities: [registrar],
      nameservers: [{ ldhName: "NS1.EXAMPLE" }, {}],
      status: ["client hold"],
      secureDNS: { delegationSigned: true },
    });
    const f = await rdapSource.check("www.evil.example", signal);
    expect(vi.mocked(getJson).mock.calls[0][0]).toBe("https://rdap.org/domain/evil.example");
    expect(f).toMatchObject({
      score: 55,
      categories: ["registry-hold"],
      summary: "Registered 3 day(s) ago, newly created, via Example Registrar",
      domainContext: { nameservers: ["ns1.example"], dnssec: "signed" },
    });
  });

  it("describes older registrations in years, with or without a registrar", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    reply({ events: [{ eventAction: "registration", eventDate: iso(800) }] });
    expect((await rdapSource.check("old.example", signal)).summary).toBe("Registered 2 year(s) ago");
    reply({ events: [{ eventAction: "registration", eventDate: iso(100) }], status: ["pendingDelete"] });
    const f = await rdapSource.check("old.example", signal);
    expect(f.summary).toBe("Registered <1 year(s) ago");
    expect(f.score).toBe(35);
  });

  it("falls back when there is no usable registration date", async () => {
    reply({ entities: [registrar] });
    expect((await rdapSource.check("a.example", signal)).summary).toBe(
      "Registered via Example Registrar",
    );
    reply({ events: [{ eventAction: "registration", eventDate: "garbage" }] });
    expect((await rdapSource.check("a.example", signal)).summary).toBe(
      "Registration data available",
    );
  });

  it("keeps an unparseable name whole", async () => {
    reply({});
    await rdapSource.check("not a domain", signal);
    expect(vi.mocked(getJson).mock.calls[0][0]).toBe("https://rdap.org/domain/not a domain");
  });

  it("maps 404, errors and timeouts", async () => {
    reply(null, 404);
    expect((await rdapSource.check("a.example", signal)).summary).toBe("No RDAP record found");
    reply({ title: "Bad Request" }, 400);
    expect((await rdapSource.check("a.example", signal)).error).toBe("Bad Request");
    reply(null, 500);
    expect((await rdapSource.check("a.example", signal)).error).toBe("HTTP 500");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await rdapSource.check("a.example", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await rdapSource.check("a.example", signal)).error).toBe("boom");
  });
});
