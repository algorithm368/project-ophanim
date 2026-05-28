export type HashAlgorithm = "md5" | "sha1" | "sha256";

export interface ParsedHash {
  /** Normalized hash: lowercased hex, whitespace stripped. */
  hash: string;
  algorithm: HashAlgorithm;
}

/** Hex length -> algorithm for the file-hash types TI feeds index by. */
const LENGTH_TO_ALGO: Record<number, HashAlgorithm> = {
  32: "md5",
  40: "sha1",
  64: "sha256",
};

const HEX_RE = /^[a-f0-9]+$/;

/**
 * Parse and validate a file hash. Accepts MD5 (32), SHA-1 (40), or SHA-256
 * (64) hex digests; tolerates surrounding whitespace and a leading algorithm
 * label like "sha256:" that scanners sometimes prepend. Returns null for
 * anything that isn't one of those exact hex lengths.
 */
export function parseHash(input: string): ParsedHash | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;

  // Drop an "md5:"/"sha256:" style prefix if present.
  const colon = value.lastIndexOf(":");
  if (colon !== -1) value = value.slice(colon + 1).trim();

  if (!HEX_RE.test(value)) return null;

  const algorithm = LENGTH_TO_ALGO[value.length];
  if (!algorithm) return null;

  return { hash: value, algorithm };
}

export const HASH_ALGO_LABEL: Record<HashAlgorithm, string> = {
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
};
