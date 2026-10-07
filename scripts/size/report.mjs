// Renders the PR size comment: head vs base per scenario, from two size.mjs
// --json files, with gate.mjs's verdict for each. Base entries may be missing
// (a new scenario, or a base checkout the head's scenarios cannot bundle);
// those rows show "—".
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
  const minRecorded =
    !h.error && typeof h.capMinified === "number" ? signed(h.minified - h.capMinified) : "—";
  const cap = toKB(h.limit);
  const status = h.error
    ? "❌ error"
    : v.verdict === "pass"
      ? "✅"
      : v.verdict === "warn"
        ? `⚠️ over by ${v.overBy} B, ${v.headroom} B minified headroom`
        : `❌ over by ${v.overBy} B`;
  const lazy = h.lazy?.length ? h.lazy.map(c => `${c.name} ${toKB(c.br)}`).join(", ") : "";
  // More than one eager chunk (the entry statically imports a common chunk,
  // see bundle.mjs): name them beside the size, with the one-stream figure.
  const eager = h.eagerChunks?.length
    ? ` (${h.eagerChunks.map(c => `${c.name} ${toKB(c.br)}`).join(" + ")}; as one stream ${toKB(h.brStream)})`
    : "";
  return `| ${h.name} | ${size}${eager} | ${change} | ${minChange} | ${minRecorded} | ${cap} | ${status} | ${lazy} |`;
});

console.log("<!-- size-report -->");
console.log("## Size (brotli, eager graph: the entry chunk and what it imports statically)\n");
console.log(
  "| scenario | head | vs base | minified vs base | minified vs recorded | cap | | lazy chunks (not counted) |"
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
console.log(rows.join("\n"));

const fallback = verdicts.filter(v => v.against === "base" || v.against === "none");
if (fallback.length)
  console.log(
    `\n> **Fail-safe:** ${fallback.length} over-cap scenario(s) have no minified recorded with the cap and were judged against this PR's base instead: ${fallback.map(v => v.name).join("; ")}.`
  );

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
  `\n<sub>Bundled with Rolldown (what Vite ships), brotli q11, decimal KB. A scenario fails only when it is over its brotli cap **and** its minified size is more than ${MINIFIED_ALLOWANCE} B over the minified recorded with the cap; over the cap within that allowance is brotli layout noise and passes with a warning. Caps and their recorded minified in \`scripts/size/scenarios.js\`; the floor and page caps in \`floor-caps.json\` are frozen (lower only, or \`Size-Exception:\` in the PR body). \`npm run ratchet\` lowers caps per RC; it never raises one (scripts/size/README.md).</sub>`
);
