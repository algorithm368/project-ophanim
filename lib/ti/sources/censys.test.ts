import { describe, expect, it } from "vitest";
import { censysErrorMessage, isCensysQuota } from "./censys";

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
