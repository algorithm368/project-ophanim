import { describe, expect, it, vi } from "vitest";
import { FEED_TIMEOUT_MS, feedSignal, sharedLoader, withDeadline } from "./shared-feed";
import { isTimeout } from "./http";

/** A promise plus the handles to settle it from the test body. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("feedSignal", () => {
  it("outlasts the longest per-source budget, so no caller's deadline ends it", () => {
    // 20s is crt.sh, the longest timeoutMs any source declares.
    expect(FEED_TIMEOUT_MS).toBeGreaterThan(20_000);
  });

  it("is not already aborted, and belongs to no caller", () => {
    const a = feedSignal();
    const b = feedSignal();
    expect(a.aborted).toBe(false);
    expect(a).not.toBe(b);
  });
});

describe("withDeadline", () => {
  it("passes the shared work's value through", async () => {
    const work = Promise.resolve("feed");
    await expect(withDeadline(work, new AbortController().signal)).resolves.toBe("feed");
  });

  it("passes the shared work's failure through", async () => {
    const work = Promise.reject(new Error("feed unavailable (HTTP 503)"));
    await expect(withDeadline(work, new AbortController().signal)).rejects.toThrow(
      "feed unavailable (HTTP 503)",
    );
  });

  it("rejects when the caller's signal aborts first", async () => {
    const { promise } = deferred<string>();
    const controller = new AbortController();
    const raced = withDeadline(promise, controller.signal);
    controller.abort();
    await expect(raced).rejects.toBeInstanceOf(DOMException);
  });

  it("rejects immediately for a signal that has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(withDeadline(Promise.resolve("feed"), controller.signal)).rejects.toBeInstanceOf(
      DOMException,
    );
  });

  // Real timers, not fake ones: AbortSignal.timeout runs on a Node-internal
  // timer that the fake clock does not drive, so a faked version of this test
  // would hang rather than fail. 5ms is cheap enough to just wait for.
  it("reports a caller timeout as a timeout, not a bare error", async () => {
    const { promise } = deferred<string>();
    const err = await withDeadline(promise, AbortSignal.timeout(5)).catch((e) => e);
    expect(isTimeout(err)).toBe(true);
  });

  it("leaves the shared work running for the other callers", async () => {
    const { promise, resolve } = deferred<string>();
    const impatient = new AbortController();
    const patient = new AbortController();

    const giveUp = withDeadline(promise, impatient.signal);
    const waitOn = withDeadline(promise, patient.signal);
    impatient.abort();
    await expect(giveUp).rejects.toBeInstanceOf(DOMException);

    // The download was never cancelled, only abandoned by one caller.
    resolve("feed");
    await expect(waitOn).resolves.toBe("feed");
  });

  it("still rejects as an abort when the signal carries a reason of its own", async () => {
    const { promise } = deferred<string>();
    const controller = new AbortController();
    const raced = withDeadline(promise, controller.signal);
    controller.abort("some caller's own reason");

    const err = await raced.catch((e) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("AbortError");
    expect(isTimeout(err)).toBe(true);
  });

  it("drops its abort listener once the work settles", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await withDeadline(Promise.resolve("feed"), controller.signal);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("sharedLoader", () => {
  it("runs one download for concurrent callers", async () => {
    const { promise, resolve } = deferred<string>();
    const download = vi.fn(() => promise);
    const load = sharedLoader(download);

    const both = Promise.all([
      load(new AbortController().signal),
      load(new AbortController().signal),
    ]);
    resolve("feed");

    expect(await both).toEqual(["feed", "feed"]);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("gives the download a lifetime no caller owns", async () => {
    const download = vi.fn(async () => "feed");
    const load = sharedLoader(download);
    const caller = AbortSignal.timeout(8000);

    await load(caller);

    const [used] = download.mock.calls[0] as unknown as [AbortSignal];
    expect(used).not.toBe(caller);
    expect(used.aborted).toBe(false);
  });

  it("keeps downloading for the patient after the impatient give up", async () => {
    const { promise, resolve } = deferred<string>();
    const download = vi.fn(() => promise);
    const load = sharedLoader(download);

    const impatient = new AbortController();
    const giveUp = load(impatient.signal);
    const waitOn = load(new AbortController().signal);
    impatient.abort();

    await expect(giveUp).rejects.toBeInstanceOf(DOMException);
    resolve("feed");
    await expect(waitOn).resolves.toBe("feed");
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("does not start a second download when a caller walks away", async () => {
    const { promise, resolve } = deferred<string>();
    const download = vi.fn(() => promise);
    const load = sharedLoader(download);

    const impatient = new AbortController();
    const giveUp = load(impatient.signal);
    impatient.abort();
    await expect(giveUp).rejects.toBeInstanceOf(DOMException);

    // The download is still running, so the next caller joins it.
    const next = load(new AbortController().signal);
    resolve("feed");
    await expect(next).resolves.toBe("feed");
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh download once the previous one has settled", async () => {
    const download = vi.fn(async () => "feed");
    const load = sharedLoader(download);

    await load(new AbortController().signal);
    await load(new AbortController().signal);

    expect(download).toHaveBeenCalledTimes(2);
  });

  it("propagates a failed download to every caller and retries next time", async () => {
    const download = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("feed unavailable (HTTP 503)"))
      .mockResolvedValueOnce("feed");
    const load = sharedLoader(download);

    const first = load(new AbortController().signal);
    const second = load(new AbortController().signal);
    await expect(first).rejects.toThrow("feed unavailable (HTTP 503)");
    await expect(second).rejects.toThrow("feed unavailable (HTTP 503)");

    await expect(load(new AbortController().signal)).resolves.toBe("feed");
  });

  it("forgets the in-flight request on reset, for tests", async () => {
    const { promise, resolve } = deferred<string>();
    const download = vi.fn(() => promise);
    const load = sharedLoader(download);

    void load(new AbortController().signal);
    load.reset();
    void load(new AbortController().signal);
    resolve("feed");

    expect(download).toHaveBeenCalledTimes(2);
  });
});
