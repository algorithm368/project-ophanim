import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  // The clsx half: falsy branches drop out, so a conditional class can be
  // written inline without leaving "undefined" in the attribute.
  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("accepts arrays and conditional objects", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });

  // The tailwind-merge half, and the reason this is not just clsx: the later
  // utility must win rather than both landing in the attribute, where the
  // winner would depend on stylesheet order instead of call order.
  it("lets the last conflicting Tailwind utility win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm text-red-500", "text-lg")).toBe("text-red-500 text-lg");
  });

  it("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
  });
});
