import type { ResearchProvider } from "./types";
import { urlScanProvider } from "./sources/urlscan";
import { waybackProvider } from "./sources/wayback";
import { crtshProvider } from "./sources/crtsh";

/** All live research providers, in display order. Add a free, CORS-safe,
 *  non-scoring provider here and it appears in the Research card automatically. */
export const researchProviders: ResearchProvider[] = [
  urlScanProvider,
  waybackProvider,
  crtshProvider,
];
