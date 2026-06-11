import { describe, expect, it } from "vitest";
import { bareHost, extractTriageRelations } from "./triage";

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
    expect(rels).toEqual([
      { value: "45.9.148.0", type: "ip", relation: "contacts" },
      { value: "evil.example.com", type: "domain", relation: "contacts" },
      { value: "203.0.113.5", type: "ip", relation: "contacts" },
    ]);
  });

  it("drops non-routable sandbox noise (loopback / private)", () => {
    const rels = extractTriageRelations({
      targets: [{ iocs: { ips: ["127.0.0.1", "10.0.0.5", "8.8.8.8"] } }],
    });
    // private/loopback removed; the public resolver is kept as a network contact
    expect(rels).toEqual([
      { value: "8.8.8.8", type: "ip", relation: "contacts" },
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
