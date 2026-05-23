const DEFAULT_HEADERS = {
  "User-Agent": "siriwat-ti/0.1 (+https://github.com)",
  Accept: "application/json",
};

export interface HttpResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
}

/** Fetch JSON, never throwing on non-2xx — the caller inspects status/data. */
export async function getJson<T>(
  url: string,
  signal: AbortSignal,
  headers: Record<string, string> = {},
): Promise<HttpResponse<T>> {
  const res = await fetch(url, {
    signal,
    cache: "no-store",
    headers: { ...DEFAULT_HEADERS, ...headers },
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
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
