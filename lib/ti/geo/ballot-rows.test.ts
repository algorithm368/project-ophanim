import { describe, expect, it } from "vitest";
import { addressesLabel, ballotRows } from "@/lib/ti/geo/ballot-rows";

const same = () => "agrees|agrees|silent|silent";
const name = (id: string) => id.toUpperCase();

describe("ballotRows", () => {
  it("merges addresses that vote alike into one row", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `89.222.127.${i + 1}`);
    const rows = ballotRows(ids, same, name);
    expect(rows).toEqual([{ key: "89.222.127.1", ids, label: "89.222.127.x" }]);
  });

  it("keeps an address that votes differently on its own row", () => {
    const rows = ballotRows(
      ["1.1.1.1", "1.1.1.2", "9.9.9.9"],
      (id) => (id === "9.9.9.9" ? "differs" : "agrees"),
      (id) => id,
    );
    expect(rows.map((r) => [r.label, r.ids.length])).toEqual([
      ["1.1.1.x", 2],
      ["9.9.9.9", 1],
    ]);
  });

  it("never merges providers, even when they agree", () => {
    const rows = ballotRows(["ip-api", "ipinfo"], same, name);
    expect(rows.map((r) => r.label)).toEqual(["IP-API", "IPINFO"]);
  });

  it("does not merge a mix of addresses and names", () => {
    expect(ballotRows(["1.1.1.1", "ip-api"], same, name)).toHaveLength(2);
  });
});

describe("addressesLabel", () => {
  it("names the shared /24, then the shared /16", () => {
    expect(addressesLabel(["10.0.0.1", "10.0.0.9"])).toBe("10.0.0.x");
    expect(addressesLabel(["10.0.1.1", "10.0.2.1"])).toBe("10.0.x.x");
  });

  it("counts addresses that share less, or are not IPv4", () => {
    expect(addressesLabel(["10.0.0.1", "11.0.0.1"])).toBe("2 addresses");
    expect(addressesLabel(["2001:db8::1", "2001:db8::2"])).toBe("2 addresses");
  });
});
