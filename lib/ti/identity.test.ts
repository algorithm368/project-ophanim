import { describe, expect, it } from "vitest";
import {
  asnLine,
  assignment,
  buildIdentity,
  caaIssuers,
  cleanAppName,
  countryName,
  listedAs,
  portList,
  signatureVital,
  splitAsn,
  typeWord,
  standing,
  type IdentityRecord,
} from "@/lib/ti/identity";
import type {
  CheckResult,
  DomainCheckResult,
  DomainContext,
  HashCheckResult,
  HashContext,
  SourceResult,
} from "@/lib/ti/types";
import { src, stats } from "@/lib/ti/subject-record.test";

const NOW = Date.UTC(2026, 8, 13, 12, 0, 0);

function ip(opts: Partial<CheckResult> & { sources?: SourceResult[] } = {}): CheckResult {
  return {
    ip: "185.220.101.47",
    scope: "public",
    verdict: "malicious",
    riskScore: 75,
    checkedAt: new Date(NOW).toISOString(),
    sources: [],
    stats: stats(0),
    ...opts,
  } as CheckResult;
}

function domain(ctx?: DomainContext, opts: Partial<DomainCheckResult> = {}): DomainCheckResult {
  return {
    domain: "example.test",
    verdict: "clean",
    riskScore: 0,
    checkedAt: new Date(NOW).toISOString(),
    sources: [],
    stats: stats(0),
    context: ctx,
    ...opts,
  } as DomainCheckResult;
}

function hash(ctx?: HashContext, sources: SourceResult[] = []): HashCheckResult {
  return {
    hash: "f5715822a11648fad7519ace3e9a1d0c",
    algorithm: "md5",
    verdict: "malicious",
    riskScore: 80,
    checkedAt: new Date(NOW).toISOString(),
    sources,
    stats: stats(0),
    context: ctx,
  } as HashCheckResult;
}

const find = (rec: IdentityRecord, key: string) => rec.fields.find((c) => c.key === key);
const keys = (rec: IdentityRecord) => rec.fields.map((c) => c.key);

/** A resolved geo field, shaped like `ResolvedField<string>`. */
function resolved(value: string, sources: string[]) {
  return { value, confidence: "high" as const, score: 1, agreement: 1, sources };
}

function geoRes(country: string, code: string, city?: string) {
  return {
    country: resolved(country, ["a"]),
    city: city ? resolved(city, ["a"]) : undefined,
    countryCode: code,
    providerCount: 9,
    flags: { isHosting: false, isProxy: false, isMobile: false, sources: {} },
  };
}

describe("the fixed list", () => {
  it("renders every field in the same order whether or not there is data", () => {
    // The order is the contract: the eye learns where a fact lives and stops
    // reading labels, which only holds if nothing ever moves or disappears.
    const empty = buildIdentity(ip());
    const full = buildIdentity(
      ip({
        geo: { reverse: "tor-exit-47.for-privacy.net", asn: "AS60729" },
        geoResolution: geoRes("Germany", "DE", "Berlin"),
        sources: [src({ id: "rdap-ip", details: { networkName: "TOR-EXIT" } })],
      }),
    );
    expect(keys(empty)).toEqual(keys(full));
    expect(empty.fields.length).toBeGreaterThan(15);
  });

  it("prints an absence rather than dropping the row", () => {
    // `assignment` is the one field that always answers: with nothing to read
    // it says "unclassified", which is a stated absence rather than a gap.
    const rec = buildIdentity(ip());
    const gaps = rec.fields.filter((c) => c.key !== "assignment");
    expect(gaps.every((c) => c.value === "none published")).toBe(true);
    expect(gaps.every((c) => c.absent)).toBe(true);
  });

  it("marks a present field as present", () => {
    const rec = buildIdentity(ip({ geo: { reverse: "dns.google" } }));
    expect(find(rec, "name")?.value).toBe("dns.google");
    expect(find(rec, "name")?.absent).toBeUndefined();
  });

  it("leads with what the thing is", () => {
    const rec = buildIdentity(
      ip({ sources: [src({ id: "tor-project", categories: ["tor-exit"], details: { role: "exit" } })] }),
    );
    expect(rec.kind).toBe("Tor exit node");
  });

  it("keeps behaviour out entirely", () => {
    // Listings, reports and feed history are the panel's, and have their own
    // section below this card.
    const rec = buildIdentity(
      ip({ sources: [src({ id: "abuseipdb", details: { totalReports: 159 } })] }),
    );
    expect(keys(rec)).not.toContain("reports");
    expect(keys(rec)).not.toContain("blocklists");
  });
});

