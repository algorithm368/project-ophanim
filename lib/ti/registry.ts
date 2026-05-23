import type { TiSource } from "./types";
import { ipApiSource } from "./sources/ipapi";
import { shodanInternetDbSource } from "./sources/shodan-internetdb";
import { dnsblSource } from "./sources/dnsbl";
import { blocklistDeSource } from "./sources/blocklist-de";
import { feodoSource } from "./sources/feodo";
import { virusTotalSource } from "./sources/virustotal";
import { abuseIpdbSource } from "./sources/abuseipdb";
import { otxSource } from "./sources/otx";
import { greyNoiseSource } from "./sources/greynoise";

/** All registered TI sources, in display order. */
export const sources: TiSource[] = [
  ipApiSource,
  shodanInternetDbSource,
  dnsblSource,
  blocklistDeSource,
  feodoSource,
  virusTotalSource,
  abuseIpdbSource,
  otxSource,
  greyNoiseSource,
];
