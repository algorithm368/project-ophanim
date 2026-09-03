import { describe, expect, it } from "vitest";
import {
  classifyDomainLabel,
  classifyHashLabel,
  classifyIpLabel,
} from "@/lib/ti/indicator-class";

describe("classifyIpLabel", () => {
  it("reads the proxy flag before the hosting flag", () => {
    // A VPN endpoint in a datacentre sets both; "Anonymizer" is the more
    // specific claim and the one an analyst acts on.
    expect(classifyIpLabel({ isProxy: true, isHosting: true }).label).toBe(
      "Anonymizer",
    );
  });

  it("names hosting, mobile and residential from the geo flags", () => {
    expect(classifyIpLabel({ isHosting: true }).label).toBe("Hosting / Datacenter");
    expect(classifyIpLabel({ isMobile: true }).label).toBe("Mobile network");
    expect(classifyIpLabel({ country: "Thailand" }).label).toBe("Residential / Other");
  });

  it("says so when there is no geo context at all", () => {
    expect(classifyIpLabel(undefined).label).toBe("Unknown type");
  });
});

describe("classifyDomainLabel", () => {
  it("calls a domain under 30 days newly registered", () => {
    expect(classifyDomainLabel({ ageDays: 3 }, true).label).toBe("Newly registered");
  });

  it("calls a non-resolving domain parked", () => {
    expect(classifyDomainLabel({ ageDays: 4000 }, false).label).toBe("Inactive / parked");
  });

  it("calls a resolving, aged domain established", () => {
    const c = classifyDomainLabel({ ageDays: 4000 }, true);
    expect(c.label).toBe("Established");
    expect(c.desc).toContain("year");
  });

  it("falls back to Domain when the age is unknown", () => {
    expect(classifyDomainLabel({}, true).label).toBe("Domain");
  });
});

describe("classifyHashLabel", () => {
  it("prefers the malware family over the file type", () => {
    expect(classifyHashLabel({ malwareFamily: "Emotet", fileType: "exe" }, true).label).toBe(
      "Emotet",
    );
  });

  it("falls back to the file type, then to Unknown file", () => {
    expect(classifyHashLabel({ fileType: "PDF document" }, true).label).toBe("PDF document");
    expect(classifyHashLabel(undefined, false).label).toBe("Unknown file");
  });
});
