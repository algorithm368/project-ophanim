/**
 * ISO 3166-1 alpha-2 country code -> flag image URL. We use real images rather
 * than emoji flags because Windows doesn't render regional-indicator emoji as
 * flags (it shows the two letters instead). Shared by the result views; the
 * single-result view in CheckResults has its own copy pending a future merge.
 */
export function flagUrl(cc?: string): string | undefined {
  if (!cc || !/^[a-zA-Z]{2}$/.test(cc)) return undefined;
  return `https://flagcdn.com/${cc.toLowerCase()}.svg`;
}
