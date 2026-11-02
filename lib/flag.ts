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

/**
 * The same flag as a 640px-wide PNG, for a flag stretched to fill a box.
 *
 * flagcdn's SVGs mostly carry a `viewBox`, and an SVG with one keeps its own
 * proportions inside the image box whatever `object-fit` says, so Italy's sat
 * in the middle of a cell with blank margins either side. A raster has no
 * proportions of its own to keep. 640 wide is twice the widest cell it fills.
 */
export function flagFillUrl(cc?: string): string | undefined {
  if (!cc || !/^[a-zA-Z]{2}$/.test(cc)) return undefined;
  return `https://flagcdn.com/w640/${cc.toLowerCase()}.png`;
}
