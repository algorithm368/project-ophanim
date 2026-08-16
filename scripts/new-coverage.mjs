#!/usr/bin/env node
/**
 * Sonar's `new_coverage` gate condition, computed locally.
 *
 * The gate that blocks a merge does not measure the whole project, it measures
 * the lines this change added or touched. So a branch can raise overall
 * coverage and still fail the gate, and the summary from `bun run coverage`
 * cannot tell you that. This intersects the coverage report with the diff and
 * prints the uncovered new lines file by file, which is the list you actually
 * have to write tests against.
 *
 * Usage:
 *   bun run coverage                     # writes coverage/lcov.info first
 *   node scripts/new-coverage.mjs [base] # base defaults to origin/main
 *
 * Only paths in the coverage scope count, matching sonar-project.properties:
 * `lib/`, excluding tests. app/, components/ and scripts/ are excluded there,
 * so an uncovered line in them is not what failed the gate and is not counted
 * here either.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LCOV = join(ROOT, "coverage", "lcov.info");
const THRESHOLD = 80;

if (!existsSync(LCOV)) {
  console.error("No coverage/lcov.info. Run `bun run coverage` first.");
  process.exit(2);
}

/** In coverage scope exactly when Sonar counts it: lib/, source only. */
function inScope(path) {
  return path.startsWith("lib/") && !/\.test\.tsx?$/.test(path);
}

/**
 * Per-file line hits and branch outcomes from an LCOV report.
 *
 * `DA:<line>,<hits>`: a line with 0 hits was instrumented and never executed,
 * while a line absent entirely was never instrumented (a type, a comment, a
 * blank) and so is not coverable at all. Conflating those two is how
 * "uncovered" ends up listing every import.
 *
 * `BRDA:<line>,<block>,<branch>,<taken>` matters because Sonar's coverage
 * metric is not line coverage. It is
 *
 *     (covered_lines + covered_conditions) / (lines_to_cover + conditions)
 *
 * so a fully-executed line whose ternary only ever went one way still drags the
 * number down. Counting lines alone reports a comfortable margin on a change
 * that is actually failing the gate, which is exactly what happened here.
 */
function lcovHits() {
  const byFile = new Map();
  let current = null;
  for (const line of readFileSync(LCOV, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      current = line.slice(3).trim().replace(`${ROOT}/`, "");
      byFile.set(current, { lines: new Map(), branches: new Map() });
    } else if (line.startsWith("DA:") && current) {
      const [no, hits] = line.slice(3).split(",");
      byFile.get(current).lines.set(Number(no), Number(hits));
    } else if (line.startsWith("BRDA:") && current) {
      const [no, , , taken] = line.slice(5).split(",");
      const branches = byFile.get(current).branches;
      const n = Number(no);
      if (!branches.has(n)) branches.set(n, []);
      // "-" means the branch was never reached at all, which is uncovered.
      branches.get(n).push(taken !== "-" && Number(taken) > 0);
    }
  }
  return byFile;
}

/**
 * git, as an absolute path.
 *
 * Resolved from a fixed list rather than left to PATH: PATH is writeable by
 * whoever is running this, so a `git` earlier on it would be executed instead,
 * and a script that shells out on demand is a convenient place to hide one.
 */
const GIT = [
  "/usr/bin/git",
  "/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
].find((candidate) => existsSync(candidate));

if (!GIT) {
  console.error("git was not found in any standard location.");
  process.exit(2);
}

/**
 * A revision this script is willing to hand to git.
 *
 * The base comes from argv, so it is untrusted input reaching an OS command.
 * execFileSync takes no shell, which rules out shell metacharacters, but git
 * itself will read an argument beginning with "-" as an option, so the leading
 * character is constrained too. Anything outside the ref character set is
 * refused rather than passed along and hoped for.
 */
