import type { TiSource } from "../types";
import { dnsSource } from "./sources/dns";
import { rdapSource } from "./sources/rdap";
import { spamhausDblSource } from "./sources/spamhaus-dbl";
import { surblSource } from "./sources/surbl";
import { quad9Source } from "./sources/quad9";
import { openPhishSource } from "./sources/openphish";
import { urlhausSource } from "./sources/urlhaus";
import { safeBrowsingSource } from "./sources/safebrowsing";
import { virusTotalDomainSource } from "./sources/virustotal";
import { otxDomainSource } from "./sources/otx";
import { threatFoxDomainSource } from "./sources/threatfox";

/** All registered domain TI sources, in display order. */
export const domainSources: TiSource[] = [
  dnsSource,
  rdapSource,
  spamhausDblSource,
  surblSource,
  quad9Source,
  openPhishSource,
  urlhausSource,
  safeBrowsingSource,
  virusTotalDomainSource,
  otxDomainSource,
  threatFoxDomainSource,
];
