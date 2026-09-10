/**
 * Whether this deployment can scan at all, and with which engine.
 *
 * Each engine is gated on its own credentials, so one configured engine still
 * produces a scan and the other is simply absent rather than fatal.
 *
 * This lives apart from the route because two callers need the same answer:
 * the route, which refuses a scan it cannot run, and `/check`, which says so on
 * the card rather than offering a link to a page that will only apologize. The
 * card used to learn it by asking the route over HTTP, which is a network round
 * trip to read four environment variables.
 */
export interface ScanCredentials {
  urlscanKey?: string;
  cfToken?: string;
  cfAccount?: string;
  /** Cloudflare needs both halves before it is usable. */
  cfReady: boolean;
  /** At least one engine is configured. */
  any: boolean;
}

export function readScanCredentials(): ScanCredentials {
  const urlscanKey = process.env.URLSCAN_API_KEY;
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  return {
    urlscanKey,
    cfToken,
    cfAccount,
    cfReady: Boolean(cfToken && cfAccount),
    any: Boolean(urlscanKey) || Boolean(cfToken && cfAccount),
  };
}

/** What to say when nothing is configured. One string, because the route
 *  returns it in a 503 body and the card renders it directly. */
export const SCAN_MISSING_KEY = {
  error:
    "Active scanning needs urlscan.io or Cloudflare credentials. Set URLSCAN_API_KEY, or CLOUDFLARE_API_TOKEN with CLOUDFLARE_ACCOUNT_ID.",
  keyEnv: "URLSCAN_API_KEY",
} as const;
