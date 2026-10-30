#!/usr/bin/env node
// Aggregates reader-seat shadow reports (JSON lines written by
// tests/setup/seat-shadow-report.ts, one per test file) into a mismatch
// table: kind · row · expected → actual · detail · count · files.
//
//   node scripts/seat-shadow-summary.mjs /tmp/seat-signals.jsonl [--rows] [--files N]
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: seat-shadow-summary.mjs <report.jsonl> [--rows] [--files N]");
  process.exit(2);
}
const showRows = flags.includes("--rows");
const filesN = Number(flags[flags.indexOf("--files") + 1]) || 3;

const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(l => JSON.parse(l));

let reads = 0,
  passes = 0,
  orphans = 0;
const rows = new Map();
const mismatches = new Map();
const known = new Map();
for (const r of lines) {
  for (const [issue, n] of Object.entries(r.known ?? {}))
    known.set(issue, (known.get(issue) ?? 0) + n);
  reads += r.reads;
  passes += r.passes;
  orphans += r.orphanReads;
  for (const [row, n] of Object.entries(r.rows ?? {})) rows.set(row, (rows.get(row) ?? 0) + n);
  for (const m of r.mismatches ?? []) {
    const key = `${m.kind}|${m.row}|${m.expected}|${m.actual}|${m.detail}`;
    let e = mismatches.get(key);
    if (!e) {
      e = { ...m, count: 0, files: new Map() };
      mismatches.set(key, e);
    }
    e.count += m.count;
    const f = r.file ? relative(process.cwd(), r.file) : "?";
    e.files.set(f, (e.files.get(f) ?? 0) + m.count);
  }
}

console.log(
  `files ${lines.length} · reads compared ${reads} · passes seated ${passes} · reads outside a seated pass ${orphans}`
);
if (showRows) {
  console.log("\nrows hit:");
  for (const [row, n] of [...rows].sort((a, b) => b[1] - a[1]))
    console.log(`  ${row.padEnd(10)} ${n}`);
}
if (known.size) {
  console.log("\nknown differences (filed; the swap fixes them by construction):");
  for (const [issue, n] of [...known].sort((a, b) => b[1] - a[1])) console.log(`  #${issue} ×${n}`);
}
const list = [...mismatches.values()].sort((a, b) => b.count - a.count);
console.log(`\nmismatch classes: ${list.length}`);
for (const m of list) {
  console.log(
    `\n${m.kind} row ${m.row}: expected ${m.expected}, got ${m.actual} — ${m.detail} ×${m.count}`
  );
  console.log(`  e.g. reader ${m.reader} node ${m.node}${m.case ? ` (${m.case})` : ""}`);
  const fs = [...m.files].sort((a, b) => b[1] - a[1]).slice(0, filesN);
  for (const [f, n] of fs) console.log(`  ${f} ×${n}`);
  if (m.files.size > filesN) console.log(`  … ${m.files.size - filesN} more files`);
}
