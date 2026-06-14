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

/** Google search for an exact-match query (caller supplies the quoting). */
function google(query: string): string {
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
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

    const web: ResearchLink[] = [
        { id: "google", name: "Google", url: google(quoted) },
        {
            id: "google-reports",
            name: "Google (reports)",
            url: google(`${quoted} malware OR threat OR abuse OR report`),
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
            { id: "censys", name: "Censys", url: `https://search.censys.io/hosts/${e}` },
            { id: "shodan", name: "Shodan", url: `https://www.shodan.io/host/${e}` },
        );
    } else if (kind === "domain") {
        osint.push(
            { id: "urlscan", name: "URLScan", url: `https://urlscan.io/domain/${e}` },
            {
                id: "censys",
                name: "Censys",
                url: `https://search.censys.io/search?resource=hosts&q=${e}`,
            },
            { id: "shodan", name: "Shodan", url: `https://www.shodan.io/domain/${e}` },
        );
    }
    osint.push({
        id: "pulsedive",
        name: "Pulsedive",
        url: `https://pulsedive.com/indicator/?ioc=${e}`,
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
