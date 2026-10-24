#!/usr/bin/env bun
/**
 * What is behind, and why, in one place.
 *
 * Dependabot opens the upgrade pull requests (.github/dependabot.yml), but three
 * things never show up in them:
 *
 *   - everything that is behind, as one list. Its groups open on their own
 *     schedules, so a package with no open PR is simply absent, and "what have
 *     we not upgraded" took a manual `bun outdated`.
 *   - the upgrades held back on purpose. An ignored major goes quiet, and
 *     nothing says when the package blocking it starts to accept it.
 *   - Bun itself, which is not a package here. CI takes the newest release and
 *     Vercel takes whichever line `bunVersion` names, and that gap is what
 *     failed every deploy on #118 (1.3.14 on Vercel, 1.4.4 in CI).
 *
 * Installed versions come from node_modules, so run it after `bun install`. It
 * needs Bun for `Bun.semver`, and `gh` for the open Dependabot PRs and the
 * newest Bun release.
 *
 * Usage:
 *   bun scripts/deps-watch.mjs           print the report
 *   bun scripts/deps-watch.mjs --issue   write it into the tracking issue
 *
 * With --issue, one issue labelled `deps-watch` carries the report: created or
 * reopened when something needs attention, edited in place on every run, and
 * closed once nothing does. A held-back upgrade keeps it open only while some
 * release short of latest is there to take, since waiting on someone else's
 * release is not something to act on; the day that release lands, the upgrade
 * moves to "Behind" and the issue reopens.
 * .github/workflows/deps-watch.yml runs this weekly.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "deps-watch";
const TITLE = "Dependency watch";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const gh = (args, input) => execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", input });
const newer = (a, b) => Bun.semver.order(a, b) > 0;

/** Code-unit order, the same deterministic comparison lib/ti/sort.ts uses. */
function byCodeUnit(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** The registry's manifest for a package's latest release, peers included. */
const manifests = new Map();
function latest(name) {
  if (!manifests.has(name)) {
    manifests.set(
      name,
      fetch(`https://registry.npmjs.org/${name}/latest`).then((res) => {
        if (!res.ok) throw new Error(`${res.status} from the registry for ${name}`);
        return res.json();
      }),
    );
  }
  return manifests.get(name);
}

/**
 * Every installed package with its peer ranges, nested copies included. Peers
 * are what hold an upgrade back: typescript 7 installs fine, it is
 * typescript-eslint's `typescript: <6.1.0` that makes the lint unable to load.
 */
function installed(dir = join(ROOT, "node_modules"), out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const paths = entry.startsWith("@")
      ? readdirSync(join(dir, entry)).map((sub) => join(dir, entry, sub))
      : [join(dir, entry)];
    for (const path of paths) {
      const manifest = join(path, "package.json");
      if (existsSync(manifest)) {
        const { name, version, peerDependencies } = readJson(manifest);
        out.push({ name, version, peers: peerDependencies ?? {} });
      }
      installed(join(path, "node_modules"), out);
    }
  }
  return out;
}

/**
 * The installed packages whose peer range refuses `dep`'s latest version, each
 * checked again at its own latest release. A blocker whose newest release
 * already accepts it is a step to take (upgrade both together), not a reason
 * to wait, so it carries the release that clears it.
 */
async function blockersOf(dep, all) {
  const refusing = new Map();
  for (const p of all) {
    const range = p.peers[dep.name];
    if (range && !Bun.semver.satisfies(dep.latest, range) && !refusing.has(p.name)) {
      refusing.set(p.name, { name: p.name, range });
    }
  }
  return Promise.all(
    [...refusing.values()].map(async (b) => {
      const next = await latest(b.name);
      const range = next.peerDependencies?.[dep.name];
      const clears = !range || Bun.semver.satisfies(dep.latest, range);
      return { ...b, clearedBy: clears ? next.version : undefined };
    }),
  );
}

/**
 * Which packages the open Dependabot PRs move, and to what. A grouped PR lists
 * each as "Updates `name` from x to y"; a single-package one says "Bumps
 * [name](url) from x to y."
 */
