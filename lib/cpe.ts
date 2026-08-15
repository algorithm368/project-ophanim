/** Minimal CPE (Common Platform Enumeration) parsing for display.
 *
 *  Shodan reports detected technologies as CPE strings in either the 2.2 URI
 *  form (`cpe:/a:nginx:nginx:1.18.0`) or the 2.3 formatted-string form
 *  (`cpe:2.3:a:nginx:nginx:1.18.0:*:*:*:*:*:*:*`). We only need the vendor,
 *  product, and version to render a readable chip, so this is deliberately
 *  small — not a full CPE grammar. */

export interface ParsedCpe {
    vendor?: string;
    product?: string;
    version?: string;
}

/** Normalize a single CPE component: unescape `\x`, turn `_` into spaces, and
 *  treat the wildcard / not-applicable markers (`*`, `-`, empty) as absent. */
function clean(part?: string): string | undefined {
    if (!part) return undefined;
    const v = part
        .replace(/\\(.)/g, "$1")
        .replaceAll("_", " ")
        .trim();
    return v === "" || v === "*" || v === "-" ? undefined : v;
}

/** Pull vendor / product / version out of a CPE string. Unknown fields come
 *  back undefined; a non-CPE string yields all-undefined. */
export function parseCpe(cpe: string): ParsedCpe {
    let rest = cpe.trim();
    for (const prefix of ["cpe:2.3:", "cpe:/", "cpe:"]) {
        if (rest.startsWith(prefix)) {
            rest = rest.slice(prefix.length);
            break;
        }
    }
    // Both forms put part / vendor / product / version in the first fields once
    // the prefix is stripped (2.3 leads with the part letter; 2.2 does too).
    const parts = rest.split(":");
    return {
        vendor: clean(parts[1]),
        product: clean(parts[2]),
        version: clean(parts[3]),
    };
}

/** A readable label for a CPE: the product name (vendors are usually redundant
 *  for recognizable software, e.g. nginx:nginx) plus the version when known.
 *  Falls back to the raw string if nothing parses. */
export function cpeLabel(cpe: string): { name: string; version?: string } {
    const { vendor, product, version } = parseCpe(cpe);
    return { name: product ?? vendor ?? cpe.trim(), version };
}
