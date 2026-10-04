import { describe, expect, it } from "vitest";
import {
  classifyDomainLabel,
  classifyHashLabel,
  classifyIpLabel,
  contentCategory,
  domainEvidence,
  hashEvidence,
  ipEvidence,
} from "@/lib/ti/indicator-class";
import { src } from "@/lib/ti/subject-record.test";

describe("classifyIpLabel", () => {
  it("reads the proxy flag before the hosting flag", () => {
    // A VPN endpoint in a datacentre sets both; "Anonymizer" is the more
    // specific claim and the one an analyst acts on.
    expect(classifyIpLabel({ geo: { isProxy: true, isHosting: true } }).label).toBe(
      "Anonymizer",
    );
  });

  it("calls a listed Tor relay a Tor node, ahead of the proxy and hosting flags", () => {
    const exit = classifyIpLabel({ tor: "exit", geo: { isProxy: true, isHosting: true } });
    expect(exit.label).toBe("Tor node");
    expect(exit.caption).toBe("Tor exit node");
    expect(exit.phrase).toBe("a Tor exit node on hosting/datacenter infrastructure");
    expect(exit.sources).toEqual(["tor relay list"]);
    const relay = classifyIpLabel({ tor: "relay" });
    expect(relay.caption).toBe("Tor relay, non-exit");
    expect(relay.tail).toBe("");
  });

  it("reads the Tor role from the relay list, and nothing from a role it does not know", () => {
    const role = (r: unknown) =>
      ipEvidence(undefined, [src({ id: "tor-project", details: { role: r } })]).tor;
    expect(role("exit")).toBe("exit");
    expect(role("relay")).toBe("relay");
    expect(role("bridge")).toBeUndefined();
  });

  it("names hosting, mobile and residential from the geo flags", () => {
    expect(classifyIpLabel({ geo: { isHosting: true } }).label).toBe(
      "Hosting / Datacenter",
    );
    expect(classifyIpLabel({ geo: { isMobile: true } }).label).toBe("Mobile network");
    expect(classifyIpLabel({ geo: { country: "Thailand" } }).label).toBe(
      "Residential / Other",
    );
  });

  it("says so when there is no geo context at all", () => {
    expect(classifyIpLabel().label).toBe("Unknown type");
    expect(classifyIpLabel().sources).toEqual([]);
  });

  describe("front door", () => {
    // 104.21.48.41, the address that started this: Cloudflare anycast, no PTR,
    // and a reverse-IP lookup that stopped counting at its own ceiling.
    const anycast = {
      geo: { isHosting: true },
      tenancy: { count: 500, atCeiling: true },
      cloud: "Cloudflare",
      networkClass: "Content",
    };

    it("outranks cloud host, which is also true of it", () => {
      expect(classifyIpLabel(anycast).label).toBe("Front door");
    });

    it("says the count is a floor rather than a measurement", () => {
      expect(classifyIpLabel(anycast).desc).toContain("More than 500 names");
    });

    it("says the address is not the subject", () => {
      expect(classifyIpLabel(anycast).desc).toContain("the name is the subject");
    });

    it("takes a crowded Content network with no cloud range", () => {
      expect(
        classifyIpLabel({
          tenancy: { count: 240, atCeiling: false },
          networkClass: "Content",
        }).desc,
      ).toContain("240 names");
    });

    it("declines when the reverse name forward-confirms, however crowded", () => {
      // A box that answers to its own name is a host with tenants, not a wall.
      expect(
        classifyIpLabel({
          ...anycast,
          ptr: { hostname: "web01.example.net", forwardConfirmed: true },
        }).label,
      ).toBe("Cloud host");
    });

    it("declines on co-tenancy alone, with nothing saying reverse proxy", () => {
      expect(
        classifyIpLabel({
          geo: { isHosting: true },
          tenancy: { count: 500, atCeiling: true },
        }).label,
      ).toBe("Shared host");
    });
  });

  describe("infrastructure", () => {
    it("reads the job out of the reverse name", () => {
      expect(classifyIpLabel({ ptr: { hostname: "ns1.example.net" } }).label).toBe(
        "Infrastructure",
      );
      expect(classifyIpLabel({ ptr: { hostname: "mx2.example.net" } }).desc).toContain(
        "a mail relay",
      );
      expect(
        classifyIpLabel({ ptr: { hostname: "sinkhole.example.net" } }).desc,
      ).toContain("a sinkhole");
    });

    it("takes the first role a name states, not the last", () => {
      expect(classifyIpLabel({ ptr: { hostname: "ns1.mail.example.net" } }).desc).toContain(
        "a DNS resolver",
      );
    });

    it("reads it from the ports when the web ports are shut", () => {
      expect(classifyIpLabel({ ports: [53] }).desc).toContain("a DNS resolver");
      expect(classifyIpLabel({ ports: [25, 587] }).desc).toContain("a mail relay");
    });

    it("declines on a port set that states no job", () => {
      expect(classifyIpLabel({ ports: [22], geo: { isHosting: true } }).label).toBe(
        "Hosting / Datacenter",
      );
    });

    it("does not, when the box also serves the web", () => {
      // 53 and 443 together is a website that happens to resolve, and the
      // website is the part a reader came for.
      expect(classifyIpLabel({ ports: [53, 443], geo: { isHosting: true } }).label).toBe(
        "Hosting / Datacenter",
      );
    });

    it("outranks cloud host, since the job is the more specific claim", () => {
      expect(classifyIpLabel({ cloud: "AWS", ptr: { hostname: "ns1.aws.test" } }).label).toBe(
        "Infrastructure",
      );
    });
  });

  it("calls a published cloud range a cloud host, and says reputation ages out", () => {
    const cls = classifyIpLabel({ cloud: "Amazon Web Services", geo: { isHosting: true } });
    expect(cls.label).toBe("Cloud host");
    expect(cls.desc).toContain("ages out in days");
  });

  it("calls a landlord a shared host once enough names answer", () => {
    expect(
      classifyIpLabel({ tenancy: { count: 12, atCeiling: false }, geo: { isHosting: true } })
        .label,
    ).toBe("Shared host");
    // Four neighbours is a box with a few names on it, not a landlord.
    expect(
      classifyIpLabel({ tenancy: { count: 4, atCeiling: false }, geo: { isHosting: true } })
        .label,
    ).toBe("Hosting / Datacenter");
  });

  it("calls an enterprise network a corporate egress", () => {
    const cls = classifyIpLabel({ networkClass: "Enterprise", geo: { country: "Thailand" } });
    expect(cls.label).toBe("Corporate network");
    expect(cls.desc).toContain("organisation's egress");
  });

  describe("single host", () => {
    it("is what a forward-confirmed name on a quiet address means", () => {
      const cls = classifyIpLabel({
        geo: { isHosting: true },
        ptr: { hostname: "mail01.example.net", forwardConfirmed: true },
        tenancy: { count: 1, atCeiling: false },
      });
      // "mail01" is not "mail." — the infra pattern wants a separator, so this
      // reaches the rung it should.
      expect(cls.label).toBe("Single host");
      expect(cls.desc).toContain("mail01.example.net");
    });

    it("never claims a consumer line, whose dynamic PTR confirms just as well", () => {
      // This is the guard that matters: "the score is about this machine" is
      // exactly the wrong thing to say about a lease.
      expect(
        classifyIpLabel({
          geo: { isMobile: true },
          ptr: { hostname: "ppp-1-2-3-4.isp.example", forwardConfirmed: true },
        }).label,
      ).toBe("Mobile network");
    });

    it("is vetoed by the mobile flag even when hosting is set alongside it", () => {
      expect(
        classifyIpLabel({
          geo: { isMobile: true, isHosting: true },
          ptr: { hostname: "ppp-1-2-3-4.isp.example", forwardConfirmed: true },
        }).label,
      ).toBe("Mobile network");
    });
  });

  it("puts mobile above the bare hosting flag when a carrier range sets both", () => {
    // The two functions that used to answer this read the same booleans in
    // opposite orders, so this case came out "Mobile" in one place and
    // "Hosting / Datacenter" in the other. Mobile is the claim with
    // consequences, so it is the one that survived.
    expect(classifyIpLabel({ geo: { isMobile: true, isHosting: true } }).label).toBe(
      "Mobile network",
    );
  });

  it("warns that an end-user address identifies a lease, not a device", () => {
    expect(classifyIpLabel({ geo: { isMobile: true } }).desc).toContain("lease");
    expect(classifyIpLabel({ geo: { country: "Thailand" } }).desc).toContain("lease");
  });

  it("names what decided, rather than assuming the geo flags did", () => {
    expect(
      classifyIpLabel({ tenancy: { count: 500, atCeiling: true }, cloud: "Cloudflare" })
        .sources,
    ).toEqual(["co-tenancy", "cloud range"]);
    expect(classifyIpLabel({ geo: { isMobile: true } }).sources).toEqual(["geo flags"]);
  });

  it("keeps the short form and the label in step", () => {
    expect(classifyIpLabel({ cloud: "AWS" }).short).toBe("Cloud");
    expect(classifyIpLabel({ networkClass: "Enterprise" }).short).toBe("Corporate");
    expect(classifyIpLabel().short).toBe("Unknown");
  });
});

