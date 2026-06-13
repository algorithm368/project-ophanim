import type { TiSource } from "./types";
import { ipApiSource } from "./sources/ipapi";
import { ipWhoIsSource } from "./sources/ipwhois";
import { rdapIpSource } from "./sources/rdap-ip";
import { ipInfoSource } from "./sources/ipinfo";
import { ipGeolocationSource } from "./sources/ipgeolocation";
import { freeIpApiSource } from "./sources/freeipapi";
import { reverseDnsSource } from "./sources/reverse-dns";
import { reverseIpSource } from "./sources/reverse-ip";
import { shodanInternetDbSource } from "./sources/shodan-internetdb";
import { ripeStatSource } from "./sources/ripestat";
import { dnsblSource } from "./sources/dnsbl";
import { blocklistDeSource } from "./sources/blocklist-de";
import { ipsumSource } from "./sources/ipsum";
import { feodoSource } from "./sources/feodo";
import { etOpenSource } from "./sources/et-open";
import { torSource } from "./sources/tor";
import { virusTotalSource } from "./sources/virustotal";
import { abuseIpdbSource } from "./sources/abuseipdb";
import { otxSource } from "./sources/otx";
import { pdnsSource } from "./sources/pdns";
import { greyNoiseSource } from "./sources/greynoise";
import { threatFoxSource } from "./sources/threatfox";
import { criminalIpSource } from "./sources/criminalip";

/** All registered TI sources, in display order. */
export const sources: TiSource[] = [
  ipApiSource,
  ipWhoIsSource,
  rdapIpSource,
  ipInfoSource,
  ipGeolocationSource,
  freeIpApiSource,
  reverseDnsSource,
  reverseIpSource,
  ripeStatSource,
  shodanInternetDbSource,
  dnsblSource,
  blocklistDeSource,
  ipsumSource,
  feodoSource,
  etOpenSource,
  torSource,
  virusTotalSource,
  abuseIpdbSource,
  otxSource,
  pdnsSource,
  greyNoiseSource,
  threatFoxSource,
  criminalIpSource,
];