function dependabotMoves() {
  const prs = JSON.parse(
    gh(["pr", "list", "--author", "app/dependabot", "--state", "open", "--limit", "50", "--json", "number,body"]),
  );
  const moves = new Map();
  for (const { number, body } of prs) {
    for (const m of body.matchAll(/Updates `([^`]+)` from \S+ to (\S+)/g)) moves.set(m[1], { number, to: m[2] });
    for (const m of body.matchAll(/Bumps \[([^\]]+)\]\([^)]*\) from \S+ to (\d[^\s]*?)\.?(?:\s|$)/g)) {
      moves.set(m[1], { number, to: m[2] });
    }
  }
  return moves;
}

/**
 * Bun as CI and Vercel run it, against the newest release. Vercel names a line
 * rather than a version ("1.4.x"), and its "1.x" has meant the previous line
 * rather than the newest, so the check is whether `bunVersion` names the
 * newest release's line exactly.
 */
function bunLines() {
  const release = JSON.parse(gh(["api", "repos/oven-sh/bun/releases/latest"]));
  const newest = release.tag_name.replace(/^bun-v/, "");
  const line = `${newest.split(".").slice(0, 2).join(".")}.x`;
  const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const ciVersions = [...new Set([...ci.matchAll(/bun-version:\s*(\S+)/g)].map((m) => m[1]))];
  const vercel = readJson(join(ROOT, "vercel.json")).bunVersion;
  const ciBehind = ciVersions.filter((v) => v !== "latest" && !Bun.semver.satisfies(newest, v));
  const vercelBehind = vercel !== undefined && vercel !== line;
  return { newest, line, ciVersions, ciBehind, vercel, vercelBehind };
}

/**
 * The highest stable release every remaining blocker accepts, when it is newer
 * than what is installed. Held back is not the same as stuck: typescript 7
 * waited on typescript-eslint while 6.0 was there to take, and only a search
 * of the published versions shows that.
 */
async function reachable(dep) {
  const ranges = dep.blockers.filter((b) => !b.clearedBy).map((b) => b.range);
  const res = await fetch(`https://registry.npmjs.org/${dep.name}`, {
    // The abbreviated document: versions and their dependencies, without the
    // readme and per-version metadata that make the full one megabytes long.
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (!res.ok) throw new Error(`${res.status} from the registry for ${dep.name}`);
  const candidates = Object.keys((await res.json()).versions).filter(
    (v) =>
      !v.includes("-") &&
      newer(v, dep.installed) &&
      !newer(v, dep.latest) &&
      ranges.every((r) => Bun.semver.satisfies(v, r)),
  );
  return candidates.sort((a, b) => Bun.semver.order(b, a))[0];
}

async function gather() {
  const pkg = readJson(join(ROOT, "package.json"));
  const direct = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort(byCodeUnit);
  const all = installed();
  const versionOf = (name) => readJson(join(ROOT, "node_modules", name, "package.json")).version;
  const deps = await Promise.all(
    direct.map(async (name) => ({ name, installed: versionOf(name), latest: (await latest(name)).version })),
  );
  const behind = deps.filter((d) => newer(d.latest, d.installed));
  for (const dep of behind) dep.blockers = await blockersOf(dep, all);
  const held = behind.filter((d) => d.blockers.some((b) => !b.clearedBy));
  for (const dep of held) dep.reachable = await reachable(dep);
  return {
    actionable: behind.filter((d) => d.blockers.every((b) => b.clearedBy)),
    held,
    moves: dependabotMoves(),
    bun: bunLines(),
  };
}

/** "#117", "#117 (to 1.60.0)" when the PR stops short of latest, or "none". */
function prCell(dep, moves) {
  const move = moves.get(dep.name);
  if (!move) return "none";
  return move.to === dep.latest ? `#${move.number}` : `#${move.number} (to ${move.to})`;
}

/** Blockers that share a range, named once: "a, b and 3 more peer `<6.1.0`". */
function waitingOn(blockers) {
  const byRange = new Map();
  for (const b of blockers.filter((x) => !x.clearedBy)) {
    byRange.set(b.range, [...(byRange.get(b.range) ?? []), b.name]);
  }
  return [...byRange]
    .map(([range, names]) => {
      const shown = names.slice(0, 2).join(", ");
      const more = names.length > 2 ? ` and ${names.length - 2} more` : "";
      // A bare | ends a table cell even inside backticks; GitHub reads \| as one.
      return `${shown}${more} peer \`${range.replaceAll("|", String.raw`\|`)}\``;
    })
    .join("; ");
}

function render({ actionable, held, moves, bun }) {
  const out = [`_Updated ${new Date().toISOString().slice(0, 10)} by \`scripts/deps-watch.mjs\`. Dependabot opens the upgrade PRs; this is what they do not show._`, ""];

  out.push(`### Behind (${actionable.length})`, "");
  if (actionable.length === 0) out.push("Everything that can move is current.", "");
  else {
    out.push("| Package | Installed | Latest | Open PR | Upgrade with |", "|---|---|---|---|---|");
    for (const d of actionable) {
      const along = d.blockers.map((b) => `${b.name} ${b.clearedBy}`).join(", ");
      out.push(`| ${d.name} | ${d.installed} | ${d.latest} | ${prCell(d, moves)} | ${along} |`);
    }
    out.push("");
  }

  out.push(`### Held back (${held.length})`, "");
  if (held.length === 0) out.push("Nothing is waiting on another package.", "");
  else {
    out.push("| Package | Installed | Can reach now | Latest | Waiting on |", "|---|---|---|---|---|");
    for (const d of held) {
      out.push(`| ${d.name} | ${d.installed} | ${d.reachable ?? "nothing newer"} | ${d.latest} | ${waitingOn(d.blockers)} |`);
    }
    out.push("");
  }

  out.push("### Bun", "", "| Where | Runs | |", "|---|---|---|");
  out.push(`| Newest release | ${bun.newest} | |`);
  for (const v of bun.ciVersions) out.push(`| CI, \`ci.yml\` | ${v} | ${bun.ciBehind.includes(v) ? "behind" : "current"} |`);
  if (bun.vercel !== undefined) {
    const note = bun.vercelBehind ? `behind, check whether Vercel offers \`${bun.line}\`` : "current";
    out.push(`| Vercel, \`vercel.json\` | ${bun.vercel} | ${note} |`);
  }
  return out.join("\n");
}

/** Create, reopen, edit or close the one tracking issue to match the report. */
function syncIssue(body, attention) {
  gh(["label", "create", LABEL, "--force", "--color", "ededed", "--description", "Kept current by scripts/deps-watch.mjs"]);
  const [issue] = JSON.parse(gh(["issue", "list", "--label", LABEL, "--state", "all", "--limit", "1", "--json", "number,state"]));
  if (!attention) {
    if (issue?.state === "OPEN") {
      gh(["issue", "edit", String(issue.number), "--body-file", "-"], body);
      gh(["issue", "close", String(issue.number), "--comment", "Nothing left to act on."]);
      return `closed #${issue.number}`;
    }
    return "nothing to act on, no issue open";
  }
  if (!issue) return gh(["issue", "create", "--title", TITLE, "--label", LABEL, "--body-file", "-"], body).trim();
  if (issue.state !== "OPEN") gh(["issue", "reopen", String(issue.number)]);
  gh(["issue", "edit", String(issue.number), "--body-file", "-"], body);
  return `updated #${issue.number}`;
}

const report = await gather();
const body = render(report);
console.log(body);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
if (process.argv.includes("--issue")) {
  const attention =
    report.actionable.length > 0 ||
    report.held.some((d) => d.reachable) ||
    report.bun.ciBehind.length > 0 ||
    report.bun.vercelBehind;
  console.log(`\n${syncIssue(body, attention)}`);
}
