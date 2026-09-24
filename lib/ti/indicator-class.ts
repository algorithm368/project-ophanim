import type { DomainContext, GeoContext, HashContext, SourceResult } from "./types";

/** What an indicator is, in one short label plus a sentence of why. These
 *  functions live in lib/ so lib/ti/subject-record.ts and the coverage scope
 *  can reach them; the icon that used to pair with each label lived in
 *  components/CheckResults/classify.ts, which is gone along with its callers. */
export type IndicatorClass = { label: string; desc: string };

/**
 * An IP's class, plus the two things every caller of it also needed.
 *
 * `short` exists so the vitals heading and the Type cell cannot disagree: they
 * used to be two functions reading the same three booleans, which is a
 * contradiction waiting for the day one of them grows a case. `sources` names
 * what actually decided, because "geo flags" was hardcoded at the call site and
 * became a lie the moment anything but a geo flag could settle it.
 */
export type SubjectClass = IndicatorClass & {
  /** One or two words, for the Type cell in the vitals strip. */
  short: string;
  /** The fragment printed under that cell. */
  caption: string;
  /** The noun phrase the summary sentence uses: "It is <phrase> operated by
   *  ...". */
  phrase: string;
  /** What the class means for reading the score, tacked onto that sentence.
   *  Empty when the class implies nothing a reader has to hold. */
  tail: string;
  sources: string[];
};

/**
 * What the app knows about an address, gathered from sources it already runs.
 *
 * Every field here is optional and every field can be absent for boring reasons
 * (a rate limit, a timeout, a provider with no opinion). The ladder below is
 * written so that a missing field costs precision and never correctness: it
 * drops to a rung that needs less, it does not guess.
 */
export type IpEvidence = {
  geo?: GeoContext;
  /** How many other names answer here, and whether that number is a
   *  measurement or the point where the provider stopped counting. */
  tenancy?: { count: number; atCeiling: boolean };
  /** The reverse name, and whether it survives a forward lookup. */
  ptr?: { hostname?: string; forwardConfirmed?: boolean };
  /** PeeringDB's own word for the network: Content, NSP, Enterprise, ... */
  networkClass?: string;
  /** The published cloud range this address falls in, if any. */
  cloud?: string;
  /** Listening ports, from Shodan InternetDB. */
  ports?: number[];
  /** A Tor relay or exit node. */
  tor?: boolean;
};

/**
 * Where "crowded" starts, for addresses whose count is a real measurement.
 *
 * A front door is usually found by `atCeiling` rather than by this number, but
 * a smaller CDN can front a few hundred names and still be a front door, and a
 * provider whose ceiling we have not learned yet answers under it. The number
 * is deliberately far above what a shared-hosting box carries.
 */
const CROWDED = 100;

/** Where a box stops being one thing's home and starts being a landlord. */
const SHARED = 5;

/** Reverse names that state the machine's job. Ordered, because a host called
 *  `ns1.mail.example.net` is a resolver that also happens to sit in a mail
 *  zone, and the first word is the one that means something. */
const INFRA_ROLE: [RegExp, string][] = [
  [/(^|[.-])sinkhole/i, "a sinkhole"],
  [/(^|[.-])(ns\d*|dns\d*|resolver|recursor)[.-]/i, "a DNS resolver"],
  [/(^|[.-])(mx\d*|smtp|mail)[.-]/i, "a mail relay"],
  [/(^|[.-])ntp\d*[.-]/i, "a time server"],
];

/** The job a reverse name or an open-port set states outright, if either does.
 *  Ports only speak when the web ports are shut: a box serving 53 *and* 443 is
 *  a website that also resolves, and the website is the part a reader came
 *  for. */
function infraRole(hostname?: string, ports?: number[]): string | undefined {
  const named = hostname && INFRA_ROLE.find(([re]) => re.test(hostname))?.[1];
  if (named) return named;
  if (!ports?.length || ports.includes(80) || ports.includes(443)) return undefined;
  if (ports.includes(53)) return "a DNS resolver";
  if (ports.includes(25)) return "a mail relay";
  return undefined;
}

