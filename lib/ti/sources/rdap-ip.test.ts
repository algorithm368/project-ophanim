import { afterEach, describe, expect, it, vi } from "vitest";
import { rdapIpSource, rdapIpToGeo, type RdapIpResponse } from "./rdap-ip";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("rdapIpToGeo", () => {
  it("maps allocation country and network name", () => {
    const data: RdapIpResponse = {
      country: "CA",
      name: "SHAW-COMMUNICATIONS",
      startAddress: "24.64.0.0",
    };
    expect(rdapIpToGeo(data)).toEqual({
      countryCode: "CA",
      asnOrg: "SHAW-COMMUNICATIONS",
    });
  });

  it("omits country when absent", () => {
    expect(rdapIpToGeo({ name: "EXAMPLE-NET" })).toEqual({
      asnOrg: "EXAMPLE-NET",
    });
  });
});

describe("rdapIpSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, ok = true) =>
    vi.mocked(getJson).mockResolvedValue({ ok, status: ok ? 200 : 404, data, text: "" });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(getJson).mockReset();
  });

  it("needs no key", () => expect(rdapIpSource.isEnabled()).toBe(true));

  it("reads the allocation, its age and the abuse contact", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 0, 11));
    reply({
      name: "EXAMPLE-NET",
      country: "US",
      startAddress: "1.2.3.0",
      endAddress: "1.2.3.255",
      events: [
        { eventAction: "last changed", eventDate: "2025-01-01" },
        { eventAction: "registration", eventDate: "2026-01-01T00:00:00Z" },
      ],
      entities: [
        {
          roles: ["abuse"],
          vcardArray: ["vcard", [["email", {}, "text", "abuse@example.test"]]],
        },
      ],
    });
    const f = await rdapIpSource.check("1.2.3.4", signal);
    expect(f.summary).toBe("EXAMPLE-NET · US");
    expect(f.details).toMatchObject({
      range: "1.2.3.0 – 1.2.3.255",
      registeredAt: "2026-01-01T00:00:00Z",
      allocationAgeDays: 10,
      abuseContact: "abuse@example.test",
    });
  });

  it("falls back to a generic summary and tolerates bad or missing dates", async () => {
    reply({ events: [{ eventAction: "registration", eventDate: "not a date" }] });
    const f = await rdapIpSource.check("1.2.3.4", signal);
    expect(f.summary).toBe("Allocation found");
    expect(f.details).toMatchObject({ allocationAgeDays: undefined, abuseContact: undefined });
    reply({});
    expect((await rdapIpSource.check("1.2.3.4", signal)).details).toMatchObject({
      registeredAt: undefined,
    });
  });

  it("surfaces HTTP failures, timeouts and errors", async () => {
    reply(null, false);
    expect((await rdapIpSource.check("1.2.3.4", signal)).error).toBe("HTTP 404");
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await rdapIpSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await rdapIpSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
