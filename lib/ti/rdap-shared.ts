/**
 * Shared RDAP entity/vCard parsing for the IP and domain RDAP adapters. RDAP
 * nests contacts (abuse / technical / registrant) as sub-entities and encodes
 * each contact as a jCard (vcardArray): `["vcard", [[name, params, type, value], …]]`.
 */

export interface RdapVcardEntity {
  roles?: string[];
  vcardArray?: [string, unknown[]];
  entities?: RdapVcardEntity[];
}

/** Pull a vCard field value (e.g. "fn", "email", "org") from an RDAP entity. */
export function vcardField(
  entity: RdapVcardEntity | undefined,
  field: string,
): string | undefined {
  const vcard = entity?.vcardArray?.[1];
  if (!Array.isArray(vcard)) return undefined;
  for (const entry of vcard) {
    if (
      Array.isArray(entry) &&
      entry[0] === field &&
      typeof entry[3] === "string" &&
      entry[3]
    ) {
      return entry[3];
    }
  }
  return undefined;
}

/** Depth-first search for the first entity holding `role` — RDAP nests the
 *  abuse/technical contacts inside the registrant/registrar entity. */
export function findEntityByRole(
  entities: RdapVcardEntity[] | undefined,
  role: string,
): RdapVcardEntity | undefined {
  for (const e of entities ?? []) {
    if (e.roles?.includes(role)) return e;
    const nested = findEntityByRole(e.entities, role);
    if (nested) return nested;
  }
  return undefined;
}

/** Abuse contact (email + org) from an RDAP entity tree, when published. */
export function abuseContact(
  entities: RdapVcardEntity[] | undefined,
): { email?: string; org?: string } | undefined {
  const e = findEntityByRole(entities, "abuse");
  if (!e) return undefined;
  const email = vcardField(e, "email");
  const org = vcardField(e, "org") ?? vcardField(e, "fn");
  if (!email && !org) return undefined;
  return { email, org };
}
