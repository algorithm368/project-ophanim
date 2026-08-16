import { detectIOC, refangIOC, type IOCType } from "@/lib/ioc";
import { parseDomain } from "@/lib/domain";
import { parseIP } from "@/lib/ip";
import { parseUrl } from "@/lib/url";
import { scanTargetsFor } from "@/lib/ti/url/active/targets";
import { urlIndicatorProblem } from "@/lib/ti/url/validate";

/**
 * What the active search box makes of what was typed.
 *
 * The box on /scan sends the analyst to a page that will visit an address, so
 * it answers three questions before they get there: is this scannable at all,
 * what exactly would be visited, and under which name is the result filed. The
 * decision lives here rather than in the component because it is the same
 * boundary /api/scan-url enforces, and the two disagreeing would mean a box
 * that accepts input the route then refuses.
 */

export interface ScanInput {
  /** The canonical indicator, which is also its path segment. */
  indicator: string;
  kind: IOCType;
  /** The URLs a scan would submit. Shown before the analyst commits. */
  targets: string[];
}

export interface ScanInputProblem {
  message: string;
}

export function isScanProblem(
  read: ScanInput | ScanInputProblem,
): read is ScanInputProblem {
  return "message" in read;
}

/** The canonical form of an indicator: the parsed IP, the apex domain, or the
 *  normalized URL, so a pasted link and its host do not become two pages. */
function canonicalFor(value: string, kind: IOCType): string | null {
  if (kind === "ip") return parseIP(value)?.ip ?? null;
  if (kind === "domain") return parseDomain(value)?.domain ?? null;
  // A hash returns before this is called, so what is left is a URL.
  return parseUrl(value)?.canonical ?? null;
}

/**
 * Read the box. Null means it is empty, which is not a complaint to show.
 *
 * Defanged input is undefanged first: `evil[.]com` and `hxxps://` is how an
 * indicator arrives from a ticket, and refusing that shape would make the
 * analyst edit a string they were deliberately handed in a safe form.
 */
export function readScanInput(raw: string): ScanInput | ScanInputProblem | null {
  const value = refangIOC(raw.trim());
  if (!value) return null;

  const kind = detectIOC(value);
  if (!kind) {
    return {
      message: `"${value}" is not an IP, a domain, or a URL, so there is nothing to visit.`,
    };
  }
  if (kind === "hash") {
    return {
      message:
        "A file hash has no address to visit. Check its reputation passively instead.",
    };
  }

  // Detection said this is an IP, a domain, or a URL; the parsers get the final
  // say, and either failing means there is no address behind the input.
  const indicator = canonicalFor(value, kind);
  const targets = indicator ? scanTargetsFor(indicator, kind) : [];
  if (!indicator || targets.length === 0) {
    return { message: `"${value}" does not parse into an address to visit.` };
  }

  // The same rule the route applies. Asking a third party to fetch 192.168.1.1
  // both wastes the quota and tells them about internal addressing, so the box
  // says so here rather than letting the page collect a 422.
  const problem = targets.map(urlIndicatorProblem).find(Boolean);
  if (problem) return { message: problem.message };

  return { indicator, kind, targets };
}
