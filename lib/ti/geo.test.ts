import { describe, expect, it } from "vitest";
import { bulkGeolocate, mapBatchResults, type IpApiBatchEntry } from "./geo";
import { parseIP, type ParsedIP } from "@/lib/ip";

const ip = (s: string): ParsedIP => {
  const p = parseIP(s);
  if (!p) throw new Error(`bad test ip: ${s}`);
  return p;
};

describe("mapBatchResults", () => {
  it("maps success and fail entries by position", () => {
    const ips = [ip("8.8.8.8"), ip("2606:4700:4700::1111")];
    const entries: IpApiBatchEntry[] = [
      {
        status: "success",
        country: "United States",
        countryCode: "US",
        city: "Mountain View",
        query: "8.8.8.8",
      },
      { status: "fail", message: "reserved range", query: "2606:4700:4700::1111" },
    ];

    const rows = mapBatchResults(ips, entries);
    expect(rows).toEqual([
      {
        ip: "8.8.8.8",
        version: 4,
        status: "ok",
        geo: expect.objectContaining({ country: "United States", city: "Mountain View" }),
      },
      {
        ip: "2606:4700:4700::1111",
        version: 6,
        status: "error",
        error: "reserved range",
      },
    ]);
  });

  it("treats a missing entry as an error row", () => {
    const rows = mapBatchResults([ip("1.1.1.1")], []);
    expect(rows[0]).toMatchObject({
      ip: "1.1.1.1",
      version: 4,
      status: "error",
      error: "Lookup failed",
    });
  });
});

describe("bulkGeolocate", () => {
  it("throws when given more than 100 IPs", async () => {
    const ips = Array.from({ length: 101 }, () => ip("8.8.8.8"));
    await expect(bulkGeolocate(ips, AbortSignal.timeout(1000))).rejects.toThrow(/100/);
  });
});
