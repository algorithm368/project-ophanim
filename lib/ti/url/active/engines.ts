/** The scanners an active scan is submitted to. Both are free. */
export type ScanEngine = "urlscan" | "cloudflare";

/** Display name, used wherever a claim is attributed to its source. */
export const ENGINE_NAME: Record<ScanEngine, string> = {
  urlscan: "urlscan.io",
  cloudflare: "Cloudflare",
};
