#!/usr/bin/env node
/**
 * Stage the Thailand-only WAF policy on the Vercel project.
 *
 * Two custom rules, in this order, because order is the whole design:
 *
 *   1. "Vercel telemetry"  bypass  path starts with /_vercel
 *   2. "DENY NOT THAI"     deny    geo_country is not TH
 *
 * Rule 2 already existed on the project, authored by hand and left disabled;
 * this script enables it rather than adding a second rule that says the same
 * thing. Rule 1 is the new part. `bypass` skips every remaining custom rule
 * and managed ruleset, so rule 1 has to sit above rule 2 or the deny swallows
 * it, which is why the reorder at the bottom is not decoration.
 *
 * Speed Insights and Web Analytics are served from the deployment's own origin
 * (/_vercel/speed-insights/{script.js,vitals} and /_vercel/insights/
 * {script.js,event}), so this is what "let Speed Insights through" actually
 * means here: a path exemption, not an IP allowlist. Vercel never calls back
 * into the app to collect vitals, the visitor's browser posts them, from the
 * visitor's own IP.
 *
 * Everything this stages is a draft. Review with `vercel firewall rules list
 * --json` (note that `vercel firewall diff` and `overview` both 404 on Hobby,
 * they try to read IP Bypass, which the plan does not include), then publish
 * yourself:
 *
 *   vercel firewall publish --yes
 *
 * Usage:
 *   node scripts/firewall.mjs          # telemetry bypass + enable the deny
 *   node scripts/firewall.mjs --log    # same, but the geo rule only logs
 *   node scripts/firewall.mjs --off    # disable the geo rule, keep it around
 *
 * --log is the cautious first step: the rule records who it would have turned
 * away without turning them away, visible at
 * https://vercel.com/siriwatchr-1256s-projects/project-ophanim/firewall/traffic
 * Re-run with no flags to switch it to deny.
 *
 * Note that Hobby has no system-bypass, so there is no "let my own IP through
 * anyway" escape hatch. If this locks you out while travelling, disable the
 * rule from the Vercel dashboard, which is not behind your own firewall.
 */

import { execFileSync } from "node:child_process";

const TELEMETRY = "Vercel telemetry";
const GEO = "DENY NOT THAI";

const argv = new Set(process.argv.slice(2));
const logOnly = argv.has("--log");
const off = argv.has("--off");

if (logOnly && off) {
  console.error("--log and --off contradict each other; pick one.");
  process.exit(1);
}

/** Run the Vercel CLI, returning stdout. */
function vercel(args, { capture = false } = {}) {
  return execFileSync("vercel", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

/** The rules already on the project, by name. */
function existingRuleNames() {
  let out;
  try {
    out = vercel(["firewall", "rules", "list", "--json"], { capture: true });
  } catch (err) {
    console.error(
      "Could not read the current firewall rules. Run `vercel login` and " +
        "`vercel link` first.\n" +
        (err.stderr || err.message),
    );
    process.exit(1);
  }
  // The CLI prints a version banner before the JSON, so start at the brace.
  const json = out.slice(out.indexOf("{"));
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return new Set();
  }
  const rules = Array.isArray(parsed) ? parsed : (parsed.rules ?? []);
  return new Set(rules.map((r) => r?.name).filter(Boolean));
}

const present = existingRuleNames();

if (off) {
  vercel(["firewall", "rules", "disable", GEO]);
  console.log(`\nDisabled "${GEO}" (staged).`);
  console.log("Publish: vercel firewall publish --yes");
  process.exit(0);
}

// The telemetry exemption. `edit --condition` replaces the whole condition
// list, so both branches pass the full set and cannot drift apart.
const conditions = [{ type: "path", op: "pre", value: "/_vercel" }];
const flags = conditions.flatMap((c) => ["--condition", JSON.stringify(c)]);

if (present.has(TELEMETRY)) {
  vercel([
    "firewall", "rules", "edit", TELEMETRY,
    ...flags, "--action", "bypass", "--yes",
  ]);
} else {
  vercel([
    "firewall", "rules", "add", TELEMETRY,
    ...flags, "--action", "bypass",
    "--description",
    "Speed Insights and Web Analytics are same-origin under /_vercel; " +
      "exempt them so no later rule can cost us the measurements.",
    "--yes",
  ]);
}

if (!present.has(GEO)) {
  console.error(
    `\nExpected an existing "${GEO}" rule and did not find one. ` +
      "Nothing was staged for the geo block; check `vercel firewall rules list`.",
  );
  process.exit(1);
}

vercel([
  "firewall", "rules", "edit", GEO,
  "--condition", JSON.stringify({
    type: "geo_country", op: "eq", neg: true, value: "TH",
  }),
  "--action", logOnly ? "log" : "deny",
  "--yes",
]);
vercel(["firewall", "rules", "enable", GEO]);

// Priority is top to bottom and `bypass` short-circuits, so the telemetry
// exemption is only an exemption while it is above the deny.
vercel(["firewall", "rules", "reorder", TELEMETRY, "--first", "--yes"]);
vercel(["firewall", "rules", "reorder", GEO, "--position", "2", "--yes"]);

console.log(`\nStaged. "${GEO}" is enabled in ${logOnly ? "log" : "deny"} mode.`);
console.log("Review:  vercel firewall rules list --expand");
console.log("Publish: vercel firewall publish --yes");