describe("values are fragments", () => {
  it("never repeats the label back inside the value", () => {
    const rec = buildIdentity(
      ip({
        sources: [
          src({
            id: "rdap-ip",
            details: {
              networkName: "TOR-EXIT",
              range: ".32 to .63",
              registeredAt: "2011-06-02T00:00:00Z",
            },
          }),
        ],
      }),
    );
    expect(find(rec, "block")?.value).toBe("TOR-EXIT, .32 to .63");
    expect(find(rec, "allocated")?.value).toBe("2011-06-02");
  });

  it("shortens a value when a part is missing, leaving no dangling comma", () => {
    const rec = buildIdentity(ip({ sources: [src({ id: "rdap-ip", details: { networkName: "GOGL" } })] }));
    expect(find(rec, "block")?.value).toBe("GOGL");
  });
});

describe("the name check", () => {
  it("says plainly which way it went", () => {
    const good = buildIdentity(
      ip({ geo: { reverse: "dns.google", fcrdns: { hostname: "dns.google", verified: true } } }),
    );
    expect(find(good, "fcrdns")?.value).toBe("yes, points back");
    expect(find(good, "fcrdns")?.notable).toBeUndefined();
  });

  it("marks an unconfirmed name notable, which is the forged-PTR signal", () => {
    const bad = buildIdentity(
      ip({ geo: { reverse: "totally.legit", fcrdns: { hostname: "totally.legit", verified: false } } }),
    );
    expect(find(bad, "fcrdns")?.notable).toBe(true);
  });

  it("reads as absent when the check never ran", () => {
    expect(find(buildIdentity(ip({ geo: { reverse: "x.test" } })), "fcrdns")?.absent).toBe(true);
  });
});

describe("listedAs", () => {
  it("ranks a disowned netblock above everything else", () => {
    // DROP is the one nobody should miss, so it wins even when the address is
    // also a Tor exit.
    const value = listedAs(
      ip({
        sources: [
          src({ id: "tor-project", categories: ["tor-exit"] }),
          src({
            id: "spamhaus-drop",
            categories: ["spamhaus-drop", "criminal-netblock"],
            details: { cidr: "45.148.10.0/24" },
          }),
        ],
      }),
    );
    expect(value).toBe("disowned block, 45.148.10.0/24");
  });

  it("distinguishes an exit from a relay", () => {
    expect(listedAs(ip({ sources: [src({ id: "tor-project", categories: ["tor-exit"] })] }))).toBe(
      "Tor exit, by the Tor project",
    );
    expect(listedAs(ip({ sources: [src({ id: "tor-project", categories: ["tor-relay"] })] }))).toBe(
      "Tor relay, by the Tor project",
    );
  });

  it("falls through to RIOT, then to a research scanner", () => {
    expect(listedAs(ip({ sources: [src({ id: "greynoise", details: { riot: true, actor: "Google" } })] }))).toBe(
      "Google, common service infrastructure",
    );
    expect(listedAs(ip({ sources: [src({ id: "scanner-id", details: { operator: "Censys" } })] }))).toBe(
      "research scanner, Censys",
    );
  });

  it("answers nothing when no list names it", () => {
    expect(listedAs(ip({ sources: [src({ id: "greynoise", details: { riot: false } })] }))).toBeUndefined();
  });
});