/** "More than 500 names" or "234 names", never the first dressed as the
 *  second. */
function tenantWords(t: { count: number; atCeiling: boolean }): string {
  return `${t.atCeiling ? "More than " : ""}${t.count} name${t.count === 1 ? "" : "s"}`;
}

/** One rung of the ladder: it recognises its own case or stands aside. */
type Rung = (ev: IpEvidence) => SubjectClass | null;

/** The hosting fact survives when both flags are set: collapsing to
 *  "anonymizer" alone dropped the datacentre context the profile showed
 *  alongside it (issue #9). */
const anonymizer: Rung = ({ geo, tor }) =>
  tor || geo?.isProxy
    ? {
        label: "Anonymizer",
        short: "Anonymizer",
        caption: "anonymizing proxy or VPN",
        phrase: geo?.isHosting
          ? "an anonymizer (proxy, VPN, or Tor) on hosting/datacenter infrastructure"
          : "an anonymizer (proxy, VPN, or Tor)",
        tail: ", so the real origin is hidden",
        desc: "Proxy, VPN, or Tor; the real user is hidden behind it.",
        sources: [tor ? "tor relay list" : "geo flags"],
      }
    : null;

const frontDoor: Rung = ({ tenancy, ptr, networkClass, cloud }) => {
  if (!tenancy || ptr?.forwardConfirmed) return null;
  // A box that answers to its own name is a host with tenants, not a wall.
  if (!tenancy.atCeiling && tenancy.count < CROWDED) return null;
  // Crowding alone is a landlord. Something has to say reverse proxy.
  if (!cloud && networkClass !== "Content") return null;
  const many = tenantWords(tenancy).toLowerCase();
  return {
    label: "Front door",
    short: "Front door",
    caption: `reverse proxy, ${many}`,
    phrase: "a reverse-proxy front door",
    tail: `, where ${many} answer, so nothing scored here is about any one of them`,
    desc: `${tenantWords(tenancy)} answer at this address, which is a reverse proxy rather than a host. Nothing scored here is about any one of them, so the name is the subject and the address is not.`,
    sources: ["co-tenancy", cloud ? "cloud range" : "peeringdb"],
  };
};

const infrastructure: Rung = ({ ptr, ports }) => {
  const role = infraRole(ptr?.hostname, ports);
  return role
    ? {
        label: "Infrastructure",
        short: "Infrastructure",
        caption: role,
        phrase: role,
        tail: ", which is a service rather than a site",
        desc: `Runs ${role}. It has an identity of its own, but it is nobody's website, so a listing here is about the service rather than about a site.`,
        sources: [ptr?.hostname ? "reverse name" : "open ports"],
      }
    : null;
};

const cloudHost: Rung = ({ cloud }) =>
  cloud
    ? {
        label: "Cloud host",
        short: "Cloud",
        caption: `${cloud} range`,
        phrase: `a host in ${cloud}'s published range`,
        tail: ", where the tenant is ephemeral and reputation ages out in days",
        desc: `Inside ${cloud}'s published range. The tenant is ephemeral, so reputation here ages out in days rather than years, and there is an abuse contact that can actually act on it.`,
        sources: ["cloud range"],
      }
    : null;

const sharedHost: Rung = ({ tenancy }) => {
  if (!tenancy || tenancy.count < SHARED) return null;
  const many = tenantWords(tenancy).toLowerCase();
  return {
    label: "Shared host",
    short: "Shared host",
    caption: `${many} answer here`,
    phrase: "a shared host",
    tail: `, where ${many} answer, so any score is diluted across all of them`,
    desc: `${tenantWords(tenancy)} answer at this address. Any score is diluted across all of them, which makes the neighbours the evidence rather than the number.`,
    sources: ["co-tenancy"],
  };
};

const corporate: Rung = ({ networkClass, geo }) =>
  networkClass === "Enterprise" && !geo?.isHosting
    ? {
        label: "Corporate network",
        short: "Corporate",
        caption: "enterprise network",
        phrase: "an organisation's egress",
        tail: ", not a person and not a machine",
        desc: "PeeringDB files this network as an enterprise, so the address is an organisation's egress: not a person, not a machine, and with staff behind the NAT.",
        sources: ["peeringdb"],
      }
    : null;