describe("ipEvidence", () => {
  it("carries the ceiling through, so a floor is not read as a count", () => {
    const ev = ipEvidence(undefined, [
      src({ id: "reverse-ip", details: { domainCount: 500, atCeiling: true } }),
    ]);
    expect(ev.tenancy).toEqual({ count: 500, atCeiling: true });
  });

  it("reads a real count as a real count", () => {
    const ev = ipEvidence(undefined, [src({ id: "reverse-ip", details: { domainCount: 12 } })]);
    expect(ev.tenancy).toEqual({ count: 12, atCeiling: false });
  });

  it("leaves tenancy unset when the lookup did not answer", () => {
    // Rate-limited is not zero tenants, and the classifier must not read it as
    // a quiet address.
    expect(ipEvidence(undefined, []).tenancy).toBeUndefined();
  });

  it("gathers the rest of the ladder's inputs", () => {
    const ev = ipEvidence({ isHosting: true }, [
      src({ id: "reverse-dns", details: { hostname: "ns1.example.net", forwardConfirmed: true } }),
      src({ id: "peeringdb", details: { networkClass: "Content" } }),
      src({ id: "cloud-range", details: { provider: "Cloudflare" } }),
      src({ id: "shodan-internetdb", details: { ports: [80, 443] } }),
      src({ id: "tor-project", details: { role: "exit" } }),
    ]);
    expect(ev.ptr).toEqual({ hostname: "ns1.example.net", forwardConfirmed: true });
    expect(ev.networkClass).toBe("Content");
    expect(ev.cloud).toBe("Cloudflare");
    expect(ev.ports).toEqual([80, 443]);
    expect(ev.tor).toBe("exit");
  });

  it("reads Tor from the role field, not from the score", () => {
    // The source scores 0 either way for a non-node, so only `role` separates
    // "not a relay" from "a relay we declined to score".
    expect(ipEvidence(undefined, [src({ id: "tor-project", details: {} })]).tor).toBeUndefined();
  });

  it("ignores a source that did not come back ok", () => {
    const failed = src({
      id: "reverse-ip",
      status: "rate_limited",
      details: { domainCount: 9 },
    });
    expect(ipEvidence(undefined, [failed]).tenancy).toBeUndefined();
  });
});

