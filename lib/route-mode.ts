/**
 * The two ways an indicator is read, as routes.
 *
 * `/check/<ioc>` is the passive reading, assembled from records other people
 * already keep. `/scan/<ioc>` is the active one, which visits the address. They
 * are separate pages rather than one page with a switch inside it, so a link
 * into a ticket says which kind of reading it points at.
 *
 * The parsing lives here rather than in the header component because it is the
 * one place that knows the path shape, and because a wrong answer sends the
 * analyst to the wrong reading.
 */
import { detectIOC } from "@/lib/ioc";
import { parseUrl } from "@/lib/url";

export type ReadingMode = "passive" | "active";

export interface ModeRoute {
  mode: ReadingMode;
  /** The indicator, decoded. Percent-encoding is how a URL indicator survives
   *  being a path segment. Absent on the two landing pages, which are the mode
   *  with nothing read in it yet. */
  indicator?: string;
}

const MODE_OF_SEGMENT: Record<string, ReadingMode> = {
  check: "passive",
  scan: "active",
};

const SEGMENT_OF_MODE: Record<ReadingMode, string> = {
  passive: "check",
  active: "scan",
};

/**
 * The mode a pathname is in, and the indicator it reads, if any.
 *
 * Each mode has a landing page as well as a result page: `/` takes an indicator
 * to look up, `/scan` takes one to visit. Both are the mode with nothing in it
 * yet, so the switch is on screen from the first moment rather than appearing
 * once a result exists. Null is for a path in neither mode, where a switch
 * would be a claim about a page it does not belong to.
 */
export function modeRouteFor(pathname: string): ModeRoute | null {
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0) return { mode: "passive" };
  if (parts.length === 1) {
    return parts[0] === SEGMENT_OF_MODE.active ? { mode: "active" } : null;
  }
  if (parts.length !== 2) return null;

  const mode = MODE_OF_SEGMENT[parts[0]];
  if (!mode) return null;

  let indicator: string;
  try {
    indicator = decodeURIComponent(parts[1]);
  } catch {
    // A malformed escape means the path was not one we wrote. Better no switch
    // than a switch pointing at a mangled indicator.
    return null;
  }
  return indicator ? { mode, indicator } : null;
}

/** The path for reading this indicator in that mode, or the mode's landing page
 *  when there is no indicator to carry across. */
export function modeHref(mode: ReadingMode, indicator?: string): string {
  const base = mode === "passive" ? "" : `/${SEGMENT_OF_MODE.active}`;
  if (!indicator) return base || "/";
  return `/${SEGMENT_OF_MODE[mode]}/${encodeURIComponent(indicator)}`;
}

/**
 * Where the passive reading of an indicator lives.
 *
 * Passive mode has no reading of a URL (`/check/<url>` redirects back to the
 * scan page), so a URL crosses over as its host, whose reputation is the
 * passive question a URL raises.
 */
export function passiveHref(indicator: string): string {
  const host =
    detectIOC(indicator) === "url" ? parseUrl(indicator)?.host : undefined;
  return modeHref("passive", host ?? indicator);
}