/** Guarded on isHosting because a consumer line's dynamic PTR forward-confirms
 *  just as happily as a server's does, and "the score is about this machine" is
 *  exactly the wrong thing to say about a lease. isMobile vetoes for the same
 *  reason even when isHosting is set alongside it; see the mobile rung. */
const singleHost: Rung = ({ ptr, geo, tenancy }) => {
  if (!ptr?.forwardConfirmed || !geo?.isHosting || geo.isMobile) return null;
  if ((tenancy?.count ?? 0) >= SHARED) return null;
  return {
    label: "Single host",
    short: "Single host",
    caption: "reverse name confirms",
    phrase: "a single host",
    tail: ", whose reverse name forward-confirms, so the score really is about this one machine",
    desc: `${ptr.hostname ?? "The reverse name"} forward-confirms and little else answers here, so the score really is about this one machine.`,
    sources: ["reverse name"],
  };
};

/** Above the bare hosting flag, and that settled a real disagreement. The two
 *  functions that used to answer "what kind of address is this" read these same
 *  booleans in opposite orders, so a carrier range flagged both mobile and
 *  hosting came out "Mobile" in the Type cell and "Hosting / Datacenter" in the
 *  heading directly above it. Mobile wins because it is the claim with
 *  consequences: it says the address identifies a lease, so its reputation ages
 *  out in hours, and a reader told "Hosting" would treat it as a stable server.
 *  It stays below the evidence-backed rungs, which rest on more than one
 *  provider's boolean. */
const mobile: Rung = ({ geo }) =>
  geo?.isMobile
    ? {
        label: "Mobile network",
        short: "Mobile",
        caption: "mobile network",
        phrase: "a mobile carrier (cellular) address",
        tail: ", which identifies a lease rather than a device",
        desc: "A mobile carrier address. It identifies a lease rather than a device, and the lease moves.",
        sources: ["geo flags"],
      }
    : null;

const hosting: Rung = ({ geo }) =>
  geo?.isHosting
    ? {
        label: "Hosting / Datacenter",
        short: "Hosting",
        caption: "hosting or datacentre",
        phrase: "hosting or datacenter infrastructure",
        tail: "",
        desc: "Server or cloud infrastructure, not a home user.",
        sources: ["geo flags"],
      }
    : null;

const residential: Rung = ({ geo }) =>
  geo
    ? {
        label: "Residential / Other",
        short: "Residential",
        caption: "residential or business",
        phrase: "likely a residential or business endpoint",
        tail: "",
        desc: "A consumer or small-business line. It identifies whoever holds the lease right now, which is often not who held it last week.",
        sources: ["geo flags"],
      }
    : null;

/**
 * The ladder, tightest identity first.
 *
 * A list rather than a stack of ifs, because the order *is* the design and this
 * way it is one readable thing instead of something a reader has to reconstruct
 * by scanning bodies. The order is by what each rung changes for the reader,
 * not by which is technically more specific: front door sits near the top
 * because it is the only rung that says the score itself is not an answer, and
 * that has to outrank everything under it. An anycast address is also cloud,
 * also crowded, also PTR-less, and a reader told "Cloud host" about one would
 * go on to read a number that is the average of fifty thousand strangers.
 *
 * Scanner is deliberately absent. It is a behaviour rather than an identity,
 * and a scanner is almost always *also* cloud compute, so admitting it here
 * would force a choice between two true things. It belongs to the behaviour
 * signal, once that split is settled.
 */
const LADDER: Rung[] = [
  anonymizer,
  frontDoor,
  infrastructure,
  cloudHost,
  sharedHost,
  corporate,
  singleHost,
  mobile,
  hosting,
  residential,
];

/** Classify an address by how much of an identity it actually has. Nothing
 *  recognising it is itself the answer, and it is named rather than guessed. */
