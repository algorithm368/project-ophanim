import { describe, expect, it, vi } from "vitest";
import { memoized, withRequestMemo } from "./request-memo";

const live = () => AbortSignal.timeout(5_000);

describe("memoized", () => {
  it("runs work on the caller's own signal outside a scope", async () => {
    const work = vi.fn(async () => "x");
    const signal = live();
    await memoized("k", signal, work);
    await memoized("k", signal, work);
    expect(work).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledWith(signal);
  });

  it("shares one request per key within a scope", async () => {
    const work = vi.fn(async () => "x");
    const results = await withRequestMemo(() =>
      Promise.all([
        memoized("a", live(), work),
        memoized("a", live(), work),
        memoized("b", live(), work),
      ]),
    );
    expect(results).toEqual(["x", "x", "x"]);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not share across scopes", async () => {
    const work = vi.fn(async () => "x");
    await withRequestMemo(() => memoized("a", live(), work));
    await withRequestMemo(() => memoized("a", live(), work));
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not let one caller's deadline cancel the shared request", async () => {
    let finish!: (v: string) => void;
    let sharedSignal: AbortSignal | undefined;
    const work = vi.fn((signal: AbortSignal) => {
      sharedSignal = signal;
      return new Promise<string>((resolve) => (finish = resolve));
    });
    const impatient = new AbortController();

    await withRequestMemo(async () => {
      const first = memoized("a", impatient.signal, work);
      const second = memoized("a", live(), work);
      impatient.abort(new DOMException("t", "TimeoutError"));
      await expect(first).rejects.toThrow();
      expect(sharedSignal?.aborted).toBe(false);
      finish("late");
      await expect(second).resolves.toBe("late");
    });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("hands a shared failure to every caller", async () => {
    const work = vi.fn(async () => {
      throw new Error("boom");
    });
    await withRequestMemo(async () => {
      await expect(memoized("a", live(), work)).rejects.toThrow("boom");
      await expect(memoized("a", live(), work)).rejects.toThrow("boom");
    });
    expect(work).toHaveBeenCalledTimes(1);
  });
});
