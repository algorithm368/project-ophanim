import type { IOCType } from "@/lib/ioc";

/** A single outbound research destination: a public search for the indicator on
 *  some platform, opened in a new tab. Nothing is fetched by us. */
export interface ResearchLink {
    id: string;
    name: string;
    url: string;
}

/** A labeled group of research links (web search, recon, sandboxes). */
export interface ResearchSection {
    id: string;
    label: string;
    links: ResearchLink[];
}

/** Google search for a query the caller has already assembled. `verbatim` adds
 *  Google's literal mode (`tbs=li:1`), which stops it from dropping terms or
 *  swapping in synonyms — without it Google quietly fuzzes an IOC (especially
 *  IP octets) and the "exact match" isn't. */
function google(query: string, verbatim = false): string {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return verbatim ? `${url}&tbs=li:1` : url;
}

/** The bracketed-dot defang analysts publish indicators in (`evil[.]com`,
 *  `1[.]2[.]3[.]4`). `refangIOC` undoes this on input; here we re-apply it so a
 *  search also catches report mentions that were defanged before publishing. */
function defang(value: string): string {
    return value.replace(/\./g, "[.]");
}

/** A quoted exact-match group that hits the indicator whether a source wrote it
 *  plainly or defanged: `"evil.com" OR "evil[.]com"`. Collapses to one quoted
 *  term when there is nothing to defang (a hash has no dots). */
function exactGroup(value: string): string {
    const fanged = `"${value}"`;
    const defanged = defang(value);
    return defanged === value ? fanged : `${fanged} OR "${defanged}"`;
}

/** Pulsedive's /indicator/ page base64-decodes its `ioc` query param, so the
 *  raw indicator must be base64-encoded (then URL-encoded for the +, /, =
 *  characters). Passing the bare value yields "Failed to decode base64 text".
 *  UTF-8 safe so a punycode/unicode domain survives the round trip. */
function pulsedive(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `https://pulsedive.com/indicator/?ioc=${encodeURIComponent(btoa(bin))}`;
}

/**
 * Build the external "go research this indicator" link set for an IOC. Pure and
 * deterministic: it only assembles URLs (no network), so it is trivially
 * testable. Destinations are filtered to those that make sense for the IOC type
 * — infrastructure recon (Censys/Shodan/URLScan) is dropped for a bare hash.
 */
export function researchLinks(
    indicator: string,
    kind: IOCType,
): ResearchSection[] {
    const v = indicator.trim();
    const e = encodeURIComponent(v);
    const quoted = `"${v}"`;

    const exact = exactGroup(v);
    const web: ResearchLink[] = [
        // Exact lookup: verbatim mode + a defang-aware OR group so Google
        // matches the IOC literally and finds it however a report wrote it.
        { id: "google", name: "Google", url: google(exact, true) },
        {
            // Discovery, not exact: left non-verbatim so Google's synonyms widen
            // the net, but still defang-aware on the indicator itself.
            id: "google-reports",
            name: "Google (reports)",
            url: google(`${exact} malware OR threat OR abuse OR report`),
        },
        {
            id: "x",
            name: "X / Twitter",
            url: `https://x.com/search?q=${e}&src=typed_query`,
        },
        {
            id: "github",
            name: "GitHub code",
            url: `https://github.com/search?q=${encodeURIComponent(quoted)}&type=code`,
        },
    ];

    // Infrastructure recon, keyed to the IOC type. A hash has no host/infra to
    // pivot on, so only the indicator-agnostic Pulsedive applies there.
    const osint: ResearchLink[] = [];
    if (kind === "ip") {
        osint.push(
            { id: "urlscan", name: "URLScan", url: `https://urlscan.io/search/#${e}` },
            {
                id: "censys",
                name: "Censys",
                url: `https://platform.censys.io/hosts/${e}`,
            },
            { id: "shodan", name: "Shodan", url: `https://www.shodan.io/host/${e}` },
        );
    } else if (kind === "domain") {
        osint.push(
            { id: "urlscan", name: "URLScan", url: `https://urlscan.io/domain/${e}` },
            {
                id: "censys",
                name: "Censys",
                url: `https://platform.censys.io/search?q=${e}`,
            },
            { id: "shodan", name: "Shodan", url: `https://www.shodan.io/domain/${e}` },
        );
    }
    osint.push({
        id: "pulsedive",
        name: "Pulsedive",
        url: pulsedive(v),
    });

    const sandboxes: ResearchLink[] = [
        // ANY.RUN's public submissions search is a JS SPA with no stable
        // query-string, so this opens the search UI rather than pre-filling it.
        { id: "anyrun", name: "ANY.RUN", url: "https://app.any.run/submissions/" },
        {
            id: "joesandbox",
            name: "Joe Sandbox",
            url: `https://www.joesandbox.com/search?q=${e}`,
        },
        { id: "triage", name: "Triage", url: `https://tria.ge/s?q=${e}` },
        {
            id: "hybrid-analysis",
            name: "Hybrid Analysis",
            url: `https://www.hybrid-analysis.com/search?query=${e}`,
        },
    ];

    return [
        { id: "web", label: "Web search", links: web },
        { id: "osint", label: "OSINT / recon", links: osint },
        { id: "sandbox", label: "Sandboxes", links: sandboxes },
    ].filter((s) => s.links.length > 0);
}