describe("asnLine", () => {
  it("does not print the holder twice when the ASN already names it", () => {
    // ip-api returns asn as "AS60729 Stiftung Erneuerbare Freiheit" and asnOrg
    // as the same holder.
    expect(asnLine("AS60729 Stiftung Erneuerbare Freiheit", "Stiftung Erneuerbare Freiheit")).toBe(
      "AS60729 Stiftung Erneuerbare Freiheit",
    );
  });

  it("appends a holder the number does not already carry", () => {
    expect(asnLine("AS15169", "Google LLC")).toBe("AS15169 Google LLC");
    expect(asnLine("AS15169", undefined)).toBe("AS15169");
    expect(asnLine(undefined, "Google LLC")).toBeUndefined();
  });
});

describe("assignment", () => {
  it("prefers the most specific flag, and always answers", () => {
    expect(assignment(ip({ geo: { isProxy: true, isHosting: true } }))).toBe("anonymizing proxy or VPN");
    expect(assignment(ip({ geo: { isMobile: true, isHosting: true } }))).toBe("cellular carrier");
    expect(assignment(ip({ geo: { isHosting: true } }))).toBe("hosting or datacentre");
  });

  it("hedges rather than guessing when nothing classified the address", () => {
    // It used to answer "residential or business" here, which is a guess with
    // no provider behind it. Issue #10 made the narrative hedge on exactly this
    // input; the caption under the Type cell was still asserting.
    expect(assignment(ip())).toBe("unclassified");
  });

  it("says what the cell above it says, rather than re-deciding", () => {
    // The two used to read the geo flags separately, so a front door printed
    // "FRONT DOOR" with "hosting or datacentre" directly underneath.
    const front = ip({
      geo: { isHosting: true },
      sources: [
        src({ id: "reverse-ip", details: { domainCount: 500, atCeiling: true } }),
        src({ id: "cloud-range", details: { provider: "Cloudflare" } }),
      ],
    });
    expect(typeWord(front)).toBe("Front door");
    expect(assignment(front)).toBe("reverse proxy, more than 500 names");
  });
});

describe("country", () => {
  it("names the place and carries the flag", () => {
    const claim = find(buildIdentity(ip({ geoResolution: geoRes("Germany", "DE", "Berlin") })), "country");
    expect(claim?.value).toBe("Germany, Berlin");
    expect(claim?.countryCode).toBe("DE");
  });

  it("marks the registry country when it does not match the measured one", () => {
    const rec = buildIdentity(
      ip({
        geoResolution: geoRes("The Netherlands", "NL"),
        sources: [src({ id: "rdap-ip", details: { allocationCountry: "AD" } })],
      }),
    );
    // A reader should not have to know that AD is Andorra.
    expect(find(rec, "filed")?.value).toBe("Andorra");
    expect(find(rec, "filed")?.notable).toBe(true);
  });

  it("does not call a matching registry country a conflict", () => {
    const rec = buildIdentity(
      ip({
        geoResolution: geoRes("Germany", "de"),
        sources: [src({ id: "rdap-ip", details: { allocationCountry: "DE" } })],
      }),
    );
    expect(find(rec, "filed")?.notable).toBeUndefined();
  });
});

describe("countryName", () => {
  it("expands a code and passes a missing one through", () => {
    expect(countryName("de")).toBe("Germany");
    expect(countryName(undefined)).toBeUndefined();
  });
});

describe("portList", () => {
  it("sorts numerically and names the well-known services", () => {
    expect(portList([443, 22, 80])).toBe("22 SSH, 80 HTTP, 443 HTTPS");
  });

  it("prints an unknown port as its number", () => {
    expect(portList([64738])).toBe("64738");
  });
});

