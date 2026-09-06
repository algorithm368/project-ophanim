import { describe, expect, it } from "vitest";
import {
  type CloudPrefix,
  extractAzureJsonUrl,
  inCidr,
  ipv4ToInt,
  matchPrefix,
  parseAws,
  parseAzure,
  parseCloudflare,
  parseGcp,
} from "@/lib/ti/cloud-ranges";

describe("ipv4ToInt", () => {
  it("converts a dotted quad", () => {
    expect(ipv4ToInt("0.0.0.0")).toBe(0);
    expect(ipv4ToInt("255.255.255.255")).toBe(4294967295);
    expect(ipv4ToInt("1.2.3.4")).toBe(16909060);
  });

  it("rejects anything that is not four plain octets", () => {
    expect(ipv4ToInt("1.2.3")).toBeNull();
    expect(ipv4ToInt("1.2.3.256")).toBeNull();
    expect(ipv4ToInt("1.2.3.4.5")).toBeNull();
    expect(ipv4ToInt("1.2.3.0x4")).toBeNull();
    expect(ipv4ToInt("2001:db8::1")).toBeNull();
  });
});

describe("inCidr", () => {
  it("matches inside and rejects outside", () => {
    expect(inCidr("71.6.146.185", "71.6.128.0/17")).toBe(true);
    expect(inCidr("71.6.127.255", "71.6.128.0/17")).toBe(false);
  });

  it("handles the /32 and /0 edges", () => {
    // A /0 mask would shift by 32, which is a no-op in JS rather than a wipe.
    expect(inCidr("3.4.12.4", "3.4.12.4/32")).toBe(true);
    expect(inCidr("3.4.12.5", "3.4.12.4/32")).toBe(false);
    expect(inCidr("8.8.8.8", "0.0.0.0/0")).toBe(true);
  });

  it("matches a high prefix without sign trouble", () => {
    // The 32-bit mask overflows a signed int without the >>> 0.
    expect(inCidr("200.0.0.1", "200.0.0.0/8")).toBe(true);
    expect(inCidr("199.255.255.255", "200.0.0.0/8")).toBe(false);
  });

  it("rejects a malformed block rather than matching everything", () => {
    expect(inCidr("1.2.3.4", "1.2.3.4")).toBe(false);
    expect(inCidr("1.2.3.4", "1.2.3.4/33")).toBe(false);
    expect(inCidr("1.2.3.4", "not-a-cidr/8")).toBe(false);
  });
});

describe("matchPrefix", () => {
  const prefixes: CloudPrefix[] = [
    { cidr: "3.0.0.0/8", provider: "Amazon Web Services" },
    { cidr: "3.4.12.0/24", provider: "Amazon Web Services", region: "eu-west-1", service: "EC2" },
    { cidr: "104.16.0.0/13", provider: "Cloudflare" },
  ];

  it("prefers the most specific block", () => {
    // AWS publishes a broad catch-all over the same space as its per-service
    // blocks, and the narrow one is the informative answer.
    expect(matchPrefix("3.4.12.7", prefixes)).toMatchObject({
      region: "eu-west-1",
      service: "EC2",
    });
  });

  it("falls back to the broad block when nothing narrower covers it", () => {
    expect(matchPrefix("3.200.1.1", prefixes)?.cidr).toBe("3.0.0.0/8");
  });

  it("returns undefined for an address in no published range", () => {
    expect(matchPrefix("8.8.8.8", prefixes)).toBeUndefined();
  });
});

describe("provider list parsing", () => {
  it("keeps AWS region and service, dropping the values that say nothing", () => {
    // "AMAZON" is the catch-all covering every other service, and "GLOBAL" is
    // not a region an analyst can act on.
    expect(
      parseAws({
        prefixes: [
          { ip_prefix: "3.4.12.4/32", region: "eu-west-1", service: "EC2" },
          { ip_prefix: "52.0.0.0/8", region: "GLOBAL", service: "AMAZON" },
        ],
      }),
    ).toEqual([
      { cidr: "3.4.12.4/32", provider: "Amazon Web Services", region: "eu-west-1", service: "EC2" },
      { cidr: "52.0.0.0/8", provider: "Amazon Web Services", region: undefined, service: undefined },
    ]);
  });

  it("reads GCP scopes as regions", () => {
    expect(
      parseGcp({
        prefixes: [
          { ipv4Prefix: "34.1.208.0/20", service: "Google Cloud", scope: "africa-south1" },
          { ipv4Prefix: "34.35.0.0/16", service: "Google Cloud", scope: "global" },
        ],
      }).map((p) => p.region),
    ).toEqual(["africa-south1", undefined]);
  });

  it("reads Cloudflare's plain text list and skips anything that is not a block", () => {
    expect(parseCloudflare("173.245.48.0/20\n\n103.21.244.0/22\ngarbage\n")).toEqual([
      { cidr: "173.245.48.0/20", provider: "Cloudflare" },
      { cidr: "103.21.244.0/22", provider: "Cloudflare" },
    ]);
  });

  it("survives an empty or malformed payload", () => {
    expect(parseAws({})).toEqual([]);
    expect(parseGcp({ prefixes: [{ service: "x" }] })).toEqual([]);
    expect(parseCloudflare("")).toEqual([]);
  });

  it("reads Azure service tags, dropping IPv6 and empty region/service", () => {
    expect(
      parseAzure({
        values: [
          {
            properties: {
              region: "eastus",
              systemService: "AzureStorage",
              addressPrefixes: ["20.60.0.0/16", "2603:1030::/48"],
            },
          },
          {
            // The umbrella tag and region-only breakdowns carry no service.
            properties: { region: "", systemService: "", addressPrefixes: ["4.0.0.0/8"] },
          },
        ],
      }),
    ).toEqual([
      { cidr: "20.60.0.0/16", provider: "Microsoft Azure", region: "eastus", service: "AzureStorage" },
      { cidr: "4.0.0.0/8", provider: "Microsoft Azure", region: undefined, service: undefined },
    ]);
  });

  it("survives an Azure payload with no values", () => {
    expect(parseAzure({})).toEqual([]);
  });
});

describe("extractAzureJsonUrl", () => {
  it("finds the dated download link in the confirmation page", () => {
    const html =
      '<a href="https://download.microsoft.com/download/7/1/d/71d/ServiceTags_Public_20260831.json">Download</a>';
    expect(extractAzureJsonUrl(html)).toBe(
      "https://download.microsoft.com/download/7/1/d/71d/ServiceTags_Public_20260831.json",
    );
  });

  it("returns undefined when the page carries no such link", () => {
    expect(extractAzureJsonUrl("<html>no link here</html>")).toBeUndefined();
  });
});
