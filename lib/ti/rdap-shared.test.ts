import { describe, expect, it } from "vitest";
import {
  abuseContact,
  findEntityByRole,
  vcardField,
  type RdapVcardEntity,
} from "./rdap-shared";

// Shaped like a live rdap.org/ip response: a registrant entity with the abuse
// contact nested inside it.
const entities: RdapVcardEntity[] = [
  {
    roles: ["registrant"],
    vcardArray: [
      "vcard",
      [
        ["version", {}, "text", "4.0"],
        ["fn", {}, "text", "Google LLC"],
        ["kind", {}, "text", "org"],
      ],
    ],
    entities: [
      {
        roles: ["abuse"],
        vcardArray: [
          "vcard",
          [
            ["fn", {}, "text", "Abuse"],
            ["org", {}, "text", "Google Abuse"],
            ["email", {}, "text", "network-abuse@google.com"],
          ],
        ],
      },
    ],
  },
];

describe("vcardField", () => {
  it("extracts a named field's value", () => {
    expect(vcardField(entities[0], "fn")).toBe("Google LLC");
  });
  it("returns undefined for a missing field or bad vcard", () => {
    expect(vcardField(entities[0], "email")).toBeUndefined();
    expect(vcardField({}, "fn")).toBeUndefined();
  });
});

describe("findEntityByRole", () => {
  it("finds a role nested inside another entity", () => {
    expect(findEntityByRole(entities, "abuse")?.roles).toEqual(["abuse"]);
    expect(findEntityByRole(entities, "registrant")?.roles).toEqual([
      "registrant",
    ]);
  });
  it("returns undefined when the role is absent", () => {
    expect(findEntityByRole(entities, "billing")).toBeUndefined();
    expect(findEntityByRole(undefined, "abuse")).toBeUndefined();
  });
});

describe("abuseContact", () => {
  it("pulls the nested abuse email + org", () => {
    expect(abuseContact(entities)).toEqual({
      email: "network-abuse@google.com",
      org: "Google Abuse",
    });
  });
  it("is undefined when no abuse entity is published", () => {
    expect(abuseContact([{ roles: ["registrant"] }])).toBeUndefined();
  });
});
