import * as tls from "node:tls";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { certNameCovers, certNames, tlsCertSource } from "./tls-cert";
import { resolveA } from "../../dns/doh";

// resolveA is imported by tls-cert.ts from a different module than it's
// defined in, so mocking it here (rather than dohQuery, which resolveA calls
// internally within doh.ts itself and would not be intercepted this way) is
// what actually takes effect.
vi.mock("../../dns/doh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../dns/doh")>();
  return { ...actual, resolveA: vi.fn() };
});
const mockResolveA = vi.mocked(resolveA);

class FakeSocket extends EventEmitter {
  authorized = true;
  destroyed = false;
  cert: Record<string, unknown> = {};
  getPeerCertificate() {
    return this.cert;
  }
  end() {}
  destroy() {
    this.destroyed = true;
  }
}

let fakeSocket: FakeSocket;
vi.mock("node:tls", () => ({
  connect: vi.fn(() => fakeSocket),
}));

const SIGNAL = new AbortController().signal;

/** check() awaits one DoH lookup before tls.connect() is ever called, so a
 *  test that emits a socket event right after calling check() would race an
 *  unattached listener. Wait for the (mocked) connect() call to land first. */
async function waitForConnect(): Promise<void> {
  await vi.waitFor(() => {
    expect(tls.connect).toHaveBeenCalled();
  });
}

describe("certNameCovers", () => {
  it("matches an exact name case-insensitively", () => {
    expect(certNameCovers("Example.com", "example.com")).toBe(true);
  });

  it("matches a single-label wildcard", () => {
    expect(certNameCovers("*.example.com", "www.example.com")).toBe(true);
  });

  it("does not let a wildcard cover a deeper subdomain", () => {
    expect(certNameCovers("*.example.com", "a.b.example.com")).toBe(false);
  });

  it("does not match an unrelated name", () => {
    expect(certNameCovers("example.net", "example.com")).toBe(false);
  });
});

describe("certNames", () => {
  it("collects the CN and every DNS SAN entry, deduped", () => {
    const names = certNames({
      subject: { CN: "example.com" },
      subjectaltname: "DNS:example.com, DNS:www.example.com, IP Address:1.2.3.4",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial PeerCertificate fixture
    } as any);
    expect(names.sort()).toEqual(["example.com", "www.example.com"]);
  });

  it("returns just the CN when there is no SAN", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial PeerCertificate fixture
    expect(certNames({ subject: { CN: "example.com" } } as any)).toEqual(["example.com"]);
  });
});

describe("tlsCertSource.check", () => {
  afterEach(() => {
    mockResolveA.mockReset();
    vi.mocked(tls.connect).mockClear();
  });

  it("reports no finding when the domain has no resolved IP", async () => {
    mockResolveA.mockResolvedValue([]);
    const f = await tlsCertSource.check("no-such.example", SIGNAL);
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
    expect(f.summary).toContain("No resolved IP");
  });

  it("does not score a certificate that covers the domain", async () => {
    mockResolveA.mockResolvedValue(["93.184.216.34"]);
    fakeSocket = new FakeSocket();
    fakeSocket.authorized = true;
    fakeSocket.cert = { subject: { CN: "example.com" }, issuer: { CN: "Some CA" } };
    const promise = tlsCertSource.check("example.com", SIGNAL);
    await waitForConnect();
    fakeSocket.emit("secureConnect");
    const f = await promise;
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
    expect(f.summary).toContain("covers example.com");
  });

  it("scores a certificate that does not cover the domain", async () => {
    mockResolveA.mockResolvedValue(["9.9.9.9"]);
    fakeSocket = new FakeSocket();
    fakeSocket.authorized = false;
    fakeSocket.cert = { subject: { CN: "totally-different.example" } };
    const promise = tlsCertSource.check("example.com", SIGNAL);
    await waitForConnect();
    fakeSocket.emit("secureConnect");
    const f = await promise;
    expect(f.status).toBe("ok");
    expect(f.score).toBe(55);
    expect(f.summary).toContain("does not cover example.com");
    expect(f.summary).toContain("totally-different.example");
  });

  it("treats a refused connection as no TLS service, not a finding", async () => {
    mockResolveA.mockResolvedValue(["93.184.216.34"]);
    fakeSocket = new FakeSocket();
    const promise = tlsCertSource.check("example.com", SIGNAL);
    await waitForConnect();
    fakeSocket.emit("error", new Error("ECONNREFUSED"));
    const f = await promise;
    expect(f.status).toBe("ok");
    expect(f.score).toBeUndefined();
    expect(f.summary).toContain("No TLS service");
  });

  it("reports timeout when the TLS handshake itself times out", async () => {
    mockResolveA.mockResolvedValue(["93.184.216.34"]);
    fakeSocket = new FakeSocket();
    const promise = tlsCertSource.check("example.com", SIGNAL);
    await waitForConnect();
    fakeSocket.emit("timeout");
    const f = await promise;
    expect(f.status).toBe("timeout");
  });
});
