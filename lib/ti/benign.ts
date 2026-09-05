/**
 * Hashes that are benign by definition, so the aggregate must not label them
 * malicious no matter how many scanners flag them.
 *
 * Two kinds live here, and the marker says which, because the reason an
 * analyst needs differs:
 *
 * - **Test artifacts**, published so scanners can be verified. Detections are
 *   the file working as intended.
 * - **Degenerate content**, where the digest is of something that cannot carry
 *   code at all. The empty file is the case that matters: URLhaus records the
 *   payload hash of every malware-distribution URL it visits, and a URL that
 *   served a zero-byte response contributes this digest, so `e3b0c442…` is
 *   genuinely listed 2251 times as a malware payload. It is still an empty
 *   file.
 */
const TEST_ARTIFACTS = new Set<string>([
  "44d88612fea8a8f36de82e1278abb02f", // EICAR md5
  "3395856ce81f2b7382dee72602f798b642f14140", // EICAR sha1
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f", // EICAR sha256
]);

const EMPTY_FILE = new Set<string>([
  "d41d8cd98f00b204e9800998ecf8427e", // md5 of zero bytes
  "da39a3ee5e6b4b0d3255bfef95601890afd80709", // sha1
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // sha256
]);

export type BenignReason = "eicar-test-file" | "empty-file";

/** Returns a stable marker for a known-benign hash, else undefined. */
export function isKnownBenignHash(hash: string): BenignReason | undefined {
  const key = hash.toLowerCase();
  if (TEST_ARTIFACTS.has(key)) return "eicar-test-file";
  if (EMPTY_FILE.has(key)) return "empty-file";
  return undefined;
}

/** Plain-language reason a hash was forced clean. */
export const BENIGN_REASON: Record<BenignReason, string> = {
  "eicar-test-file":
    "EICAR standard anti-malware test file, forced clean. Vendor detections are the file working as intended.",
  "empty-file":
    "The digest of a zero-byte file, forced clean. Feeds record it as a malware payload because a distribution URL served an empty response, which says nothing about this file.",
};
