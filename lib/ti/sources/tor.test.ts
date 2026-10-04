import { afterEach, describe, expect, it, vi } from "vitest";
import { hostMatches, torSource } from "./tor";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});

describe("hostMatches", () => {
  it("matches a bare IP exactly, not by prefix", () => {
    expect(hostMatches(["1.2.3.4"], "1.2.3.4")).toBe(true);
    // Onionoo search is a prefix match upstream, so 1.2.3.40 must not match 1.2.3.4.
    expect(hostMatches(["1.2.3.40"], "1.2.3.4")).toBe(false);
  });

  it("strips an IPv4 :port before comparing", () => {
    expect(hostMatches(["1.2.3.4:9001"], "1.2.3.4")).toBe(true);
  });

  it("ignores bracketed IPv6 entries", () => {
    expect(hostMatches(["[2001:db8::1]:443"], "2001:db8::1")).toBe(false);
  });

  it("scans the whole list", () => {
    expect(hostMatches(["9.9.9.9:443", "1.2.3.4:80"], "1.2.3.4")).toBe(true);
  });

  it("returns false for an undefined or empty list", () => {
    expect(hostMatches(undefined, "1.2.3.4")).toBe(false);
    expect(hostMatches([], "1.2.3.4")).toBe(false);
  });
});

describe("torSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, ok = true, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok, status, data, text: "" });
  afterEach(() => vi.mocked(getJson).mockReset());

  it("needs no key", () => expect(torSource.isEnabled()).toBe(true));

  it("names an exit node", async () => {
    reply({
      relays: [
        { nickname: "other", or_addresses: ["1.2.3.40:9001"] },
        {
          nickname: "exit1",
          flags: ["Exit", "Running"],
          exit_addresses: ["1.2.3.4"],
          country: "de",
          as_name: "Hetzner",
          last_seen: "2026-01-01",
        },
      ],
    });
    const f = await torSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({
      score: 50,
      categories: ["tor", "tor-exit"],
      summary: "Tor exit node (exit1)",
      lastSeen: "2026-01-01",
      details: { role: "exit", matchingRelays: 1 },
    });
  });

  it("scores a non-exit relay lower, nickname optional", async () => {
    reply({ relays: [{ or_addresses: ["1.2.3.4:443"] }] });
    const f = await torSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({
      score: 25,
      categories: ["tor", "tor-relay"],
      summary: "Tor relay, non-exit",
      details: { role: "relay" },
    });
  });

  it("reports a non-relay, including an empty answer", async () => {
    reply({});
    expect((await torSource.check("1.2.3.4", signal)).summary).toBe(
      "Not a Tor relay or exit node",
    );
  });

  it("surfaces HTTP failures, timeouts and errors", async () => {
    reply(null, false, 500);
    expect(await torSource.check("1.2.3.4", signal)).toEqual({
      status: "error",
      error: "HTTP 500",
    });
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await torSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await torSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
