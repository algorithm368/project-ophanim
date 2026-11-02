import { describe, expect, it } from "vitest";
import { domainParts, ipParts, subjectParts } from "./subject-parts";
import type { CheckResult, DomainCheckResult, HashCheckResult } from "./types";

const muted = (text: string) => ({ text, strong: false });
const strong = (text: string) => ({ text, strong: true });

describe("domainParts", () => {
  it("sets the registrable name strong and the labels above it muted", () => {
    expect(domainParts("mail.google.com")).toEqual([muted("mail."), strong("google.com")]);
  });

  it("puts the strong part on the real registrant of a lookalike, not the brand", () => {
    expect(domainParts("login.microsoftonline.com.secure-verify.xyz")).toEqual([
      muted("login.microsoftonline.com."),
      strong("secure-verify.xyz"),
    ]);
  });

  it("keeps a two-level public suffix inside the strong part", () => {
    expect(domainParts("www.bbc.co.uk")).toEqual([muted("www."), strong("bbc.co.uk")]);
  });

  it("sets an apex strong in full", () => {
    expect(domainParts("google.com")).toEqual([strong("google.com")]);
  });

  it("cuts the string as given, not the parser's lowercased copy", () => {
    expect(domainParts("Mail.Google.com")).toEqual([muted("Mail."), strong("Google.com")]);
  });

  it("stays plain when the parser's name is not the tail of the string", () => {
    expect(domainParts("localhost")).toEqual([muted("localhost")]);
    expect(domainParts("mail.google.com.")).toEqual([muted("mail.google.com.")]);
  });
});

describe("ipParts", () => {
  it("sets the last octet strong", () => {
    expect(ipParts("104.26.11.242")).toEqual([muted("104.26.11."), strong("242")]);
  });

  it("sets the last group of an IPv6 address strong", () => {
    expect(ipParts("2001:db8::1")).toEqual([muted("2001:db8::"), strong("1")]);
  });

  it("picks out the same octet in an IPv4-mapped address", () => {
    expect(ipParts("::ffff:1.2.3.4")).toEqual([muted("::ffff:1.2.3."), strong("4")]);
  });

  it("stays plain with no group to pick out", () => {
    expect(ipParts("2001:db8::")).toEqual([muted("2001:db8::")]);
    expect(ipParts("localhost")).toEqual([muted("localhost")]);
  });
});

describe("subjectParts", () => {
  it("keeps a file plain", () => {
    expect(subjectParts({ hash: "44d8", sources: [] } as unknown as HashCheckResult)).toEqual([muted("44d8")]);
  });

  it("cuts a domain at its registrable name", () => {
    const r = { domain: "mail.google.com", sources: [] } as unknown as DomainCheckResult;
    expect(subjectParts(r)).toEqual([muted("mail."), strong("google.com")]);
  });

  it("cuts an address at its last octet", () => {
    const r = { ip: "1.1.1.1", sources: [] } as unknown as CheckResult;
    expect(subjectParts(r)).toEqual([muted("1.1.1."), strong("1")]);
  });

  it("always joins back into the subject", () => {
    for (const s of ["mail.google.com", "google.com", "104.26.11.242", "2001:db8::1", "x"]) {
      expect(domainParts(s).map((p) => p.text).join("")).toBe(s);
      expect(ipParts(s).map((p) => p.text).join("")).toBe(s);
    }
  });
});
