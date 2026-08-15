import type { TiSource } from "../../types";
import { safeBrowsingLookup } from "../../domain/sources/safebrowsing";

/**
 * Google Safe Browsing v4 on the full URL.
 *
 * The v4 API has always taken a URL entry; the domain-level source just hands
 * it a bare hostname, which answers a different and weaker question. Both
 * sources share one lookup, so this file carries the identity and the layer it
 * belongs to, not a second copy of the request.
 */
export const safeBrowsingUrlSource: TiSource = {
  meta: {
    id: "safebrowsing-url",
    name: "Google Safe Browsing (URL)",
    url: "https://safebrowsing.google.com",
    category: "reputation",
    requiresKey: true,
    keyEnv: "GOOGLE_SAFE_BROWSING_API_KEY",
    weight: 1,
  },
  isEnabled: () => Boolean(process.env.GOOGLE_SAFE_BROWSING_API_KEY),
  check: (url, signal) => safeBrowsingLookup(url, signal),
};
