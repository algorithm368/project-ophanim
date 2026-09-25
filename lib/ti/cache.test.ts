import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { truncateAtReceived } from "@/lib/ti/cache";

// The cache resolves its client once and memoizes it in module scope, so every
// test that varies the environment needs a fresh copy of the module. `Redis` is
// mocked because what is under test is the decision to build a client at all,
// the key each helper writes under, and what happens when Redis misbehaves,
// none of which should open a socket.
const { redisCtor, redisGet, redisSet } = vi.hoisted(() => {
  const redisGet = vi.fn();
  const redisSet = vi.fn();
  return {
    redisGet,
    redisSet,
    redisCtor: vi.fn(function () {
      return { get: redisGet, set: redisSet };
    }),
  };
});
vi.mock("@upstash/redis", () => ({ Redis: redisCtor }));

const ENV_KEYS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "TI_CACHE_TTL_SECONDS",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const REST = { UPSTASH_REDIS_REST_URL: "https://eu1.upstash.io", UPSTASH_REDIS_REST_TOKEN: "tok" };

const saved: Partial<Record<EnvKey, string | undefined>> = {};
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Start every test from "no credentials at all", whatever the developer
  // running it happens to have in .env.local.
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  redisCtor.mockClear();
  redisCtor.mockImplementation(function () {
    return { get: redisGet, set: redisSet };
  });
  redisGet.mockReset();
  redisSet.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  errorSpy.mockRestore();
});

async function loadCache(env: Partial<Record<EnvKey, string>> = {}) {
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  vi.resetModules();
  return import("@/lib/ti/cache");
}

describe("truncateAtReceived", () => {
  // The whole point of this function: an Upstash config error quotes the URL it
  // was handed, and a rediss:// URL embeds the password. It must not be logged.
  it("drops the Received tail that would echo the URL", () => {
    expect(
      truncateAtReceived(
        'Invalid URL. Received: "rediss://default:hunter2@eu1.upstash.io:6379"',
      ),
    ).toBe("Invalid URL.");
  });

  it("leaves a message without the tail alone", () => {
    expect(truncateAtReceived("Missing token")).toBe("Missing token");
    expect(truncateAtReceived("")).toBe("");
  });

  it("trims the whitespace that ran up to the tail", () => {
    expect(truncateAtReceived("Bad config   \n Received: x")).toBe("Bad config");
  });

  // Regression guard for the quadratic regex this replaced: a long message with
  // no tail used to be rescanned from every offset.
  it("is linear on a long message with no tail", () => {
    const long = "x".repeat(200_000);
    expect(truncateAtReceived(long)).toBe(long);
  });
});