describe("the address list", () => {
  it("separates a scanned host with no open ports from one nobody scanned", () => {
    const scanned = buildIdentity(ip({ sources: [src({ id: "shodan-internetdb", details: { ports: [] } })] }));
    expect(find(scanned, "ports")?.value).toBe("none found");
    expect(find(buildIdentity(ip()), "ports")?.absent).toBe(true);
  });

  it("prints every port, since there is no fold to hide the tail in", () => {
    const rec = buildIdentity(
      ip({ sources: [src({ id: "shodan-internetdb", details: { ports: [80, 443, 8080, 8443, 2052] } })] }),
    );
    expect(find(rec, "ports")?.value).toBe("80 HTTP, 443 HTTPS, 2052, 8080 HTTP-alt, 8443 HTTPS-alt");
  });

  it("drops a provider row that only repeats the AS holder", () => {
    expect(find(buildIdentity(ip({ geo: { isp: "Google LLC", asnOrg: "google llc" } })), "isp")?.absent).toBe(
      true,
    );
    expect(find(buildIdentity(ip({ geo: { isp: "Reseller BV", asnOrg: "Upstream SA" } })), "isp")?.value).toBe(
      "Reseller BV",
    );
  });

  it("counts the neighbours", () => {
    const busy = buildIdentity(ip({ sources: [src({ id: "reverse-ip", details: { domainCount: 15 } })] }));
    expect(find(busy, "sharing")?.value).toBe("15 other names");
    const lone = buildIdentity(ip({ sources: [src({ id: "reverse-ip", details: { domainCount: 1 } })] }));
    expect(find(lone, "sharing")?.value).toBe("1 other name");
    expect(
      find(buildIdentity(ip({ sources: [src({ id: "reverse-ip", details: { domainCount: 0 } })] })), "sharing")
        ?.absent,
    ).toBe(true);
  });

  it("states the RPKI outcome rather than only the good one", () => {
    const valid = buildIdentity(
      ip({ sources: [src({ id: "ripestat", details: { prefix: "1.0.0.0/24", rpkiStatus: "valid" } })] }),
    );
    expect(find(valid, "prefix")?.value).toBe("1.0.0.0/24, RPKI valid");
    const invalid = buildIdentity(
      ip({ sources: [src({ id: "ripestat", details: { prefix: "1.0.0.0/24", rpkiStatus: "invalid" } })] }),
    );
    expect(find(invalid, "prefix")?.value).toBe("1.0.0.0/24, RPKI invalid");
  });
});

describe("standing", () => {
  it("names a status that means the domain is going away", () => {
    expect(standing(["clientTransferProhibited", "clientHold"])).toEqual({
      value: "suspended, will not resolve",
      grave: true,
    });
  });

  it("lists the routine locks without calling them grave", () => {
    expect(standing(["clientTransferProhibited"])).toEqual({
      value: "clientTransferProhibited",
      grave: false,
    });
  });

  it("answers nothing for no statuses at all", () => {
    expect(standing([])).toEqual({ value: undefined, grave: false });
  });
});

describe("caaIssuers", () => {
  it("takes the quoted authority out of a CAA line", () => {
    expect(caaIssuers(['0 issue "letsencrypt.org"', '0 issuewild "digicert.com"'])).toEqual([
      "letsencrypt.org",
      "digicert.com",
    ]);
  });
});

describe("cleanAppName", () => {
  it("drops Cloudflare's proxy instruction from the name", () => {
    expect(cleanAppName("GitHub (Do Not Inspect)")).toBe("GitHub");
  });

  it("leaves an ordinary name alone", () => {
    expect(cleanAppName("GoogleDNS")).toBe("GoogleDNS");
  });

  it("answers nothing for an empty or missing name", () => {
    expect(cleanAppName("(Do Not Inspect)")).toBeUndefined();
    expect(cleanAppName(undefined)).toBeUndefined();
  });
});