describe("classifyDomainLabel", () => {
  it("calls a domain under 30 days newly registered", () => {
    const c = classifyDomainLabel({ ctx: { ageDays: 3 } });
    expect(c.label).toBe("Newly registered");
    expect(c.caption).toBe("registered 3 days ago");
  });

  it("calls a resolving, aged domain established, and names its rank", () => {
    const c = classifyDomainLabel({ ctx: { ageDays: 4000 }, rank: 29 });
    expect(c.label).toBe("Established");
    expect(c.caption).toBe("registered 10 years ago, Tranco rank 29");
  });

  it("falls back to Domain when the age is unknown", () => {
    expect(classifyDomainLabel().label).toBe("Domain");
  });

  describe("dead name", () => {
    // manage.logistics.arinesolutions.com: a subdomain that served a page, got
    // a certificate, and is now gone. Every feed comes back clean about it.
    it("outranks every other rung, however old the registration", () => {
      const c = classifyDomainLabel({ ctx: { nxdomain: true, ageDays: 4713 } });
      expect(c.label).toBe("Dead name");
      expect(c.caption).toBe("nothing answers for this name");
    });

    it("says an empty result is not a clean one", () => {
      expect(classifyDomainLabel({ ctx: { nxdomain: true } }).tail).toContain(
        "absence of evidence",
      );
    });
  });

  describe("free subdomain", () => {
    // RDAP answers for the service, so a label handed out this morning inherits
    // the service's registration date. That is worse than having no age: it
    // asserts a history the label does not have.
    it("outranks the age rungs, whose answer belongs to the service", () => {
      const c = classifyDomainLabel({
        name: "ggz.pm2jsux6ed.workers.dev",
        registrable: "workers.dev",
        ctx: { ageDays: 2800 },
      });
      expect(c.label).toBe("Free subdomain");
      expect(c.caption).toBe("anyone can take a name under workers.dev");
    });

    it("does not fire on the service's own apex", () => {
      expect(
        classifyDomainLabel({
          name: "workers.dev",
          registrable: "workers.dev",
          ctx: { ageDays: 2800 },
        }).label,
      ).toBe("Established");
    });

    it("does not fire on an ordinary name", () => {
      expect(
        classifyDomainLabel({
          name: "mail.github.com",
          registrable: "github.com",
          ctx: { ageDays: 6900 },
        }).label,
      ).toBe("Established");
    });
  });

  it("calls a registrar-held name parked, and names the holder", () => {
    // arinesolutions.com: registered 2013 at GoDaddy, sitting on Hostinger's
    // parking nameservers today.
    const c = classifyDomainLabel({
      ctx: { ageDays: 4713, nameservers: ["ns1.dns-parking.com", "ns2.dns-parking.com"] },
    });
    expect(c.label).toBe("Parked");
    expect(c.caption).toContain("ns1.dns-parking.com");
  });

  describe("content category", () => {
    // pornhub.com came back "Behind a proxy" while every source on the page
    // knew it was pornography, because the ladder only asked how much identity
    // the name had and never what the site was.
    it("is what a live ordinary name is, and outranks the rest", () => {
      const c = classifyDomainLabel({
        ctx: {
          ageDays: 9449,
          categories: ["CIPA Filter", "Pornography", "CIPA", "Adult Themes"],
        },
        cloud: "Cloudflare",
      });
      expect(c.short).toBe("Pornography");
      expect(c.caption).toBe("adult themes");
    });

    it("skips the filter-list names Cloudflare mixes in", () => {
      // "CIPA Filter" is a US school-filtering statute, not a description of a
      // site, and it sorts first.
      expect(contentCategory(["CIPA Filter", "Pornography", "CIPA"])).toBe("Pornography");
      expect(contentCategory(["Security Threats", "Technology"])).toBe("Technology");
      expect(contentCategory(["CIPA"])).toBeUndefined();
      expect(contentCategory(undefined)).toBeUndefined();
    });

    it("loses to every rung that says not to trust the category", () => {
      const cats = ["Technology"];
      expect(classifyDomainLabel({ ctx: { nxdomain: true, categories: cats } }).short).toBe(
        "Dead name",
      );
      expect(classifyDomainLabel({ ctx: { ageDays: 2, categories: cats } }).short).toBe(
        "Newly registered",
      );
      expect(
        classifyDomainLabel({ ctx: { categories: cats, nameservers: ["a.bodis.com"] } }).short,
      ).toBe("Parked");
    });
  });

  it("says when the address a name resolves to is a front door", () => {
    const c = classifyDomainLabel({ ctx: { ageDays: 4000 }, cloud: "Cloudflare" });
    expect(c.label).toBe("Behind a proxy");
    expect(c.tail).toContain("front door");
  });

  it("names what decided, rather than assuming the registration age did", () => {
    expect(classifyDomainLabel({ ctx: { nxdomain: true } }).sources).toEqual(["dns"]);
    expect(
      classifyDomainLabel({ ctx: { ageDays: 4000, nameservers: ["a.bodis.com"] } }).sources,
    ).toEqual(["nameservers"]);
  });
});

