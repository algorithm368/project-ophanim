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

const FEED_V6 = [
  '{"cidr":"2001:678:254::/48","sblid":"SBL697648","rir":"ripencc"}',
  '{"cidr":"2001:678:6c0::/48","sblid":"SBL624855","rir":"ripencc"}',
].join("\n");

describe("matchDrop — IPv6", () => {
  const blocks = parseDropFeed(FEED_V6);

  it("parses the v6 feed with the same shape as v4", () => {
    expect(blocks).toEqual([
      { cidr: "2001:678:254::/48", sblid: "SBL697648" },
      { cidr: "2001:678:6c0::/48", sblid: "SBL624855" },
    ]);
  });

  it("returns the /48 that contains the address", () => {
    expect(matchDrop("2001:678:254:abcd::1", blocks)).toEqual({
      cidr: "2001:678:254::/48",
      sblid: "SBL697648",
    });
  });

  it("returns null when no v6 block contains the address", () => {
    expect(matchDrop("2001:4860:4860::8888", blocks)).toBeNull();
  });

  it("does not match a v4 address against v6 blocks", () => {
    expect(matchDrop("8.8.8.8", blocks)).toBeNull();
  });
});