describe("domains", () => {
  it("fills the fixed list from registration and DNS", () => {
    const rec = buildIdentity(
      domain({
        registrar: "Example Registrar",
        createdAt: "2015-03-04T00:00:00Z",
        expiresAt: "2028-03-04T00:00:00Z",
        nameservers: ["ns1.test", "ns2.test"],
        resolvedIps: ["1.2.3.4"],
        dnssec: "signed",
        caa: ['0 issue "letsencrypt.org"'],
      }),
    );
    expect(find(rec, "registrar")?.value).toBe("Example Registrar");
    expect(find(rec, "created")?.value).toBe("2015-03-04");
    expect(find(rec, "expires")?.value).toBe("2028-03-04");
    expect(find(rec, "ns")?.value).toBe("ns1.test, ns2.test");
    expect(find(rec, "resolve")?.value).toBe("1.2.3.4");
    expect(find(rec, "dnssec")?.value).toBe("signed");
    expect(find(rec, "caa")?.value).toBe("letsencrypt.org");
  });

  it("leaves the dates to the timeline when asked", () => {
    const r = domain({
      registrar: "Example Registrar",
      createdAt: "2015-03-04T00:00:00Z",
      expiresAt: "2028-03-04T00:00:00Z",
    });
    const rec = buildIdentity(r, { omitDates: true });
    expect(find(rec, "created")).toBeUndefined();
    expect(find(rec, "expires")).toBeUndefined();
    expect(find(rec, "registrar")?.value).toBe("Example Registrar");
    expect(rec.fields).toHaveLength(buildIdentity(r).fields.length - 2);
  });

  it("states a name that does not resolve as a finding", () => {
    const claim = find(buildIdentity(domain({ nxdomain: true })), "resolve");
    expect(claim?.value).toBe("no such name");
    expect(claim?.notable).toBe(true);
  });

  it("treats an unknown DNSSEC posture as no answer", () => {
    expect(find(buildIdentity(domain({ dnssec: "unknown" })), "dnssec")?.absent).toBe(true);
  });

  it("reads the rank and the Cloudflare application", () => {
    const rec = buildIdentity(
      domain(undefined, {
        sources: [
          src({ id: "tranco", details: { rank: 1234 } }),
          src({ id: "cloudflare-intel", details: { application: "GitHub (Do Not Inspect)" } }),
        ],
      }),
    );
    expect(find(rec, "tranco")?.value).toBe("1,234");
    expect(find(rec, "application")?.value).toBe("GitHub");
  });

  it("counts certificates and names the issuer", () => {
    const rec = buildIdentity(
      domain(undefined, {
        certificates: [{ issuer: "GlobalSign", sans: [] }],
        subdomains: ["a.example.test", "b.example.test"],
      }),
    );
    expect(find(rec, "certs")?.value).toBe("1 in CT logs, GlobalSign");
    expect(find(rec, "subs")?.value).toBe("2");
  });
});

