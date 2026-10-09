import { beforeEach, describe, expect, it, vi } from "vitest";

// `requireSession` imports `@/auth` lazily, and `@/auth` boots Auth.js, which
// reaches for `next/server` and does not resolve under Vitest. Mocking the
// module keeps this a pure unit test: what is under test is the decision, not
// Auth.js's session parsing.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));

const { requireSession, requireSessionUser } = await import("@/lib/require-session");

describe("requireSession", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("lets a signed-in caller through", async () => {
    authMock.mockResolvedValue({ user: { email: "someone@example.com" } });
    expect(await requireSession()).toBeNull();
  });

  it("refuses when there is no session at all", async () => {
    authMock.mockResolvedValue(null);

    const refusal = await requireSession();
    expect(refusal).toBeInstanceOf(Response);
    expect(refusal?.status).toBe(401);
    await expect(refusal?.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  // A session object with no user is not a signed-in caller. Checking only for
  // the session's presence would let this through.
  it("refuses a session carrying no user", async () => {
    authMock.mockResolvedValue({});
    expect((await requireSession())?.status).toBe(401);
  });
});

describe("requireSession under next dev", () => {
  it("waves every caller through, as the proxy does", async () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      expect(await requireSession()).toBeNull();
      expect(authMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("requireSessionUser", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("hands back the signed-in user's email", async () => {
    authMock.mockResolvedValueOnce({ user: { email: "me@x.com" } });
    expect(await requireSessionUser()).toEqual({ email: "me@x.com" });
  });
  it("refuses a session with no email", async () => {
    authMock.mockResolvedValueOnce({ user: {} });
    expect(((await requireSessionUser()) as Response).status).toBe(401);
  });
});
