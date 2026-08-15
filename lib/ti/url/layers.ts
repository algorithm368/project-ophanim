import type { Verdict } from "../types";
import type { LayerKind, UrlLayer } from "./types";

/** Most specific first. Used only to break a score tie. */
const SPECIFICITY: LayerKind[] = ["url", "domain", "ip"];

/**
 * The headline is the worst layer that actually ran.
 *
 * A layer that could not run contributes nothing, and when none ran the
 * headline is `unknown` rather than `clean`. That asymmetry is deliberate:
 * "no source had anything to say" and "every source vouched for this" produce
 * the same empty evidence set, and only one of them is safe to report as clean.
 *
 * Ties break toward the more specific layer, so when the URL and its host score
 * alike the verdict is attributed to the URL, which is what the analyst pasted.
 */
export function selectHeadline(layers: UrlLayer[]): {
  kind: LayerKind;
  riskScore: number;
  verdict: Verdict;
} {
  const ran = layers.filter((layer) => layer.status === "ok");
  if (ran.length === 0) {
    return { kind: "url", riskScore: 0, verdict: "unknown" };
  }
  const worst = [...ran].sort(
    (a, b) =>
      b.riskScore - a.riskScore ||
      SPECIFICITY.indexOf(a.kind) - SPECIFICITY.indexOf(b.kind),
  )[0];
  return {
    kind: worst.kind,
    riskScore: worst.riskScore,
    verdict: worst.verdict,
  };
}
