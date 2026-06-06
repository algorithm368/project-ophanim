import { describe, expect, it } from "vitest";
import { eventDate, registrarName, scoreForAge } from "./rdap";

describe("scoreForAge", () => {
  it("scores newer registrations higher, decaying to 0 by 90 days", () => {
    expect(scoreForAge(undefined)).toBe(0);
    expect(scoreForAge(3)).toBe(55);
    expect(scoreForAge(7)).toBe(40);
    expect(scoreForAge(29)).toBe(40);
    expect(scoreForAge(30)).toBe(20);
    expect(scoreForAge(89)).toBe(20);
    expect(scoreForAge(90)).toBe(0);
    expect(scoreForAge(1000)).toBe(0);
  });
});

describe("eventDate", () => {
  const events = [
    { eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" },
    { eventAction: "expiration", eventDate: "2030-01-01T00:00:00Z" },
  ];

  it("finds the date for a given action", () => {
    expect(eventDate(events, "registration")).toBe("2020-01-01T00:00:00Z");
  });

  it("returns undefined for a missing action or events", () => {
    expect(eventDate(events, "last changed")).toBeUndefined();
    expect(eventDate(undefined, "registration")).toBeUndefined();
  });
});

describe("registrarName", () => {
  it("reads the registrar entity's vCard 'fn' field", () => {
    const entities = [
      { roles: ["technical"] },
      {
        roles: ["registrar"],
        vcardArray: [
          "vcard",
          [
            ["version", {}, "text", "4.0"],
            ["fn", {}, "text", "GoDaddy.com, LLC"],
          ],
        ] as [string, unknown[]],
      },
    ];
    expect(registrarName(entities)).toBe("GoDaddy.com, LLC");
  });

  it("returns undefined when there is no registrar entity", () => {
    expect(registrarName([{ roles: ["registrant"] }])).toBeUndefined();
    expect(registrarName(undefined)).toBeUndefined();
  });
});
