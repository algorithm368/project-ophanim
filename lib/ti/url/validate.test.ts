import { describe, expect, it } from "vitest";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";

describe("urlIndicatorProblem", () => {
  it("accepts an ordinary URL", () => {
    expect(urlIndicatorProblem("https://evil.com/login?id=abc")).toBeNull();
  });

  it("accepts a URL carrying credentials, which is a finding not an error", () => {
    expect(urlIndicatorProblem("https://user:pass@evil.com/a")).toBeNull();
  });

  it("accepts a routable IP-literal URL", () => {
    expect(urlIndicatorProblem("http://185.220.101.1/admin")).toBeNull();
  });

  it.each([
    ["ftp://evil.com/a"],
    ["javascript:alert(1)"],
    ["not a url"],
  ])("rejects %s with 400", (input) => {
    expect(urlIndicatorProblem(input)?.status).toBe(400);
  });

  it("rejects a private address host with 422", () => {
    const problem = urlIndicatorProblem("http://192.168.1.1/admin")!;
    expect(problem.status).toBe(422);
    expect(problem.message).toMatch(/non-routable/i);
  });

  it("rejects a loopback host with 422", () => {
    expect(urlIndicatorProblem("http://127.0.0.1:3000/x")?.status).toBe(422);
  });

  it("rejects a reserved TLD host with 422 and keeps the scope note", () => {
    const problem = urlIndicatorProblem("https://foo.onion/a")!;
    expect(problem.status).toBe(422);
    expect(problem.scope).toBeTruthy();
  });

  it("rejects a URL over the length cap", () => {
    expect(
      urlIndicatorProblem(`https://evil.com/${"a".repeat(2100)}`)?.status,
    ).toBe(400);
  });
});
