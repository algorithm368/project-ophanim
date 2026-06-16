import { describe, expect, it } from "vitest";
import { researchLinks } from "./research";

/** Flatten sections into an id -> url map for terse assertions. */
function linkMap(indicator: string, kind: "ip" | "domain" | "hash") {
    const map: Record<string, string> = {};
    for (const section of researchLinks(indicator, kind)) {
        for (const link of section.links) map[link.id] = link.url;
    }
    return map;
}

describe("researchLinks", () => {
    it("builds web + osint + sandbox sections for an IP", () => {
        const sections = researchLinks("1.2.3.4", "ip");
        expect(sections.map((s) => s.id)).toEqual(["web", "osint", "sandbox"]);

        const links = linkMap("1.2.3.4", "ip");
        // Web search quotes the indicator for an exact match.
        expect(links.google).toBe(
            "https://www.google.com/search?q=%221.2.3.4%22",
        );
        // IP recon uses the per-host pages.
        expect(links.censys).toBe("https://platform.censys.io/hosts/1.2.3.4");
        expect(links.shodan).toBe("https://www.shodan.io/host/1.2.3.4");
        expect(links.urlscan).toBe("https://urlscan.io/search/#1.2.3.4");
        expect(links.triage).toBe("https://tria.ge/s?q=1.2.3.4");
    });

    it("uses domain-specific recon pages for a domain", () => {
        const links = linkMap("evil.com", "domain");
        expect(links.urlscan).toBe("https://urlscan.io/domain/evil.com");
        expect(links.shodan).toBe("https://www.shodan.io/domain/evil.com");
        expect(links.censys).toBe(
            "https://platform.censys.io/search?q=evil.com",
        );
        // Pulsedive base64-decodes its ioc param, so the value is base64 then
        // URL-encoded ("evil.com" -> "ZXZpbC5jb20=").
        expect(links.pulsedive).toBe(
            "https://pulsedive.com/indicator/?ioc=ZXZpbC5jb20%3D",
        );
    });

    it("drops host/infra recon for a bare hash, keeping web + sandboxes + pulsedive", () => {
        const hash =
            "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f";
        const links = linkMap(hash, "hash");
        // No infrastructure to pivot on for a hash.
        expect(links.censys).toBeUndefined();
        expect(links.shodan).toBeUndefined();
        expect(links.urlscan).toBeUndefined();
        // Web search, the indicator-agnostic recon, and sandboxes remain.
        expect(links.google).toBe(
            `https://www.google.com/search?q=%22${hash}%22`,
        );
        expect(links.pulsedive).toBe(
            "https://pulsedive.com/indicator/?ioc=Mjc1YTAyMWJiZmI2NDg5ZTU0ZDQ3MTg5OWY3ZGI5ZDE2NjNmYzY5NWVjMmZlMmEyYzQ1MzhhYWJmNjUxZmQwZg%3D%3D",
        );
        expect(links.joesandbox).toBe(
            `https://www.joesandbox.com/search?q=${hash}`,
        );
    });

    it("url-encodes the indicator everywhere it is interpolated", () => {
        // A value with characters that must be escaped in a query string.
        const links = linkMap("a b&c", "ip");
        expect(links.github).toContain("%22a%20b%26c%22");
        // Pulsedive base64-encodes the raw value, so query-string escaping does
        // not leak into its ioc param ("a b&c" -> base64 "YSBiJmM=").
        expect(links.pulsedive).toBe(
            "https://pulsedive.com/indicator/?ioc=YSBiJmM%3D",
        );
        // The "reports" query keeps the OR operators readable after encoding.
        expect(links["google-reports"]).toContain(
            "malware%20OR%20threat%20OR%20abuse%20OR%20report",
        );
    });
});
