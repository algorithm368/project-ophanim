/**
 * Hashes that are benign by definition, so the aggregate must not label them
 * malicious no matter how many scanners flag them. Today this is the EICAR
 * standard anti-malware test file (all three digests); add other vendor test
 * artifacts here as needed.
 */
export const KNOWN_BENIGN_HASHES = new Set<string>([
  "44d88612fea8a8f36de82e1278abb02f", // EICAR md5
  "3395856ce81f2b7382dee72602f798b642f14140", // EICAR sha1
  "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f", // EICAR sha256
]);

/** Returns a stable marker for a known-benign hash, else undefined. */
export function isKnownBenignHash(hash: string): string | undefined {
  return KNOWN_BENIGN_HASHES.has(hash.toLowerCase())
    ? "eicar-test-file"
    : undefined;
}
