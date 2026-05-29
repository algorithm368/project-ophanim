import { describe, expect, it } from "vitest";
import { matchDrop, parseDropFeed } from "./spamhaus-drop";

const FEED = [
  '{"cidr":"1.10.16.0/20","sblid":"SBL256894","rir":"apnic"}',
  '{"cidr":"1.19.0.0/16","sblid":"SBL434604","rir":"apnic"}',
  '{"type":"metadata","timestamp":1700000000}', // no cidr -> skip
  "", // blank -> skip
  "; a comment line", // non-JSON -> skip
].join("\n");

describe("parseDropFeed", () => {
  it("keeps only the netblock lines (one JSON object per line)", () => {
    const blocks = parseDropFeed(FEED);
    expect(blocks).toEqual([
      { cidr: "1.10.16.0/20", sblid: "SBL256894" },
      { cidr: "1.19.0.0/16", sblid: "SBL434604" },
    ]);
  });

  it("returns an empty list for empty or junk input", () => {
    expect(parseDropFeed("")).toEqual([]);
    expect(parseDropFeed("not json\n<html>")).toEqual([]);
  });
});

describe("matchDrop", () => {
  const blocks = parseDropFeed(FEED);

  it("returns the netblock that contains the IP", () => {
    expect(matchDrop("1.19.5.5", blocks)).toEqual({
      cidr: "1.19.0.0/16",
      sblid: "SBL434604",
    });
  });

  it("returns null when no block contains the IP", () => {
    expect(matchDrop("8.8.8.8", blocks)).toBeNull();
  });
});
