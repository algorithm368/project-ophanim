import type { TiSource } from "../types";
import { urlHeuristicsSource } from "./heuristics";
import { openphishUrlSource } from "./sources/openphish-url";
import { safeBrowsingUrlSource } from "./sources/safebrowsing-url";
import { urlhausUrlSource } from "./sources/urlhaus-url";

/**
 * Sources that answer for a full URL. Order is display order.
 *
 * With no keys configured this is one network source (OpenPhish) plus the
 * offline structural check, which is a thin panel. That has to read as thin in
 * the UI rather than letting a quiet "nothing found" pass for "clean".
 */
export const urlSources: TiSource[] = [
  urlhausUrlSource,
  safeBrowsingUrlSource,
  openphishUrlSource,
  urlHeuristicsSource,
];