describe("domainEvidence", () => {
  it("gathers the name, its registrable part, the rank and the range", () => {
    const ev = domainEvidence("WWW.Example.COM", "Example.com", { ageDays: 9 }, [
      src({ id: "tranco", details: { rank: 29 } }),
      src({ id: "cloud-range", details: { provider: "Cloudflare" } }),
    ]);
    // Lowercased on the way in, so the free-subdomain set never misses on case.
    expect(ev.name).toBe("www.example.com");
    expect(ev.registrable).toBe("example.com");
    expect(ev.rank).toBe(29);
    expect(ev.cloud).toBe("Cloudflare");
  });
});

describe("classifyHashLabel", () => {
  it("headlines what kind of dangerous, and captions which strain", () => {
    // The family used to be the headline, so a sample came up "WannaCry" and a
    // reader who did not already know the name learned nothing from the
    // biggest text on the page.
    const c = classifyHashLabel({
      threat: "ransomware",
      ctx: { malwareFamily: "WannaCry", fileType: "Win32 EXE", fileName: "important.exe" },
    });
    expect(c.short).toBe("Ransomware");
    expect(c.caption).toBe('WannaCry, Win32 EXE, seen as "important.exe"');
  });

  it("outranks the file type, which answers a different question", () => {
    expect(classifyHashLabel({ threat: "phishing", ctx: { fileType: "HTML" } }).short).toBe(
      "Phishing",
    );
  });

  it("calls a file dangerous when engines flag it and none says what kind", () => {
    const c = classifyHashLabel({
      ctx: { fileType: "Win32 EXE", detectionRatio: { malicious: 61, total: 72 } },
    });
    expect(c.short).toBe("Dangerous file");
    expect(c.caption).toBe("61 of 72 engines flag it, Win32 EXE");
  });

  it("calls a file nobody flags an ordinary one", () => {
    const c = classifyHashLabel({
      ctx: { fileType: "Win32 EXE", detectionRatio: { malicious: 0, total: 72 } },
    });
    expect(c.short).toBe("Ordinary file");
    expect(c.caption).toBe("Win32 EXE");
  });

  it("names the publisher of a signed file", () => {
    const c = classifyHashLabel({ ctx: { signed: true, signer: "Microsoft Corporation" } });
    expect(c.label).toBe("Signed file");
    expect(c.caption).toBe("signed by Microsoft Corporation");
  });

  it("says outright when nobody has ever seen the file", () => {
    // The most common hash result and the most misread: no record is not a
    // clean bill of health.
    const c = classifyHashLabel({ known: false });
    expect(c.short).toBe("Never seen");
    expect(c.tail).toContain("nothing here is a verdict either way");
    expect(c.sources).toEqual([]);
  });

  it("keeps the file type as the record's label, under an ordinary headline", () => {
    // The class label still feeds the subject record's "this is a" claim, where
    // "PDF document" is the right answer; only the headline says "Ordinary".
    const c = classifyHashLabel({ ctx: { fileType: "PDF document" }, known: true });
    expect(c.label).toBe("PDF document");
    expect(c.short).toBe("Ordinary file");
  });

  it("calls it just File when something answered but named neither a family nor a type", () => {
    const c = classifyHashLabel({ known: true });
    expect(c.label).toBe("File");
    expect(c.sources).toEqual(["file metadata"]);
  });
});

