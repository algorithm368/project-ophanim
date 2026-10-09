const INTERNAL_TLDS = ["internal", "corp", "lan", "intranet", "home.arpa"];

function configured(): string[] {
  return (process.env.TI_INTERNAL_SUFFIXES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

const under = (name: string, suffix: string) => name === suffix || name.endsWith(`.${suffix}`);

/** A name that belongs to the analyst's own network. Bulk never sends one out:
 *  an AD hostname handed to VirusTotal is a leak of internal infrastructure. */
export function isInternalName(domain: string): boolean {
  const name = domain.toLowerCase();
  if (!name.includes(".")) return true;
  return [...configured(), ...INTERNAL_TLDS].some((suffix) => under(name, suffix));
}