describe("files", () => {
  it("fills the fixed list from the file's own metadata", () => {
    const rec = buildIdentity(
      hash({
        fileNames: ["invoice.exe", "setup.exe"],
        fileType: "Win32 EXE",
        magic: "PE32 executable",
        fileSize: 68,
        malwareFamily: "Emotet",
        md5: "abc",
      }),
    );
    expect(find(rec, "names")?.value).toBe("invoice.exe, setup.exe");
    expect(find(rec, "format")?.value).toBe("Win32 EXE");
    expect(find(rec, "magic")?.value).toBe("PE32 executable");
    expect(find(rec, "family")?.value).toBe("Emotet");
    expect(find(rec, "md5")?.value).toBe("abc");
    expect(find(rec, "size")?.absent).toBeUndefined();
  });

  it("separates an unsigned file from one whose signature failed", () => {
    expect(find(buildIdentity(hash({ signed: true })), "signed")?.value).toBe("yes");
    const forged = find(buildIdentity(hash({ signer: "Acme Ltd", signed: false })), "signed");
    expect(forged?.value).toBe("no");
    expect(forged?.notable).toBe(true);
    // Unsigned with nothing claimed has no signature to check at all.
    expect(find(buildIdentity(hash({ signed: false })), "signed")?.absent).toBe(true);
  });

  it("groups a submission count so a seven-figure tally is readable", () => {
    // EICAR has been submitted over a million times; "1163351" is a wall.
    const rec = buildIdentity(hash({ firstSeen: "2006-05-22T00:00:00Z", timesSubmitted: 1163351 }));
    expect(find(rec, "first")?.value).toBe("2006-05-22");
    expect(find(rec, "submissions")?.value).toBe("1,163,351");
  });

  it("leaves first and last seen to the timeline when asked", () => {
    const rec = buildIdentity(
      hash({ firstSeen: "2006-05-22T00:00:00Z", lastSeen: "2026-01-01T00:00:00Z" }),
      { omitDates: true },
    );
    expect(find(rec, "first")).toBeUndefined();
    expect(find(rec, "last")).toBeUndefined();
  });

  it("names every YARA rule that matched, deduped", () => {
    const rec = buildIdentity(
      hash(undefined, [
        src({ id: "yaraify", details: { yaraRules: ["malw_eicar", "malw_eicar", "test_rule"] } }),
      ]),
    );
    expect(find(rec, "yara")?.value).toBe("malw_eicar, test_rule");
  });

  it("lists the imported libraries", () => {
    const rec = buildIdentity(hash({ importedDlls: [{ name: "KERNEL32.dll" }, { name: "WS2_32.dll" }] }));
    expect(find(rec, "imports")?.value).toBe("KERNEL32.dll, WS2_32.dll");
  });
});

// ------------------------------------------------------------ vitals

const vital = (rec: IdentityRecord, key: string) => rec.vitals.find((s) => s.key === key);
const slots = (rec: IdentityRecord) => rec.vitals.map((s) => s.key);

describe("splitAsn", () => {
  it("pulls the number out of ip-api's packed field", () => {
    // ip-api returns "AS48090 TECHOFF SRV LIMITED" in one string, and only the
    // number is short enough to be a headline.
    expect(splitAsn("AS48090 TECHOFF SRV LIMITED", undefined)).toEqual({
      number: "AS48090",
      holder: "TECHOFF SRV LIMITED",
    });
  });

  it("falls back to the separate org when the packed string is bare", () => {
    expect(splitAsn("AS15169", "Google LLC")).toEqual({
      number: "AS15169",
      holder: "Google LLC",
    });
  });

  it("reports no number when there is none to find", () => {
    expect(splitAsn(undefined, "Google LLC").number).toBeUndefined();
    expect(splitAsn("", undefined)).toEqual({ number: undefined, holder: undefined });
  });
});

describe("typeWord", () => {
  it("names the loudest kind of connection in one word", () => {
    expect(typeWord(ip({ geo: { isProxy: true, isHosting: true } }))).toBe("Anonymizer");
    expect(typeWord(ip({ geo: { isMobile: true, isHosting: true } }))).toBe("Mobile network");
    expect(typeWord(ip({ geo: { isHosting: true } }))).toBe("Hosting");
  });

  it("says unknown when nothing classified the address", () => {
    // It used to say "Residential" here, which is a guess wearing the clothes
    // of a fact: no geo provider answered, so nothing established that this is
    // an end-user line. The heading above this cell already said "Unknown
    // type" for the same input, and that was the honest half of the pair.
    expect(typeWord(ip())).toBe("Unknown");
  });

  it("reaches the evidence rungs, not just the geo flags", () => {
    expect(
      typeWord(
        ip({
          geo: { isHosting: true },
          sources: [
            src({ id: "reverse-ip", details: { domainCount: 500, atCeiling: true } }),
            src({ id: "cloud-range", details: { provider: "Cloudflare" } }),
          ],
        }),
      ),
    ).toBe("Front door");
  });
});

