import { describe, expect, it } from "vitest";
import { validateIp } from "@/app/api/check/route";

/** The validated IP, or the HTTP status of the rejection. `Validated<V>` is
 *  `{ value: V } | { error: Response }`, so narrow on which key is present. */
function outcome(raw: string | null) {
  const result = validateIp(raw);
  return "value" in result
    ? { ok: true as const, value: result.value }
    : { ok: false as const, status: result.error.status };
}

describe("validateIp", () => {
  it("accepts a routable IPv4", () => {
    expect(outcome("8.8.8.8")).toEqual({ ok: true, value: "8.8.8.8" });
  });

  it("accepts a routable IPv6 and canonicalizes it", () => {
    // Uppercase and an uncompressed zero run must collapse to one cache key,
    // or the same address typed two ways becomes two cache entries.
    expect(outcome("2001:4860:4860:0:0:0:0:8888")).toEqual({
      ok: true,
      value: "2001:4860:4860::8888",
    });
    expect(outcome("2606:4700:4700:0000:0000:0000:0000:1111")).toEqual({
      ok: true,
      value: "2606:4700:4700::1111",
    });
  });

  it("rejects a non-routable IPv6 with 422", () => {
    expect(outcome("::1").status).toBe(422); // loopback
    expect(outcome("fe80::1").status).toBe(422); // link-local
    expect(outcome("fd00::1").status).toBe(422); // unique local
    expect(outcome("2001:db8::1").status).toBe(422); // documentation
  });

  it("rejects malformed IPv6 with 400", () => {
    expect(outcome("2001:db8:::1").status).toBe(400); // triple colon
    expect(outcome("fe80::1%eth0").status).toBe(400); // zone id
    expect(outcome("gggg::1").status).toBe(400);
  });

  it("rejects a missing parameter with 400", () => {
    expect(outcome(null).status).toBe(400);
  });
});
