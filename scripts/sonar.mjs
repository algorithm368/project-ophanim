#!/usr/bin/env node
/**
 * Read and triage SonarCloud issues from the terminal.
 *
 * The `sonar` CLI cannot authenticate here: it wants a browser and the system
 * keychain, and it ignores SONAR_TOKEN. This talks to the REST API directly,
 * which the token already covers, so listing and closing issues is one command
 * instead of a hand-built curl each time.
 *
 * Usage:
 *   node scripts/sonar.mjs list [--branch main | --pr 25] [--rules S3776,S3358]
 *   node scripts/sonar.mjs by-rule [--branch main | --pr 25]
 *   node scripts/sonar.mjs gate [--branch main | --pr 25]
 *   node scripts/sonar.mjs close <issueKey> <falsepositive|accept> <comment...>
 *
 * `--pr` is the one to reach for while a change is in review: the gate that
 * blocks a merge is computed on the pull request's *new* code, not on the
 * branch, and the two disagree often enough that reading the wrong one sends
 * you looking for problems that are not there.
 *
 * SONAR_TOKEN must be set. The project key and host come from
 * sonar-project.properties, so this can never drift from what CI analyses.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "https://sonarcloud.io";

const TOKEN = process.env.SONAR_TOKEN;
if (!TOKEN) {
  console.error(
    "SONAR_TOKEN is not set. Without it this cannot read the project;\n" +
      "the sonar CLI's own login does not work in this environment.",
  );
  process.exit(2);
}

/** The project key CI reports into. Read from the properties file rather than
 *  hardcoded, because a second key is exactly the failure that file exists to
 *  prevent. */
function projectKey() {
  const text = readFileSync(join(ROOT, "sonar-project.properties"), "utf8");
  const match = /^sonar\.projectKey=(.+)$/m.exec(text);
  if (!match) throw new Error("no sonar.projectKey in sonar-project.properties");
  return match[1].trim();
}

/** The token as an HTTP Basic credential: SonarCloud takes it as the username
 *  with an empty password. */
const CREDENTIAL = Buffer.from(`${TOKEN}:`).toString("base64");
const AUTH = `Basic ${CREDENTIAL}`;

/** Code-unit order, the same deterministic comparison lib/ti/sort.ts uses. A
 *  bare .sort() coerces to strings and compares by locale, which reorders the
 *  same list differently on a different machine. */
function byCodeUnit(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

async function api(path, params = {}, init = {}) {
  const url = new URL(`${HOST}/api/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: AUTH,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...init.headers,
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}

/** Every open issue, following pagination. The API caps a page at 500. */
async function openIssues(scope, rules) {
  const out = [];
  for (let page = 1; ; page++) {
    const data = await api("issues/search", {
      componentKeys: projectKey(),
      ...scope,
      statuses: "OPEN,CONFIRMED",
      rules,
      ps: 500,
      p: page,
    });
    out.push(...data.issues);
    if (out.length >= data.paging.total || data.issues.length === 0) break;
  }
  return out;
}

/** Strip the project key prefix off a component, leaving a repo-relative path. */
const pathOf = (issue) => issue.component.split(":").slice(1).join(":");

const args = process.argv.slice(2);
const command = args[0] ?? "by-rule";
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
// A pull request and a branch are separate scopes in the API, and passing both
// is a request for something that does not exist, so --pr wins outright.
const pr = flag("pr");
const branch = flag("branch", "main");
/** The API params selecting what to report on, and a name for the output. */
const scope = pr ? { pullRequest: pr } : { branch };
const scopeName = pr ? `PR #${pr}` : branch;

if (command === "list") {
  const issues = await openIssues(scope, flag("rules"));
  const byFile = new Map();
  for (const issue of issues) {
    const key = pathOf(issue);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(issue);
  }
  for (const file of [...byFile.keys()].sort(byCodeUnit)) {
    console.log(file);
    for (const i of byFile.get(file).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      // The key is printed because `close` needs it, and looking it up in the
      // web UI is the slow half of triaging.
      console.log(
        `  L${String(i.line ?? "?").padEnd(5)} ${i.rule.padEnd(20)} ${i.key}  ${i.message}`,
      );
    }
  }
  console.log(`\n${issues.length} open on ${scopeName}`);
} else if (command === "by-rule") {
  const issues = await openIssues(scope, flag("rules"));
  const counts = new Map();
  for (const i of issues) {
    const k = `${i.severity}\t${i.rule}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1]);
  for (const [k, n] of rows) {
    const [severity, rule] = k.split("\t");
    console.log(`${String(n).padStart(4)}  ${severity.padEnd(8)} ${rule}`);
  }
  console.log(`\n${issues.length} open on ${scopeName}`);
} else if (command === "gate") {
  const { projectStatus } = await api("qualitygates/project_status", {
    projectKey: projectKey(),
    ...scope,
  });
  console.log(`${projectStatus.status} on ${scopeName}`);
  for (const c of projectStatus.conditions ?? []) {
    console.log(
      `  ${c.status.padEnd(5)} ${c.metricKey.padEnd(32)} ${c.actualValue} (${c.comparator} ${c.errorThreshold})`,
    );
  }
  if (projectStatus.status !== "OK") process.exit(1);
} else if (command === "close") {
  const [, key, transition, ...rest] = args;
  const comment = rest.join(" ");
  if (!key || !["falsepositive", "accept"].includes(transition) || !comment) {
    console.error(
      "usage: close <issueKey> <falsepositive|accept> <comment...>\n" +
        "  falsepositive: the rule is wrong about this code\n" +
        "  accept:        the rule is right and we are keeping it anyway\n" +
        "The comment is required; a closed issue with no reason is one nobody\n" +
        "can reopen an argument about later.",
    );
    process.exit(2);
  }
  await api("issues/add_comment", {}, {
    method: "POST",
    body: new URLSearchParams({ issue: key, text: comment }),
  });
  await api("issues/do_transition", {}, {
    method: "POST",
    body: new URLSearchParams({ issue: key, transition }),
  });
  console.log(`${key} -> ${transition}`);
} else {
  console.error(`unknown command "${command}". See the header of this file.`);
  process.exit(2);
}