export function classifyIpLabel(ev: IpEvidence = {}): SubjectClass {
  for (const rung of LADDER) {
    const hit = rung(ev);
    if (hit) return hit;
  }
  return {
    label: "Unknown type",
    short: "Unknown",
    // Not "residential or business", which this used to default to. No provider
    // classified the address, and hedging as unclassified is the difference
    // between a gap and a guess wearing the clothes of a fact (issue #10).
    caption: "unclassified",
    phrase: "an unclassified address",
    tail: "",
    desc: "No network classification available.",
    sources: [],
  };
}

const okSource = (sources: SourceResult[], id: string) =>
  sources.find((s) => s.source.id === id && s.status === "ok");

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

/**
 * Gather `classifyIpLabel`'s input from a finished lookup.
 *
 * Takes geo and sources rather than the result, so that this file stays a leaf:
 * `subject-record.ts` imports it, and reaching back for `AnyResult` would close
 * the loop.
 */
export function ipEvidence(
  geo: GeoContext | undefined,
  sources: SourceResult[],
): IpEvidence {
  const rev = okSource(sources, "reverse-ip")?.details;
  const ptr = okSource(sources, "reverse-dns")?.details;
  const count = num(rev?.domainCount);
  const rawPorts = okSource(sources, "shodan-internetdb")?.details?.ports;

  return {
    geo,
    tenancy:
      count === undefined ? undefined : { count, atCeiling: rev?.atCeiling === true },
    ptr: ptr
      ? {
          hostname: text(ptr.hostname),
          forwardConfirmed: ptr.forwardConfirmed === true,
        }
      : undefined,
    networkClass: text(okSource(sources, "peeringdb")?.details?.networkClass),
    cloud: text(okSource(sources, "cloud-range")?.details?.provider),
    ports: Array.isArray(rawPorts) ? rawPorts.filter((p) => typeof p === "number") : undefined,
    // The source only sets `role` when the address is actually in the relay
    // list; its score is 0 either way for a non-node, so the field is the
    // reliable read.
    tor: Boolean(text(okSource(sources, "tor-project")?.details?.role)),
  };
}

/** What the app knows about a name. Same contract as `IpEvidence`: every field
 *  can be missing for boring reasons, and a missing field costs precision
 *  rather than correctness. */
export type DomainEvidence = {
  ctx?: DomainContext;
  /** The name as queried, and the registrable part of it. A label under a
   *  service is a different kind of thing from the service itself, and only
   *  these two together can tell them apart. */
  name?: string;
  registrable?: string;
  /** A published cloud/CDN range the resolved address falls in. */
  cloud?: string;
  /** Tranco rank, when the name has one. */
  rank?: number;
};

/**
 * Services that hand out names under one registrable domain.
 *
 * A name under one of these has no registration history of its own: RDAP
 * answers for the *service*, so `workers.dev` reads as registered in 2018 no
 * matter how old the label in front of it is. That mattered on 104.21.48.41,
 * whose five hundred co-tenants were largely `*.workers.dev`. Deliberately a
 * short explicit list rather than a heuristic, because being wrong here means
 * telling an analyst a domain has no history when it does.
 */
const FREE_SUBDOMAIN = new Set([
  "workers.dev",
  "pages.dev",
  "r2.dev",
  "trycloudflare.com",
  "vercel.app",
  "netlify.app",
  "github.io",
  "gitlab.io",
  "firebaseapp.com",
  "web.app",
  "herokuapp.com",
  "duckdns.org",
  "no-ip.org",
  "ddns.net",
  "hopto.org",
  "ngrok.io",
  "ngrok-free.app",
  "loca.lt",
  "serveo.net",
  "glitch.me",
  "repl.co",
  "onrender.com",
  "azurewebsites.net",
  "blogspot.com",
  "weebly.com",
  "wixsite.com",
]);

/** Nameservers that mean a registrar is holding the name, not serving it. */
export const PARKING_NS = /dns-parking|sedoparking|parkingcrew|bodis|afternic|above\.com|parklogic|cashparking|domaincontrol\.com$/i;

