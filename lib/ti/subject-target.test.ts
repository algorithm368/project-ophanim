import { describe, expect, it } from "vitest";
import { subjectTargetFor } from "@/lib/ti/subject-target";

describe("subjectTargetFor", () => {
  it("is the indicator itself for an ip or a domain", () => {
    expect(subjectTargetFor("8.8.8.8", "ip")).toEqual({
      subjectKind: "ip",
      subject: "8.8.8.8",
    });
    expect(subjectTargetFor("example.org", "domain")).toEqual({
      subjectKind: "domain",
      subject: "example.org",
    });
  });

  // The identity of a scanned URL is its host: /check has no reading of a path.
  it("reduces a url to its host", () => {
    expect(subjectTargetFor("https://evil.test/login", "url")).toEqual({
      subjectKind: "domain",
      subject: "evil.test",
      context: "/login",
    });
  });

  it("keeps the query in the scanned context", () => {
    expect(subjectTargetFor("https://evil.test/a?b=1", "url")).toEqual({
      subjectKind: "domain",
      subject: "evil.test",
      context: "/a?b=1",
    });
  });

  // A bare root URL has no path worth naming separately, and printing "/" as
  // "the scanned path" is noise.
  it("leaves the context unset for a root url", () => {
    expect(subjectTargetFor("https://evil.test/", "url")).toEqual({
      subjectKind: "domain",
      subject: "evil.test",
      context: undefined,
    });
  });

  // An IP-hosted URL's subject is an IP, so it must reach /api/check rather
  // than /api/check-domain, which would refuse it.
  it("resolves an ip-literal host to the ip subject", () => {
    expect(subjectTargetFor("http://185.220.101.1/x", "url")).toEqual({
      subjectKind: "ip",
      subject: "185.220.101.1",
      context: "/x",
    });
  });

  it("has no subject for a hash", () => {
    expect(subjectTargetFor("44d88612fea8a8f36de82e1278abb02f", "hash")).toBe(
      null,
    );
  });

  it("has no subject for a url that will not parse", () => {
    expect(subjectTargetFor("http://", "url")).toBe(null);
  });
});
