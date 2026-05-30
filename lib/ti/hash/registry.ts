import type { TiSource } from "../types";
import { malwareBazaarSource } from "./sources/malwarebazaar";
import { virusTotalHashSource } from "./sources/virustotal";
import { metadefenderHashSource } from "./sources/metadefender";
import { threatFoxHashSource } from "./sources/threatfox";
import { urlhausHashSource } from "./sources/urlhaus";
import { hybridAnalysisSource } from "./sources/hybrid-analysis";
import { cymruMhrSource } from "./sources/cymru-mhr";
import { otxHashSource } from "./sources/otx";
import { hashlookupSource } from "./sources/hashlookup";
import { pulsediveSource } from "./sources/pulsedive";
import { kasperskyOpenTipSource } from "./sources/kaspersky-opentip";
import { maltiverseSource } from "./sources/maltiverse";
import { triageSource } from "./sources/triage";

/** All registered file-hash TI sources, in display order. */
export const hashSources: TiSource[] = [
  malwareBazaarSource,
  virusTotalHashSource,
  metadefenderHashSource,
  threatFoxHashSource,
  urlhausHashSource,
  hybridAnalysisSource,
  cymruMhrSource,
  hashlookupSource,
  otxHashSource,
  pulsediveSource,
  kasperskyOpenTipSource,
  maltiverseSource,
  triageSource,
];