function safeRevision(rev) {
  // `~` and `^` are here because HEAD~1 and main^ are ordinary things to pass;
  // neither can turn the argument into an option, which is what the
  // alphanumeric-only first character rules out.
  if (!/^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/.test(rev)) {
    console.error(`Refusing "${rev}" as a git revision.`);
    process.exit(2);
  }
  return rev;
}

/**
 * The commit id a revision names, and the only form of it this script will
 * hand to `git diff`.
 *
 * Resolving first means the diff never receives argv text at all: it gets forty
 * hex characters that git produced and this function re-checked. The resolve
 * call is the one place the argument is read, and there it is both charset-
 * limited by safeRevision and placed after --end-of-options, so git cannot read
 * it as a flag however it is spelled.
 */
function resolveCommit(rev) {
  const safe = safeRevision(rev);
  let out = "";
  try {
    out = execFileSync(
      GIT,
      ["rev-parse", "--verify", "--quiet", "--end-of-options", `${safe}^{commit}`],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    // --verify exits non-zero for a name that resolves to nothing, which is a
    // user error rather than a crash.
    out = "";
  }
  const sha = /^[0-9a-f]{40}$/.exec(out)?.[0];
  if (!sha) {
    console.error(
      `"${rev}" does not name a commit here. ` +
        "If it is a remote branch, `git fetch` first.",
    );
    process.exit(2);
  }
  return sha;
}

/**
 * The line numbers this change added or modified, per file.
 *
 * Read from a zero-context diff against the merge base, which is the same set
 * Sonar calls new code. Deletions carry no new lines and are skipped.
 */
function changedLines(baseSha) {
  const diff = execFileSync(
    GIT,
    ["diff", "--unified=0", "--diff-filter=d", `${baseSha}...HEAD`],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const byFile = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) {
      file = header[1];
      byFile.set(file, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) byFile.get(file).add(n);
    }
  }
  return byFile;
}

const base = process.argv[2] ?? "origin/main";
// Resolved once, up front: everything downstream works from the commit id, so
// the text the user typed never reaches another command.
const baseSha = resolveCommit(base);
const hits = lcovHits();
const changed = changedLines(baseSha);

let coverable = 0;
let covered = 0;
const gaps = [];

for (const [file, lines] of changed) {
  if (!inScope(file)) continue;
  const fileHits = hits.get(file);
  if (!fileHits) continue;
  const uncovered = [];
  for (const n of [...lines].sort((a, b) => a - b)) {
    const h = fileHits.lines.get(n);
    if (h === undefined) continue; // not instrumented, so not coverable
    coverable++;
    if (h > 0) covered++;

    const outcomes = fileHits.branches.get(n) ?? [];
    const taken = outcomes.filter(Boolean).length;
    coverable += outcomes.length;
    covered += taken;

    if (h === 0) uncovered.push({ line: n, why: "never executed" });
    else if (taken < outcomes.length) {
      uncovered.push({
        line: n,
        why: `${outcomes.length - taken} of ${outcomes.length} branches not taken`,
      });
    }
  }
  if (uncovered.length) gaps.push({ file, uncovered });
}

// Widest gaps first: that is the order in which writing a test moves the number.
gaps.sort((a, b) => b.uncovered.length - a.uncovered.length);

const source = (file) => readFileSync(join(ROOT, file), "utf8").split("\n");
for (const { file, uncovered } of gaps) {
  console.log(`${file}  (${uncovered.length} gaps)`);
  const text = source(file);
  for (const { line, why } of uncovered) {
    console.log(
      `  ${String(line).padStart(5)}  ${(text[line - 1] ?? "").trim()}`,
    );
    console.log(`         ${why}`);
  }
  console.log("");
}

const pct = coverable === 0 ? 100 : (covered / coverable) * 100;
console.log(
  `new-code coverage vs ${base}: ${pct.toFixed(1)}% ` +
    `(${covered}/${coverable} new lines + conditions in lib/)`,
);
if (pct < THRESHOLD) {
  console.log(`below the ${THRESHOLD}% gate by ${(THRESHOLD - pct).toFixed(1)} points`);
  process.exit(1);
}