/**
 * Category names that are a filter list rather than a description.
 *
 * Cloudflare Radar returns its "for Families" filter taxonomy mixed in with the
 * content categories and in no useful order, so pornhub.com comes back as
 * `["CIPA Filter", "Pornography", "CIPA", "Adult Themes"]`. Taking the first
 * entry, which is what the Category cell did, printed "CIPA Filter": the name
 * of a US school-filtering statute, in the slot meant to say what the site is.
 */
const CATEGORY_NOISE = /^(cipa\b|content servers$|security threats$|newly seen domains$)/i;

/** The first category that describes the site, rather than naming a list the
 *  site is on. */
export function contentCategory(categories: string[] | undefined): string | undefined {
  return categories?.map((c) => c.trim()).find((c) => c && !CATEGORY_NOISE.test(c));
}

const years = (ageDays: number) => Math.floor(ageDays / 365);

type DomainRung = (ev: DomainEvidence) => SubjectClass | null;

/** Nothing answers. Every live check below will come back empty, and empty is
 *  not clean: it is the shape of a name that has been taken down. */
const deadName: DomainRung = ({ ctx }) =>
  ctx?.nxdomain
    ? {
        label: "Dead name",
        short: "Dead name",
        caption: "nothing answers for this name",
        phrase: "a name that no longer resolves",
        tail: ", so a clean result below is an absence of evidence rather than evidence of absence",
        desc: "No resolver has a record for this name. Whatever it served is gone, which is what a taken-down or expired name looks like, so nothing checked live can speak to what it was.",
        sources: ["dns"],
      }
    : null;

const freeSubdomain: DomainRung = ({ name, registrable }) => {
  if (!registrable || !name || name === registrable) return null;
  if (!FREE_SUBDOMAIN.has(registrable)) return null;
  return {
    label: "Free subdomain",
    short: "Free subdomain",
    caption: `anyone can take a name under ${registrable}`,
    phrase: `a name handed out under ${registrable}`,
    tail: ", so its registration age belongs to the service and says nothing about this label",
    desc: `Names under ${registrable} are handed out on request, so the registration date belongs to the service rather than to this label and carries no weight.`,
    sources: ["public suffix"],
  };
};

const newlyRegistered: DomainRung = ({ ctx }) => {
  const age = ctx?.ageDays;
  if (age === undefined || age >= 30) return null;
  return {
    label: "Newly registered",
    short: "Newly registered",
    caption: `registered ${age} day${age === 1 ? "" : "s"} ago`,
    phrase: "a newly registered domain",
    tail: ", and young names skew higher-risk",
    desc: `Created ${age} day(s) ago; young domains skew higher-risk.`,
    sources: ["registration age"],
  };
};

const parked: DomainRung = ({ ctx }) => {
  const ns = ctx?.nameservers?.find((n) => PARKING_NS.test(n));
  if (!ns) return null;
  return {
    label: "Parked",
    short: "Parked",
    caption: `held at ${ns}, nothing served`,
    phrase: "a parked domain",
    tail: ", held by a registrar rather than serving anything",
    desc: `Its nameservers (${ns}) are a parking service, so the name is being held rather than used.`,
    sources: ["nameservers"],
  };
};

/**
 * What the site is about, which for a live ordinary name is the answer to
 * "what kind of thing is this" and outranks everything below it.
 *
 * It sits under the four rungs above rather than at the top because each of
 * those is a reason not to trust the category: a dead name has no content left
 * to categorise, a parked one serves none, a name three days old has not been
 * categorised by anybody yet, and a label under a free-subdomain service
 * inherits whatever the service is filed as.
 */
const categorised: DomainRung = ({ ctx }) => {
  const cat = contentCategory(ctx?.categories);
  if (!cat) return null;
  const rest = (ctx?.categories ?? []).filter((c) => c !== cat && !CATEGORY_NOISE.test(c));
  return {
    label: cat,
    short: cat,
    caption: rest.length ? rest.join(", ").toLowerCase() : "categorised content",
    phrase: `a ${cat.toLowerCase()} site`,
    tail: "",
    desc: `Categorised as ${[cat, ...rest].join(", ").toLowerCase()}.`,
    sources: ["content category"],
  };
};

/** The name's own front-door case: the address it resolves to belongs to a CDN,
 *  so looking up that address answers a question about the CDN. */
