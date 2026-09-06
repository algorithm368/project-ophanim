import type { TiSource } from "../types";
import { dnsSource } from "./sources/dns";
import { dnsGeoSource } from "./sources/dns-geo";
import { cloudRangeSource } from "./sources/cloud-range";
import { rdapSource } from "./sources/rdap";
import { certSpotterSource } from "./sources/certspotter";
import { spamhausDblSource } from "./sources/spamhaus-dbl";
import { surblSource } from "./sources/surbl";
import { quad9Source } from "./sources/quad9";
import { openPhishSource } from "./sources/openphish";
import { urlhausSource } from "./sources/urlhaus";
import { safeBrowsingSource } from "./sources/safebrowsing";
import { virusTotalDomainSource } from "./sources/virustotal";
import { pdnsDomainSource } from "./sources/pdns";
import { threatFoxDomainSource } from "./sources/threatfox";
import { trancoSource } from "./sources/tranco";

/** All registered domain TI sources, in display order. */
export const domainSources: TiSource[] = [
  dnsSource,
  dnsGeoSource,
  cloudRangeSource,
  rdapSource,
  certSpotterSource,
  spamhausDblSource,
  surblSource,
  quad9Source,
  openPhishSource,
  urlhausSource,
  safeBrowsingSource,
  virusTotalDomainSource,
  pdnsDomainSource,
  threatFoxDomainSource,
  trancoSource,
];
