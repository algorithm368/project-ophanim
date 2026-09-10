import { afterEach, describe, expect, it } from "vitest";
import { readScanCredentials } from "@/lib/ti/url/active/credentials";

const KEYS = [
  "URLSCAN_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

afterEach(() => setEnv({}));

describe("readScanCredentials", () => {
  it("reports nothing configured when no key is set", () => {
    setEnv({});
    expect(readScanCredentials()).toMatchObject({ any: false, cfReady: false });
  });

  it("counts urlscan alone as configured", () => {
    setEnv({ URLSCAN_API_KEY: "k" });
    expect(readScanCredentials()).toMatchObject({ any: true, cfReady: false });
  });

  // Cloudflare needs both halves. A token with no account id cannot submit, so
  // treating it as ready would offer a scan that always fails.
  it("does not count a half-configured Cloudflare", () => {
    setEnv({ CLOUDFLARE_API_TOKEN: "t" });
    expect(readScanCredentials()).toMatchObject({ any: false, cfReady: false });

    setEnv({ CLOUDFLARE_ACCOUNT_ID: "a" });
    expect(readScanCredentials()).toMatchObject({ any: false, cfReady: false });
  });

  it("counts a complete Cloudflare pair as configured", () => {
    setEnv({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" });
    expect(readScanCredentials()).toMatchObject({ any: true, cfReady: true });
  });

  it("reads the env on every call, not once at import", () => {
    setEnv({});
    expect(readScanCredentials().any).toBe(false);
    setEnv({ URLSCAN_API_KEY: "k" });
    expect(readScanCredentials().any).toBe(true);
  });
});
