// Renders the PR size comment: head vs base per scenario, from two size.mjs
// --json files. Base entries may be missing (a new scenario, or a base
// checkout the head's scenarios cannot bundle); those rows show "—".
//
// Usage: node report.mjs <head.json> [base.json] > comment.md

import { readFileSync } from "node:fs";
import { toKB } from "./bundle.mjs";

const [headFile, baseFile] = process.argv.slice(2);
const head = JSON.parse(readFileSync(headFile, "utf8"));
const base = baseFile ? JSON.parse(readFileSync(baseFile, "utf8")) : [];

const delta = (h, b) => {
  const d = h - b;
  if (d === 0) return "0 B";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} B (${d > 0 ? "+" : "−"}${((Math.abs(d) / b) * 100).toFixed(1)}%)`;
};

const rows = head.map(h => {
  const b = base.find(x => x.name === h.name);
  const size = h.error ? "error" : toKB(h.size);
  const change = h.error || !b || b.error ? "—" : delta(h.size, b.size);
  const cap = toKB(h.limit);
  const status = h.error ? "❌ error" : h.passed ? "✅" : `❌ over by ${h.size - h.limit} B`;
  const lazy = h.lazy?.length ? h.lazy.map(c => `${c.name} ${toKB(c.br)}`).join(", ") : "";
  return `| ${h.name} | ${size} | ${change} | ${cap} | ${status} | ${lazy} |`;
});

console.log("<!-- size-report -->");
console.log("## Size (brotli, eager entry chunk)\n");
console.log("| scenario | head | vs base | cap | | lazy chunks (not counted) |");
console.log("| --- | ---: | ---: | ---: | --- | --- |");
console.log(rows.join("\n"));
console.log(
  "\n<sub>Bundled with Rolldown (what Vite ships), brotli q11, decimal KB. Caps in `scripts/size/scenarios.js`; the floor and page caps in `floor-caps.json` are frozen (lower only, or `Size-Exception:` in the PR body).</sub>"
);