const behindProxy: DomainRung = ({ cloud }) =>
  cloud
    ? {
        label: "Behind a proxy",
        short: "Behind a proxy",
        caption: `resolves into ${cloud}`,
        phrase: `a name fronted by ${cloud}`,
        tail: ", so the address it resolves to is a front door rather than its host",
        desc: `It resolves into ${cloud}'s range, so the address behind it is a reverse proxy and tells you nothing about where the site is really served from.`,
        sources: ["cloud range"],
      }
    : null;

const established: DomainRung = ({ ctx, rank }) => {
  const age = ctx?.ageDays;
  if (age === undefined) return null;
  const y = years(age);
  const ranked = rank ? `, Tranco rank ${rank}` : "";
  return {
    label: "Established",
    short: "Established",
    caption: y >= 1 ? `registered ${y} year${y === 1 ? "" : "s"} ago${ranked}` : `registered under a year ago${ranked}`,
    phrase: "an established domain",
    tail: "",
    desc: y >= 1 ? `Registered ${y}+ year(s) ago.` : "Registered under a year ago.",
    sources: ["registration age"],
  };
};

const DOMAIN_LADDER: DomainRung[] = [
  deadName,
  freeSubdomain,
  newlyRegistered,
  parked,
  categorised,
  behindProxy,
  established,
];

/**
 * Classify a name by how much of an identity it has, and what that costs the
 * reader.
 *
 * Ordered the same way the address ladder is, by what each rung changes rather
 * than by specificity. A dead name wins outright because every check under it
 * returns nothing and nothing reads as clean. A free subdomain outranks both
 * age rungs because for those names the age is the service's and is worse than
 * having no age at all: it asserts a history this label does not have.
 */
export function classifyDomainLabel(ev: DomainEvidence = {}): SubjectClass {
  for (const rung of DOMAIN_LADDER) {
    const hit = rung(ev);
    if (hit) return hit;
  }
  return {
    label: "Domain",
    short: "Domain",
    caption: "registration age unknown",
    phrase: "a domain",
    tail: "",
    desc: "Registration age unknown.",
    sources: [],
  };
}

/** Gather `classifyDomainLabel`'s input from a finished lookup. */
export function domainEvidence(
  name: string,
  registrable: string | undefined,
  ctx: DomainContext | undefined,
  sources: SourceResult[],
): DomainEvidence {
  const rank = okSource(sources, "tranco")?.details?.rank;
  return {
    ctx,
    name: name.toLowerCase(),
    registrable: registrable?.toLowerCase(),
    cloud: text(okSource(sources, "cloud-range")?.details?.provider),
    rank: num(rank),
  };
}

/** What the app knows about a file. */
export type HashEvidence = {
  ctx?: HashContext;
  /** True when at least one source returned a score for it, i.e. somebody has
   *  seen this file before. */
  known?: boolean;
  /** What kind of threat the flagging sources describe, from `threatTypeOf`.
   *  The family names the strain; this names the category it belongs to. */
  threat?: string;
};

type HashRung = (ev: HashEvidence) => SubjectClass | null;

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The family, the file type, and the name it travels under, as a caption.
 *  Order matters: the family is the thing a reader searches for next. */
function fileCaption(ctx: HashContext | undefined): string {
  return (
    [ctx?.malwareFamily, ctx?.fileType, ctx?.fileName && `seen as "${ctx.fileName}"`]
      .filter(Boolean)
      .join(", ") || "no file metadata"
  );
}

/**
 * What kind of dangerous, rather than which strain of it.
 *
 * The family used to headline this, so a sample came up "WannaCry" and a reader
 * who did not already know the name learned nothing from the biggest text on
 * the page. Ransomware, phishing, a loader: that is the thing that decides what
 * happens next, and the family stays one line below it where a reader who does
 * know the name still finds it.
 */