describe("hashEvidence", () => {
  it("counts a scored source as somebody having seen the file", () => {
    expect(hashEvidence(undefined, [src({ id: "virustotal", score: 0 })]).known).toBe(true);
    expect(hashEvidence(undefined, [src({ id: "virustotal", status: "error" })]).known).toBe(
      false,
    );
    // Answered without a score is not a sighting either.
    expect(hashEvidence(undefined, [src({ id: "malpedia" })]).known).toBe(false);
  });
});

describe("indicator-class — remaining wording", () => {
  it("names a single host by its reverse name, or generically", () => {
    const geo = { isHosting: true };
    expect(classifyIpLabel({ geo, ptr: { forwardConfirmed: true, hostname: "a.test" } }).desc).toMatch(/^a\.test forward-confirms/);
    expect(classifyIpLabel({ geo, ptr: { forwardConfirmed: true } }).desc).toMatch(/^The reverse name forward-confirms/);
    // A crowd on the address makes it a shared host before it can be a single one.
    expect(
      classifyIpLabel({ geo, ptr: { forwardConfirmed: true }, tenancy: { count: 5, atCeiling: false } }).label,
    ).toBe("Shared host");
  });

  it("says one day for a domain registered yesterday", () => {
    expect(classifyDomainLabel({ ctx: { ageDays: 1 } }).caption).toBe("registered 1 day ago");
  });

  it("falls back to a generic caption for a lone category", () => {
    expect(classifyDomainLabel({ ctx: { categories: ["Technology"], ageDays: 400 } }).caption).toBe(
      "categorised content",
    );
  });

  it("dates an established domain under a year, one year, and several", () => {
    expect(classifyDomainLabel({ ctx: { ageDays: 200 } })).toMatchObject({
      caption: "registered under a year ago",
      desc: "Registered under a year ago.",
    });
    expect(classifyDomainLabel({ ctx: { ageDays: 400 } }).caption).toBe("registered 1 year ago");
  });

  it("describes an ordinary file without a name, and a known file with no metadata", () => {
    expect(classifyHashLabel({ known: true, ctx: { fileType: "PE32" } }).desc).toBe(
      "Known file, no malware family attributed.",
    );
    expect(classifyHashLabel({ known: true }).sources).toEqual(["file metadata"]);
  });
});

describe("indicator-class — anonymizers and named files", () => {
  it("places an anonymizer on hosting infrastructure when it is there", () => {
    expect(classifyIpLabel({ geo: { isProxy: true, isHosting: true } }).phrase).toMatch(/hosting\/datacenter/);
    expect(classifyIpLabel({ geo: { isProxy: true } }).phrase).toBe("an anonymizer (proxy or VPN)");
  });

  it("quotes the name an ordinary file was seen as", () => {
    expect(classifyHashLabel({ known: true, ctx: { fileType: "PE32", fileName: "a.exe" } }).desc).toBe(
      'Seen as "a.exe".',
    );
  });
});
