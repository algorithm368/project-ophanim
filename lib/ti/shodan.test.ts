import { describe, it, expect } from "vitest";
import { shodanHostInfo, PORT_SERVICE } from "@/lib/ti/shodan";
import type { SourceResult } from "@/lib/ti/types";

const src = (details: Record<string, unknown>): SourceResult[] => [
  {
    source: { id: "shodan-internetdb", name: "Shodan", url: "", weight: 0, category: "scanner" },
    status: "ok",
    enabled: true,
    durationMs: 1,
    details,
  } as unknown as SourceResult,
];

describe("shodanHostInfo", () => {
  it("extracts ports/vulns/cpes/hostnames and ignores wrong-typed entries", () => {
    const info = shodanHostInfo(
      src({ ports: [22, "x", 443], vulns: ["CVE-2024-6387"], cpes: ["cpe:/a:openbsd:openssh"], hostnames: ["a.example"] }),
    );
    expect(info.ports).toEqual([22, 443]);
    expect(info.vulns).toEqual(["CVE-2024-6387"]);
    expect(info.cpes).toEqual(["cpe:/a:openbsd:openssh"]);
    expect(info.hostnames).toEqual(["a.example"]);
  });

  it("returns empty arrays when the source is absent", () => {
    expect(shodanHostInfo([])).toEqual({ ports: [], vulns: [], cpes: [], hostnames: [] });
  });

  it("labels common ports", () => {
    expect(PORT_SERVICE[22]).toBe("SSH");
    expect(PORT_SERVICE[443]).toBe("HTTPS");
  });
});