const typedThreat: HashRung = ({ ctx, threat }) =>
  threat
    ? {
        label: sentence(threat),
        short: sentence(threat),
        caption: fileCaption(ctx),
        phrase: `${threat}${ctx?.malwareFamily ? `, identified as ${ctx.malwareFamily}` : ""}`,
        tail: "",
        desc: `Classified as ${threat}${ctx?.malwareFamily ? ` (${ctx.malwareFamily})` : ""}.`,
        sources: ["detection categories"],
      }
    : null;

/** Engines agree it is bad and none of them says what kind. Worth its own rung:
 *  an unclassified detection is the shape of something new, and "Win32 EXE" as
 *  a headline buries exactly that. */
const unnamed: HashRung = ({ ctx }) => {
  const ratio = ctx?.detectionRatio;
  if (!ratio?.malicious) return null;
  return {
    label: "Dangerous file",
    short: "Dangerous file",
    caption: `${ratio.malicious} of ${ratio.total} engines flag it, ${fileCaption(ctx)}`,
    phrase: "a file engines flag without agreeing on what it is",
    tail: ", which is the shape of something too new to have been classified",
    desc: `${ratio.malicious} of ${ratio.total} engines flag it and none of them says what kind, which is what a sample too new to be classified looks like.`,
    sources: ["detection ratio"],
  };
};

const signedFile: HashRung = ({ ctx }) =>
  ctx?.signed && ctx.signer
    ? {
        label: "Signed file",
        short: "Signed",
        caption: `signed by ${ctx.signer}`,
        phrase: `a file signed by ${ctx.signer}`,
        tail: ", which names a publisher who can be held to it",
        desc: `Authenticode verifies a signature from ${ctx.signer}, which names a publisher accountable for it.`,
        sources: ["signature"],
      }
    : null;

/** The most common hash result, and the most misread. Nobody having a record is
 *  not a clean bill of health; it is the absence of one. */
const unseen: HashRung = ({ known, ctx }) =>
  !known && !ctx?.fileType
    ? {
        label: "Unknown file",
        short: "Never seen",
        caption: "no source has this file on record",
        phrase: "a file no source has on record",
        tail: ", so nothing here is a verdict either way",
        desc: "No threat-intel source has this file on record, which is an absence of evidence rather than a clean result.",
        sources: [],
      }
    : null;

/** On record and nothing flags it. Says so in those words rather than printing
 *  "Win32 EXE", because the reader's question is whether the file is a problem
 *  and the format is the answer to a different one. The format keeps its own
 *  vitals cell either way. */
const ordinaryFile: HashRung = ({ ctx }) =>
  ctx?.fileType
    ? {
        label: ctx.fileType,
        short: "Ordinary file",
        caption: fileCaption(ctx),
        phrase: `a ${ctx.fileType}`,
        tail: ", which no engine flags",
        desc: ctx.fileName
          ? `Seen as "${ctx.fileName}".`
          : "Known file, no malware family attributed.",
        sources: ["file metadata"],
      }
    : null;

const HASH_LADDER: HashRung[] = [typedThreat, unnamed, signedFile, unseen, ordinaryFile];

/** Classify a file by what is known about it, named family first and "nobody
 *  has ever seen this" stated rather than left as an empty page. */
export function classifyHashLabel(ev: HashEvidence = {}): SubjectClass {
  for (const rung of HASH_LADDER) {
    const hit = rung(ev);
    if (hit) return hit;
  }
  // Reached only when a source answered about the file and described none of
  // it, which is why the mechanism is still named here: something is on file,
  // it just says nothing. The `unseen` rung above is the case where nothing is.
  return {
    label: "File",
    short: "File",
    caption: "on record, nothing described",
    phrase: "a file",
    tail: "",
    desc: "No file metadata was returned.",
    sources: ev.known ? ["file metadata"] : [],
  };
}

/** Gather `classifyHashLabel`'s input from a finished lookup. `threat` is
 *  passed in rather than derived here, because `threatTypeOf` needs the
 *  verdict and this file is a leaf that does not see one. */
export function hashEvidence(
  ctx: HashContext | undefined,
  sources: SourceResult[],
  threat?: string,
): HashEvidence {
  return {
    ctx,
    known: sources.some((s) => s.status === "ok" && s.score !== undefined),
    threat,
  };
}
