import type { DomainContext, SourceFinding, TiSource } from "../../types";
import { errorMessage, getJson, isTimeout } from "../../http";

/**
 * Cloudflare Domain Intelligence: what kind of site this is.
 *
 * Cloudflare Radar's own domain search is the public face of this data, but
 * Radar's API exposes only a popularity bucket (`/radar/ranking/domain/{d}`
 * returns `bucket` and an always-empty `categories` array), which Tranco
 * already answers better. The categories behind Radar's domain pages come from
 * the account Intel endpoint used here, which is why this adapter talks to
 * `/accounts/{id}/intel/domain` rather than `/radar`.
 *
 * Context only, weight 0. A category is a statement about what a site is for,
 * never about whether it is dangerous: "Pornography" and "Personal Finance" are
 * both perfectly ordinary answers, and letting either move the score would be
 * scoring a site's subject matter rather than its behaviour.
 */
export interface CfCategory {
  id?: number;
  name?: string;
  /** Present on the specific category, absent on the umbrella one. */
  super_category_id?: number;
}

export interface CfIntelResponse {
  result?: {
    domain?: string;
    type?: string;
    application?: { id?: number; name?: string };
    content_categories?: CfCategory[];
    popularity_rank?: number;
  };
}

/**
 * The most specific category Cloudflare returned.
 *
 * The list pairs each specific category with its umbrella: pornhub.com comes
 * back as Pornography (super 2), Adult Themes (2), CIPA Filter (super 34),
 * CIPA (34). Carrying a `super_category_id` is what marks the specific half of
 * a pair, so it is the one worth printing; falling back to the first entry
 * covers a response that only ever had umbrellas.
 */
export function specificCategory(cats: CfCategory[] | undefined): string | undefined {
  const named = (cats ?? []).filter((c) => c.name);
  const specific = named.find((c) => c.super_category_id !== undefined);
  return (specific ?? named[0])?.name;
}

/** Every category name, specific ones first, deduped. */
export function categoryNames(cats: CfCategory[] | undefined): string[] {
  const named = (cats ?? []).filter((c): c is CfCategory & { name: string } => Boolean(c.name));
  const ordered = [
    ...named.filter((c) => c.super_category_id !== undefined),
    ...named.filter((c) => c.super_category_id === undefined),
  ];
  return [...new Set(ordered.map((c) => c.name))];
}

export function intelFinding(data: CfIntelResponse): SourceFinding {
  const res = data.result;
  const categories = categoryNames(res?.content_categories);
  const application = res?.application?.name;

  if (categories.length === 0 && !application) {
    // Cloudflare answers 200 with an empty body for a name it has never
    // categorised, which is most of the long tail. That is an answer, not a
    // failure, and it must not read as a broken source.
    return { status: "ok", summary: "Not categorised by Cloudflare" };
  }

  const domainContext: DomainContext = { categories };
  return {
    status: "ok",
    summary: categories.length ? categories.join(", ") : `Recognised as ${application}`,
    categories,
    domainContext,
    details: {
      categories,
      primaryCategory: specificCategory(res?.content_categories),
      application,
      popularityRank: res?.popularity_rank,
      domainType: res?.type,
    },
  };
}

const ACCOUNT_ENV = "CLOUDFLARE_ACCOUNT_ID";
const TOKEN_ENV = "CLOUDFLARE_API_TOKEN";

export const cloudflareIntelSource: TiSource = {
  meta: {
    id: "cloudflare-intel",
    name: "Cloudflare Radar",
    url: "https://radar.cloudflare.com/domains",
    category: "context",
    requiresKey: true,
    weight: 0,
    // Both halves are required, and `keyEnv` holds one name. The token is the
    // secret and the account id is not, so the token is the one surfaced.
    keyEnv: TOKEN_ENV,
  },
  isEnabled: () => Boolean(process.env[TOKEN_ENV] && process.env[ACCOUNT_ENV]),
  async check(domain, signal): Promise<SourceFinding> {
    const token = process.env[TOKEN_ENV];
    const account = process.env[ACCOUNT_ENV];
    if (!token || !account) return { status: "skipped" };
    try {
      const { ok, status, data } = await getJson<CfIntelResponse>(
        `https://api.cloudflare.com/client/v4/accounts/${account}/intel/domain?domain=${encodeURIComponent(domain)}`,
        signal,
        { authorization: `Bearer ${token}` },
      );
      if (!ok || !data) return { status: "error", error: `HTTP ${status}` };
      return { ...intelFinding(data), raw: data };
    } catch (err) {
      return { status: isTimeout(err) ? "timeout" : "error", error: errorMessage(err) };
    }
  },
};
