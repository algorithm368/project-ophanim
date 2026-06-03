import type { TiSource } from "./types";
import { ipApiSource } from "./sources/ipapi";
import { ipWhoIsSource } from "./sources/ipwhois";
import { rdapIpSource } from "./sources/rdap-ip";
import { ipInfoSource } from "./sources/ipinfo";
import { ipGeolocationSource } from "./sources/ipgeolocation";
import { shodanInternetDbSource } from "./sources/shodan-internetdb";
import { dnsblSource } from "./sources/dnsbl";
import { blocklistDeSource } from "./sources/blocklist-de";
import { feodoSource } from "./sources/feodo";
import { etOpenSource } from "./sources/et-open";
import { torSource } from "./sources/tor";
import { virusTotalSource } from "./sources/virustotal";
import { abuseIpdbSource } from "./sources/abuseipdb";
import { otxSource } from "./sources/otx";
import { greyNoiseSource } from "./sources/greynoise";
import { threatFoxSource } from "./sources/threatfox";
import { criminalIpSource } from "./sources/criminalip";
import { censysSource } from "./sources/censys";

/** All registered TI sources, in display order. */
export const sources: TiSource[] = [
  ipApiSource,
  ipWhoIsSource,
  rdapIpSource,
  ipInfoSource,
  ipGeolocationSource,
  shodanInternetDbSource,
  dnsblSource,
  blocklistDeSource,
  feodoSource,
  etOpenSource,
  torSource,
  virusTotalSource,
  abuseIpdbSource,
  otxSource,
  greyNoiseSource,
  threatFoxSource,
  criminalIpSource,
  censysSource,
];
