import { afterEach, describe, expect, it, vi } from "vitest";
import { censysErrorMessage, censysSource, isCensysQuota } from "./censys";
import { getJson } from "../http";

vi.mock("../http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http")>();
  return { ...actual, getJson: vi.fn() };
});


describe("censysErrorMessage", () => {
  it("surfaces the specific reason from the Platform errors[] envelope", () => {
    // Real 422 body when the account is out of query credits.
    const body = {
      title: "Unprocessable Entity",
      status: 422,
      detail: "Unprocessable Entity",
      errors: [{ message: "insufficient balance" }],
    };
    expect(censysErrorMessage(body, 422)).toBe("insufficient balance");
  });

  it("prefers a top-level error object's message/reason", () => {
    expect(
      censysErrorMessage({ error: { message: "invalid token" } }, 401),
    ).toBe("invalid token");
    expect(censysErrorMessage({ error: { reason: "Unauthorized" } }, 401)).toBe(
      "Unauthorized",
    );
  });

  it("handles a legacy string error field", () => {
    expect(censysErrorMessage({ error: "nope" }, 400)).toBe("nope");
  });

  it("falls back to detail, then title, then the HTTP status", () => {
    expect(censysErrorMessage({ detail: "Bad Request" }, 400)).toBe(
      "Bad Request",
    );
    expect(censysErrorMessage({ title: "Forbidden" }, 403)).toBe("Forbidden");
    expect(censysErrorMessage({}, 500)).toBe("HTTP 500");
    expect(censysErrorMessage(null, 502)).toBe("HTTP 502");
  });

  it("skips empty error messages and uses the next available field", () => {
    expect(
      censysErrorMessage({ errors: [{ message: "" }], detail: "Conflict" }, 409),
    ).toBe("Conflict");
  });
});

describe("isCensysQuota", () => {
  it("treats an insufficient-balance 422 as a quota state", () => {
    expect(isCensysQuota("insufficient balance", 422)).toBe(true);
  });

  it("treats a 429 as a quota state regardless of message", () => {
    expect(isCensysQuota("Too Many Requests", 429)).toBe(true);
    expect(isCensysQuota("HTTP 429", 429)).toBe(true);
  });

  it("matches generic limit/quota wording", () => {
    expect(isCensysQuota("rate limit exceeded", 200)).toBe(true);
    expect(isCensysQuota("monthly quota reached", 403)).toBe(true);
  });

  it("does not flag genuine errors", () => {
    expect(isCensysQuota("invalid token", 401)).toBe(false);
    expect(isCensysQuota("Unprocessable Entity", 422)).toBe(false);
    expect(isCensysQuota("HTTP 500", 500)).toBe(false);
  });
});

describe("censysSource.check", () => {
  const signal = new AbortController().signal;
  const reply = (data: unknown, status = 200) =>
    vi.mocked(getJson).mockResolvedValue({ ok: status < 400, status, data, text: "" });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getJson).mockReset();
  });

  it("is skipped without a token", async () => {
    vi.stubEnv("CENSYS_API_SECRET", "");
    expect(censysSource.isEnabled()).toBe(false);
    expect(await censysSource.check("1.2.3.4", signal)).toEqual({ status: "skipped" });
  });

  it("scores exposed services and risky labels", async () => {
    vi.stubEnv("CENSYS_API_SECRET", "t");
    expect(censysSource.isEnabled()).toBe(true);
    reply({
      result: {
        resource: {
          labels: [{ value: "remote_access" }, {}],
          services: [
            { port: 22, protocol: "SSH", labels: [{ value: "remote_access" }] },
            { port: 8080 },
            { protocol: "UNKNOWN" },
          ],
          autonomous_system: { asn: 64500, name: "EXAMPLE" },
          location: { country: "NL", city: "Amsterdam" },
        },
      },
    });
    const f = await censysSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({
      score: 34,
      categories: ["remote_access"],
      summary: "3 exposed services · remote_access",
      details: { ports: [22, 8080], services: ["22/SSH", "8080/?"], asn: 64500, city: "Amsterdam" },
    });
  });

  it("reports a host with no services", async () => {
    vi.stubEnv("CENSYS_API_SECRET", "t");
    reply({ result: { resource: {} } });
    const f = await censysSource.check("1.2.3.4", signal);
    expect(f).toMatchObject({ score: 0, summary: "No exposed services" });
  });

  it("maps 404, quota and plain errors", async () => {
    vi.stubEnv("CENSYS_API_SECRET", "t");
    reply(null, 404);
    expect((await censysSource.check("1.2.3.4", signal)).summary).toBe("Host not found in Censys");
    reply({ errors: [{ message: "insufficient balance" }] }, 422);
    expect(await censysSource.check("1.2.3.4", signal)).toEqual({
      status: "rate_limited",
      summary: "insufficient balance",
    });
    reply({ detail: "Unauthorized" }, 401);
    expect(await censysSource.check("1.2.3.4", signal)).toEqual({
      status: "error",
      error: "Unauthorized",
    });
    vi.mocked(getJson).mockRejectedValue(new DOMException("t", "TimeoutError"));
    expect((await censysSource.check("1.2.3.4", signal)).status).toBe("timeout");
    vi.mocked(getJson).mockRejectedValue(new Error("boom"));
    expect((await censysSource.check("1.2.3.4", signal)).error).toBe("boom");
  });
});
