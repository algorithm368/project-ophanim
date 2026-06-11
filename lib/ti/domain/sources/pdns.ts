import { makeMnemonicPassiveDnsSource } from "../../passive-dns";

/** Passive DNS for a domain: the IPs it has historically resolved to (no key, no score). */
export const pdnsDomainSource = makeMnemonicPassiveDnsSource({
  id: "mnemonic-pdns",
  lookup: "domain",
});
