import type { DomainContext, GeoContext, HashContext } from "./types";

/** What an indicator is, in one short label plus a sentence of why. The icon
 *  that used to travel with these lives in components/CheckResults/classify.ts,
 *  which now wraps these functions. Splitting them is what lets lib/ and the
 *  coverage scope reach the labels. */
export type IndicatorClass = { label: string; desc: string };

/** Classify an IP from the geo provider flags. */
export function classifyIpLabel(geo?: GeoContext): IndicatorClass {
  if (!geo) {
    return { label: "Unknown type", desc: "No network classification available." };
  }
  if (geo.isProxy) {
    return { label: "Anonymizer", desc: "Proxy, VPN, or Tor; the real user is hidden." };
  }
  if (geo.isHosting) {
    return {
      label: "Hosting / Datacenter",
      desc: "Server or cloud infrastructure, not a home user.",
    };
  }
  if (geo.isMobile) {
    return { label: "Mobile network", desc: "A mobile carrier (cellular) address." };
  }
  return {
    label: "Residential / Other",
    desc: "Likely a home or business end-user network.",
  };
}

/** Classify a domain from its registration age and whether it resolves. */
export function classifyDomainLabel(
  ctx?: DomainContext,
  resolves?: boolean,
): IndicatorClass {
  if (ctx?.ageDays !== undefined && ctx.ageDays < 30) {
    return {
      label: "Newly registered",
      desc: `Created ${ctx.ageDays} day(s) ago; young domains skew higher-risk.`,
    };
  }
  if (resolves === false) {
    return { label: "Inactive / parked", desc: "Doesn't currently resolve to an address." };
  }
  if (ctx?.ageDays !== undefined) {
    const years = Math.floor(ctx.ageDays / 365);
    return {
      label: "Established",
      desc:
        years >= 1
          ? `Registered ${years}+ year(s) ago.`
          : "Registered under a year ago.",
    };
  }
  return { label: "Domain", desc: "Registration age unknown." };
}

/** Classify a file from its known malware family, file type, or lack thereof. */
export function classifyHashLabel(
  ctx: HashContext | undefined,
  hasData: boolean,
): IndicatorClass {
  if (ctx?.malwareFamily) {
    return {
      label: ctx.malwareFamily,
      desc: `Identified as ${ctx.malwareFamily}${ctx.fileType ? ` (${ctx.fileType})` : ""}.`,
    };
  }
  if (ctx?.fileType) {
    return {
      label: ctx.fileType,
      desc: ctx.fileName
        ? `Seen as "${ctx.fileName}".`
        : "Known file, no malware family attributed.",
    };
  }
  if (!hasData) {
    return {
      label: "Unknown file",
      desc: "No threat-intel source has this file on record.",
    };
  }
  return { label: "File", desc: "No file metadata was returned." };
}