describe("client resolution", () => {
  // The documented degradation: no credentials is a supported configuration,
  // not an error. Nothing is constructed and nothing is logged.
  it("disables the cache when there are no credentials", async () => {
    const cache = await loadCache();
    expect(cache.cacheEnabled()).toBe(false);
    expect(cache.getRedis()).toBeNull();
    expect(redisCtor).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("builds a client from the UPSTASH_* names", async () => {
    const cache = await loadCache(REST);
    expect(cache.cacheEnabled()).toBe(true);
    expect(redisCtor).toHaveBeenCalledWith({
      url: "https://eu1.upstash.io",
      token: "tok",
    });
  });

  // Vercel's Upstash Marketplace integration injects the KV_* names instead.
  it("accepts the KV_* names Vercel injects", async () => {
    const cache = await loadCache({
      KV_REST_API_URL: "https://kv.upstash.io",
      KV_REST_API_TOKEN: "kv-tok",
    });
    expect(cache.cacheEnabled()).toBe(true);
    expect(redisCtor).toHaveBeenCalledWith({
      url: "https://kv.upstash.io",
      token: "kv-tok",
    });
  });

  // The reason firstNonEmpty trims rather than checking for undefined: a var
  // that is present but blank is how a half-configured project usually looks,
  // and it must not shadow the populated pair.
  it("does not let a blank UPSTASH_* var shadow a populated KV_* one", async () => {
    const cache = await loadCache({
      UPSTASH_REDIS_REST_URL: "   ",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "https://kv.upstash.io",
      KV_REST_API_TOKEN: "kv-tok",
    });
    expect(cache.cacheEnabled()).toBe(true);
    expect(redisCtor).toHaveBeenCalledWith({
      url: "https://kv.upstash.io",
      token: "kv-tok",
    });
  });

  it("treats a URL with no token as no credentials", async () => {
    const cache = await loadCache({ UPSTASH_REDIS_REST_URL: "https://eu1.upstash.io" });
    expect(cache.cacheEnabled()).toBe(false);
    expect(redisCtor).not.toHaveBeenCalled();
  });

  // The mistake this guards is handing it KV_URL / REDIS_URL, which are
  // rediss:// connection strings. The REST client cannot use one, and the
  // string embeds the password, so the rejection must not echo it.
  it("rejects a rediss:// URL without ever logging it", async () => {
    const cache = await loadCache({
      UPSTASH_REDIS_REST_URL: "rediss://default:hunter2@eu1.upstash.io:6379",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    });
    expect(cache.cacheEnabled()).toBe(false);
    expect(redisCtor).not.toHaveBeenCalled();

    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("https://");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("rediss://default");
  });

  it("rejects a plain http:// URL too", async () => {
    const cache = await loadCache({
      UPSTASH_REDIS_REST_URL: "http://eu1.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    });
    expect(cache.cacheEnabled()).toBe(false);
  });

  it("accepts HTTPS in any case", async () => {
    const cache = await loadCache({
      UPSTASH_REDIS_REST_URL: "HTTPS://eu1.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    });
    expect(cache.cacheEnabled()).toBe(true);
  });

  // A malformed-but-https URL makes the real constructor throw. Degrading to
  // "no cache" is the contract; crashing the page is not.
  it("degrades to no cache when the constructor throws, logging only the head", async () => {
    redisCtor.mockImplementation(function () {
      throw new Error('Invalid URL. Received: "https://nope@@upstash.io"');
    });
    const cache = await loadCache(REST);

    expect(cache.cacheEnabled()).toBe(false);
    const logged = errorSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("Invalid URL.");
    expect(logged).not.toContain("Received:");
  });

  it("survives a constructor that throws a non-Error", async () => {
    redisCtor.mockImplementation(function () {
      throw "boom";
    });
    const cache = await loadCache(REST);
    expect(cache.cacheEnabled()).toBe(false);
    expect(errorSpy.mock.calls.flat().join(" ")).toContain("boom");
  });

  // Memoization is what makes getRedis() cheap enough for history to call it
  // per request. `null` has to memoize as firmly as a client does.
  it("resolves the client once and reuses it", async () => {
    const cache = await loadCache(REST);
    cache.cacheEnabled();
    cache.getRedis();
    expect(cache.getRedis()).toBe(cache.getRedis());
    expect(redisCtor).toHaveBeenCalledTimes(1);
  });

  it("does not retry the lookup once it has resolved to no cache", async () => {
    const cache = await loadCache();
    expect(cache.cacheEnabled()).toBe(false);
    // Credentials arriving later must not revive a resolved-null client.
    process.env.UPSTASH_REDIS_REST_URL = REST.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_TOKEN = REST.UPSTASH_REDIS_REST_TOKEN;
    expect(cache.cacheEnabled()).toBe(false);
    expect(redisCtor).not.toHaveBeenCalled();
  });
});

describe("reads and writes", () => {
  it("reads through to Redis on a hit", async () => {
    const cache = await loadCache(REST);
    redisGet.mockResolvedValue({ verdict: "clean" });
    await expect(cache.getCachedResult("1.1.1.1")).resolves.toEqual({
      verdict: "clean",
    });
    expect(redisGet).toHaveBeenCalledWith("ti:ip:v2:1.1.1.1");
  });

  // Upstash resolves a missing key as undefined; the helper's contract is null.
  it("turns a miss into null rather than undefined", async () => {
    const cache = await loadCache(REST);
    redisGet.mockResolvedValue(undefined);
    await expect(cache.getCachedResult("1.1.1.1")).resolves.toBeNull();
  });

  it("returns null without touching Redis when the cache is off", async () => {
    const cache = await loadCache();
    await expect(cache.getCachedResult("1.1.1.1")).resolves.toBeNull();
    expect(redisGet).not.toHaveBeenCalled();
  });

  // A cache is an optimization. A read that fails is a miss, not an outage.
  it("treats a failed read as a miss", async () => {
    const cache = await loadCache(REST);
    redisGet.mockRejectedValue(new Error("upstream down"));
    await expect(cache.getCachedResult("1.1.1.1")).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("writes with the default one-week TTL", async () => {
    const cache = await loadCache(REST);
    await cache.setCachedResult("1.1.1.1", { verdict: "clean" } as never);
    expect(redisSet).toHaveBeenCalledWith(
      "ti:ip:v2:1.1.1.1",
      { verdict: "clean" },
      { ex: 604_800 },
    );
  });

  it("skips the write entirely when the cache is off", async () => {
    const cache = await loadCache();
    await expect(
      cache.setCachedResult("1.1.1.1", { verdict: "clean" } as never),
    ).resolves.toBeUndefined();
    expect(redisSet).not.toHaveBeenCalled();
  });

  // A write that fails must not surface as a failed lookup to the caller.
  it("swallows a failed write", async () => {
    const cache = await loadCache(REST);
    redisSet.mockRejectedValue(new Error("quota exceeded"));
    await expect(
      cache.setCachedResult("1.1.1.1", { verdict: "clean" } as never),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("TTL", () => {
  async function ttlUsed(env: Partial<Record<EnvKey, string>>) {
    const cache = await loadCache({ ...REST, ...env });
    await cache.setCachedResult("1.1.1.1", {} as never);
    return (redisSet.mock.calls[0][2] as { ex: number }).ex;
  }

  it("honours TI_CACHE_TTL_SECONDS", async () => {
    await expect(ttlUsed({ TI_CACHE_TTL_SECONDS: "60" })).resolves.toBe(60);
  });

  it("floors a fractional override", async () => {
    await expect(ttlUsed({ TI_CACHE_TTL_SECONDS: "90.7" })).resolves.toBe(90);
  });

  // Anything that is not a usable positive number falls back rather than
  // writing an entry that expires immediately or never.
  it.each([
    ["unparseable", "soon"],
    ["zero", "0"],
    ["negative", "-1"],
    ["blank", ""],
  ])("falls back to a week on a %s value", async (_label, value) => {
    await expect(ttlUsed({ TI_CACHE_TTL_SECONDS: value })).resolves.toBe(604_800);
  });
});

// Each indicator type keys into its own namespace. The IP prefix carries the
// schema version specifically so that a v1 entry is missed rather than read
// under the v2 meaning, which is a silent wrong answer.
describe("key namespaces", () => {
  const NAMESPACES = [
    { label: "IP", prefix: "ti:ip:v2:", get: "getCachedResult", set: "setCachedResult" },
    { label: "domain", prefix: "ti:domain:", get: "getCachedDomainResult", set: "setCachedDomainResult" },
    { label: "hash", prefix: "ti:hash:", get: "getCachedHashResult", set: "setCachedHashResult" },
    { label: "scan batch", prefix: "ti:urlscan:v1:", get: "getCachedScanBatch", set: "setCachedScanBatch" },
  ] as const;

  it.each(NAMESPACES)("keys $label under $prefix", async ({ prefix, get, set }) => {
    const cache = await loadCache(REST);
    redisGet.mockResolvedValue(null);

    await (cache[get] as (key: string) => Promise<unknown>)("subject");
    expect(redisGet).toHaveBeenCalledWith(prefix + "subject");

    await (cache[set] as (key: string, value: unknown) => Promise<void>)(
      "subject",
      { marker: prefix },
    );
    expect(redisSet).toHaveBeenCalledWith(
      prefix + "subject",
      { marker: prefix },
      { ex: 604_800 },
    );
  });

  // The namespaces must stay distinct, or a domain lookup could read an entry
  // written for a same-named hash.
  it("gives every type a distinct prefix", () => {
    const prefixes = NAMESPACES.map((n) => n.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

// The dispatch two pages share: each kind reads the namespace its route writes.
describe("getCachedResultFor", () => {
  const BY_KIND = [
    { kind: "ip", prefix: "ti:ip:v2:" },
    { kind: "domain", prefix: "ti:domain:" },
    { kind: "hash", prefix: "ti:hash:" },
  ] as const;

  it.each(BY_KIND)("reads $kind under $prefix", async ({ kind, prefix }) => {
    const cache = await loadCache(REST);
    redisGet.mockResolvedValue(null);

    await cache.getCachedResultFor(kind, "subject");
    expect(redisGet).toHaveBeenCalledWith(prefix + "subject");
  });

  it("returns what the namespace holds", async () => {
    const cache = await loadCache(REST);
    redisGet.mockResolvedValue({ marker: "domain" });
    await expect(cache.getCachedResultFor("domain", "evil.test")).resolves.toEqual(
      { marker: "domain" },
    );
  });
});

// #37: a GreyNoise identification is kept far longer than a result, so a
// rate-limited day can still fall back to what a live check already
// established. It gets its own TTL, distinct from TI_CACHE_TTL_SECONDS,
// since that env var is about how fresh a *result* must be, not this.
describe("GreyNoise identification cache", () => {
  it("keys under its own prefix, distinct from the result namespaces", async () => {
    const cache = await loadCache(REST);
    redisGet.mockResolvedValue(null);

    await cache.getCachedGreyNoiseIdentification("71.6.146.185");
    expect(redisGet).toHaveBeenCalledWith("ti:greynoise-id:v1:71.6.146.185");
  });

  it("stores for 30 days, unaffected by TI_CACHE_TTL_SECONDS", async () => {
    const cache = await loadCache({ ...REST, TI_CACHE_TTL_SECONDS: "60" });

    await cache.setCachedGreyNoiseIdentification("71.6.146.185", {
      classification: "benign",
      actor: "Shodan.io",
    });

    expect(redisSet).toHaveBeenCalledWith(
      "ti:greynoise-id:v1:71.6.146.185",
      { classification: "benign", actor: "Shodan.io" },
      { ex: 30 * 24 * 60 * 60 },
    );
  });

  it("misses quietly when caching is off", async () => {
    const cache = await loadCache();
    await expect(
      cache.getCachedGreyNoiseIdentification("71.6.146.185"),
    ).resolves.toBeNull();
    await expect(
      cache.setCachedGreyNoiseIdentification("71.6.146.185", {
        classification: "benign",
      }),
    ).resolves.toBeUndefined();
    expect(redisCtor).not.toHaveBeenCalled();
  });
});
