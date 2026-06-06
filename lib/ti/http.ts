const DEFAULT_HEADERS = {
  "User-Agent": "project-ophanim/0.1 (+https://github.com)",
  Accept: "application/json",
};

// A few providers (e.g. ipwho.is on the free tier) reject the `Sec-Fetch-Mode:
// cors` header Node's fetch (undici) stamps on every request, and need
// `mode: "no-cors"` to flip it. That is OPT-IN per call (see getJson's `mode`
// argument), never global: under `no-cors` undici hangs on cross-origin
// redirects (e.g. rdap.org -> the authoritative RIR), so any redirect-following
// source must use the default mode. Default mode is correct for almost every
// source; only quirky CORS-rejecting providers pass "no-cors".
export type FetchMode = "cors" | "no-cors" | "same-origin";

export interface HttpResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
}

/** Read a response body as best-effort JSON; never throws on malformed JSON. */
async function asJsonResponse<T>(res: Response): Promise<HttpResponse<T>> {
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

/** Fetch JSON, never throwing on non-2xx: the caller inspects status/data. */
export async function getJson<T>(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  mode?: FetchMode,
): Promise<HttpResponse<T>> {
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    // Default (cors) follows redirects; "no-cors" is opt-in for CORS-rejecting
    // providers and must not be used by redirect-following sources.
    ...(mode ? { mode } : {}),
    headers: { ...DEFAULT_HEADERS, ...headers },
  });
  return asJsonResponse<T>(res);
}

/** POST a JSON body and parse the JSON response, same contract as getJson. */
export async function postJson<T>(
  url: string,
  signal: AbortSignal,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    signal,
    cache: "no-store",
    headers: { ...DEFAULT_HEADERS, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return asJsonResponse<T>(res);
}

/** POST a form-urlencoded body and parse the JSON response (e.g. abuse.ch). */
export async function postForm<T>(
  url: string,
  signal: AbortSignal,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<HttpResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    signal,
    cache: "no-store",
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });
  return asJsonResponse<T>(res);
}

/** Fetch raw text (for plain-text APIs like blocklist.de). */
export async function getText(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): Promise<HttpResponse<never>> {
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { ...DEFAULT_HEADERS, ...headers },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: null, text };
}

export function isTimeout(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
