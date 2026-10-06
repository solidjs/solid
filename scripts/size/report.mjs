// Renders the PR size comment: head vs base per scenario, from two size.mjs
// --json files, with gate.mjs's verdict for each. Base entries may be missing
// (a new scenario, or a base checkout the head's scenarios cannot bundle);
// those rows show "—" and their cap is absolute.
//
// Usage: node report.mjs <head.json> [base.json] > comment.md

import { readFileSync } from "node:fs";
import { toKB } from "./bundle.mjs";
import { decideAll, MINIFIED_ALLOWANCE } from "./gate.mjs";

const [headFile, baseFile] = process.argv.slice(2);
const head = JSON.parse(readFileSync(headFile, "utf8"));
let base = [];
try {
  if (baseFile) base = JSON.parse(readFileSync(baseFile, "utf8"));
} catch {}
const verdicts = decideAll(head, base);

const signed = d => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)} B`;
const delta = (h, b) => {
  const d = h - b;
  if (d === 0) return "0 B";
  return `${signed(d)} (${d > 0 ? "+" : "−"}${((Math.abs(d) / b) * 100).toFixed(1)}%)`;
};

const rows = head.map((h, i) => {
  const b = base.find(x => x.name === h.name);
  const v = verdicts[i];
  const size = h.error ? "error" : toKB(h.size);
  const comparable = !h.error && b && !b.error;
  const change = comparable ? delta(h.size, b.size) : "—";
  const minChange = comparable ? signed(h.minified - b.minified) : "—";
  const cap = toKB(h.limit);
  const status = h.error
    ? "❌ error"
    : v.verdict === "pass"
      ? "✅"
      : v.verdict === "warn"
        ? `⚠️ over by ${v.overBy} B, noise`
        : `❌ over by ${v.overBy} B`;
  const lazy = h.lazy?.length ? h.lazy.map(c => `${c.name} ${toKB(c.br)}`).join(", ") : "";
  return `| ${h.name} | ${size} | ${change} | ${minChange} | ${cap} | ${status} | ${lazy} |`;
});

console.log("<!-- size-report -->");
console.log("## Size (brotli, eager entry chunk)\n");
console.log("| scenario | head | vs base | minified vs base | cap | | lazy chunks (not counted) |");
console.log("| --- | ---: | ---: | ---: | ---: | --- | --- |");
console.log(rows.join("\n"));

const warned = verdicts.filter(v => v.verdict === "warn");
const failed = verdicts.filter(v => v.verdict === "fail");
if (warned.length) {
  console.log("\n### ⚠️ Over the brotli cap within the minified allowance (passes)\n");
  for (const v of warned) console.log(`- **${v.name}**: ${v.message}`);
}
if (failed.length) {
  console.log("\n### ❌ Fails the gate\n");
  for (const v of failed) console.log(`- **${v.name}**: ${v.message}`);
}
console.log(
  `\n<sub>Bundled with Rolldown (what Vite ships), brotli q11, decimal KB. A scenario fails only when it is over its brotli cap **and** grew more than ${MINIFIED_ALLOWANCE} B minified over the base; over the cap within that allowance is brotli layout noise and passes with a warning. Caps in \`scripts/size/scenarios.js\`; the floor and page caps in \`floor-caps.json\` are frozen (lower only, or \`Size-Exception:\` in the PR body). Caps are re-based downward by \`npm run ratchet\` (scripts/size/README.md).</sub>`
);
