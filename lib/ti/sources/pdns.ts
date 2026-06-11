import { makeMnemonicPassiveDnsSource } from "../passive-dns";

/** Passive DNS for an IP: the domains historically resolved to it (no key, no score). */
export const pdnsSource = makeMnemonicPassiveDnsSource({
  id: "mnemonic-pdns",
  lookup: "ip",
});
