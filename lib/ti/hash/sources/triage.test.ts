import { describe, expect, it } from "vitest";
import { bareHost } from "./triage";

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
