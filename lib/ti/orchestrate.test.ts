import { describe, expect, it } from "vitest";
import { runSource } from "@/lib/ti/orchestrate";
import type { SourceFinding, TiSource } from "@/lib/ti/types";

/** A source whose check() returns a caller-supplied (possibly malformed) finding. */
function fakeSource(finding: unknown): TiSource {
  return {
    meta: {
      id: "fake",
      name: "Fake",
      url: "https://example.test",
      category: "reputation",
      requiresKey: false,
      weight: 1,
    },
    isEnabled: () => true,
    check: async () => finding as SourceFinding,
  };
}

describe("runSource error/summary coercion", () => {
  it("flattens a nested error envelope into its message string", async () => {
    // Censys returns `{ error: { code, status, reason, message } }` on a 401;
    // a stray object here would crash React ("Objects are not valid as a child").
    const result = await runSource(
      fakeSource({
        status: "error",
        error: {
          code: 401,
          status: "Unauthorized",
          reason: "Access token is not active",
          message: "Access credentials are invalid",
        },
      }),
      "8.8.8.8",
    );
    expect(result.error).toBe("Access credentials are invalid");
    expect(typeof result.error).toBe("string");
  });

  it("coerces an object summary to a string", async () => {
    const result = await runSource(
      fakeSource({ status: "rate_limited", summary: { message: "Quota hit" } }),
      "8.8.8.8",
    );
    expect(result.summary).toBe("Quota hit");
  });

  it("falls back to JSON when an object has no message field", async () => {
    const result = await runSource(
      fakeSource({ status: "error", error: { foo: "bar" } }),
      "8.8.8.8",
    );
    expect(result.error).toBe('{"foo":"bar"}');
  });

  it("leaves a plain string error untouched", async () => {
    const result = await runSource(
      fakeSource({ status: "error", error: "HTTP 500" }),
      "8.8.8.8",
    );
    expect(result.error).toBe("HTTP 500");
  });
});
