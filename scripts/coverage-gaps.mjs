#!/usr/bin/env node
// Lists every line and branch coverage/lcov.info reports as unexecuted, per
// file, worst first. Sonar's coverage number is computed from this same report
// (lines + conditions), so an empty listing here is 100% there.
//
//   bun run coverage && node scripts/coverage-gaps.mjs [path-filter]
import { readFileSync } from "node:fs";

const filter = process.argv[2] ?? "";
const lcov = readFileSync("coverage/lcov.info", "utf8");
const rows = [];
for (const block of lcov.split("end_of_record")) {
  const file = /^SF:(.+)$/m.exec(block)?.[1];
  if (!file || !file.includes(filter)) continue;
  const lines = [];
  const branches = new Set();
  for (const m of block.matchAll(/^DA:(\d+),(\d+)$/gm)) {
    if (m[2] === "0") lines.push(Number(m[1]));
  }
  for (const m of block.matchAll(/^BRDA:(\d+),\d+,\d+,(\d+|-)$/gm)) {
    if (m[2] === "0" || m[2] === "-") branches.add(Number(m[1]));
  }
  if (lines.length || branches.size) {
    rows.push({ file: file.replace(`${process.cwd()}/`, ""), lines, branches: [...branches] });
  }
}
rows.sort((a, b) => b.lines.length + b.branches.length - (a.lines.length + a.branches.length));
for (const r of rows) {
  console.log(`${r.file}\n  lines: ${r.lines.join(",") || "-"}\n  branches@: ${r.branches.join(",") || "-"}`);
}
console.log(`\n${rows.length} file(s) with gaps`);