describe("signatureVital", () => {
  it("separates unsigned from a signature that does not check out", () => {
    // Opposite facts: one file nobody claims, one file claiming a publisher it
    // cannot prove.
    expect(signatureVital(true, "Microsoft Corporation")).toEqual({
      value: "Signed",
      sub: "Microsoft Corporation",
    });
    expect(signatureVital(false, "Acme Ltd")).toEqual({
      value: "Bad signature",
      sub: "claims Acme Ltd",
    });
    expect(signatureVital(false, undefined).value).toBe("Unsigned");
    expect(signatureVital(undefined, undefined).value).toBe("Unsigned");
  });
});

describe("the vitals strip", () => {
  it("keeps the same four slots in the same order whether or not there is data", () => {
    // The strip is read by position, so a missing fact has to hold its place.
    const empty = buildIdentity(ip());
    const full = buildIdentity(
      ip({
        geo: { reverse: "dns.google", asn: "AS15169 GOOGLE", isHosting: true },
        geoResolution: geoRes("United States", "US", "Mountain View"),
      }),
    );
    expect(slots(empty)).toEqual(["country", "prefix", "network", "name"]);
    expect(slots(empty)).toEqual(slots(full));
  });

  it("says what is missing in the slot's own words", () => {
    const rec = buildIdentity(ip());
    expect(vital(rec, "country")?.value).toBe("Not located");
    expect(vital(rec, "prefix")?.value).toBe("No prefix announced");
    expect(vital(rec, "network")?.value).toBe("No AS on record");
    expect(vital(rec, "name")?.value).toBe("No reverse name");
    expect(vital(rec, "country")?.absent).toBe(true);
  });

  describe("the prefix slot", () => {
    // It took the class's place once the class moved up to the hero headline.
    // The prefix is worth the slot because until now it existed only inside the
    // summary paragraph, where it cannot be scanned for.
    it("headlines the prefix and credits whoever announces it", () => {
      const rec = buildIdentity(
        ip({
          geo: { asn: "AS13335 Cloudflare, Inc." },
          sources: [src({ id: "ripestat", details: { prefix: "104.21.48.0/20", asns: [13335] } })],
        }),
      );
      expect(vital(rec, "prefix")?.value).toBe("104.21.48.0/20");
      expect(vital(rec, "prefix")?.sub).toBe("announced by AS13335");
    });

    it("prefers RIPEstat's announcing AS over the geo provider's holder", () => {
      // The party announcing a prefix is not always the org a geo provider
      // names for the address.
      const rec = buildIdentity(
        ip({
          geo: { asn: "AS13335 Cloudflare, Inc." },
          sources: [src({ id: "ripestat", details: { prefix: "45.148.10.0/24", asns: [207812] } })],
        }),
      );
      expect(vital(rec, "prefix")?.sub).toBe("announced by AS207812");
    });

    it("falls back to the geo provider's AS when RIPEstat lists none", () => {
      const rec = buildIdentity(
        ip({
          geo: { asn: "AS15169 GOOGLE" },
          sources: [src({ id: "ripestat", details: { prefix: "8.8.8.0/24", asns: [] } })],
        }),
      );
      expect(vital(rec, "prefix")?.sub).toBe("announced by AS15169");
    });

    it("holds its place when nothing announces the address", () => {
      expect(vital(buildIdentity(ip()), "prefix")?.absent).toBe(true);
    });
  });

  it("puts the city and a registry conflict under the country", () => {
    const rec = buildIdentity(
      ip({
        geoResolution: geoRes("The Netherlands", "NL", "Amsterdam"),
        sources: [src({ id: "rdap-ip", details: { allocationCountry: "AD" } })],
      }),
    );
    const country = vital(rec, "country");
    expect(country?.value).toBe("The Netherlands");
    expect(country?.sub).toBe("Amsterdam, registry says Andorra");
    expect(country?.countryCode).toBe("NL");
  });

  it("headlines the AS number and captions the holder", () => {
    const rec = buildIdentity(ip({ geo: { asn: "AS48090 TECHOFF SRV LIMITED" } }));
    expect(vital(rec, "network")?.value).toBe("AS48090");
    expect(vital(rec, "network")?.sub).toBe("TECHOFF SRV LIMITED");
  });

  it("says whether the reverse name survives a forward lookup", () => {
    const good = buildIdentity(
      ip({ geo: { reverse: "dns.google", fcrdns: { hostname: "dns.google", verified: true } } }),
    );
    expect(good.vitals[3]).toMatchObject({ value: "dns.google", sub: "points back" });
    const bad = buildIdentity(
      ip({ geo: { reverse: "claimed.test", fcrdns: { hostname: "claimed.test", verified: false } } }),
    );
    expect(bad.vitals[3].sub).toBe("does not point back");
  });

  it("gives a domain its own four slots", () => {
    const rec = buildIdentity(
      domain(
        {
          categories: ["Education & reference", "Reference materials"],
          registrar: "MarkMonitor Inc.",
          createdAt: "2001-01-13T00:00:00Z",
        },
        {
          geoResolution: geoRes("United States", "US", "San Francisco"),
          sources: [src({ id: "tranco", details: { rank: 30 } })],
        },
      ),
    );
    expect(slots(rec)).toEqual(["country", "category", "registrar", "reach"]);
    expect(vital(rec, "category")).toMatchObject({
      value: "Education & reference",
      sub: "Reference materials",
    });
    expect(vital(rec, "registrar")?.sub).toBe("registered 2001-01-13");
    expect(vital(rec, "reach")?.value).toBe("Rank 30");
  });

  it("calls an unranked domain unranked rather than unknown", () => {
    // Being outside the top million is a fact about the domain, not a gap in
    // what we asked.
    const rec = buildIdentity(domain({}));
    expect(vital(rec, "reach")).toMatchObject({
      value: "Unranked",
      sub: "outside the Tranco top million",
      absent: true,
    });
    expect(vital(rec, "category")?.value).toBe("Uncategorised");
  });

  it("keeps the registration date even when no registrar is on file", () => {
    const rec = buildIdentity(domain({ createdAt: "2024-06-01T00:00:00Z" }));
    expect(vital(rec, "registrar")).toMatchObject({
      value: "Not on file",
      sub: "registered 2024-06-01",
      absent: true,
    });
  });

  it("gives a hash its own four slots", () => {
    const rec = buildIdentity(
      hash({
        malwareFamily: "WannaCry",
        threatLabel: "ransomware.wannacry",
        firstSeen: "2017-05-12T00:00:00Z",
        lastSeen: "2026-09-01T00:00:00Z",
        fileType: "Win32 EXE",
        magic: "PE32 executable (GUI) Intel 80386",
        fileSize: 3_514_368,
        signed: false,
      }),
    );
    // The family headlines the hero now, so the freed slot carries first seen:
    // the fact that separates a sample the world met this morning from one it
    // has known for years, and which lived only in the ledger below.
    expect(slots(rec)).toEqual(["seen", "format", "size", "signature"]);
    expect(vital(rec, "seen")).toMatchObject({ value: "2017-05-12", sub: "last 2026-09-01" });
    expect(vital(rec, "size")).toMatchObject({ value: "3.4 MB", sub: "3,514,368 bytes" });
    expect(vital(rec, "signature")?.value).toBe("Unsigned");
  });

  it("never draws the signature slot as absent", () => {
    // "Unsigned" is what a missing signature means; drawing it quiet would say
    // the question was not asked.
    expect(vital(buildIdentity(hash({})), "signature")?.absent).toBeUndefined();
    expect(vital(buildIdentity(hash({})), "seen")?.value).toBe("Never recorded");
  });
});
