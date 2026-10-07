// Per-module attribution for a scenario in scenarios.js.
//
// size.mjs answers "did the cap hold" and names the package that moved; this
// lists the individual dist modules retained in the eager chunk, by their
// minified contribution, so a bump can be traced to a file. Minified bytes
// are the attributable unit — brotli compresses across module boundaries, so
// the compressed total is reported for the chunk only.
//
// Usage: node attribute.mjs [--min <bytes>] [scenario-substring ...]
//   --min <bytes>  list modules over this many minified bytes (default 200)

import { bundle, moduleOf, packageOf, scenarios, toKB } from "./bundle.mjs";

const args = process.argv.slice(2);
const minAt = args.indexOf("--min");
const threshold = minAt >= 0 ? parseInt(args[minAt + 1], 10) : 200;
// Without `--min`, minAt is -1 and `i !== minAt + 1` would drop the first
// positional filter (index 0); only exclude the value argument when the flag
// is present. (The same fix size.mjs carries for `--json`.)
const filters = args.filter((a, i) => !a.startsWith("--") && (minAt < 0 || i !== minAt + 1));

for (const scenario of scenarios) {
  if (filters.length && !filters.some(f => scenario.name.includes(f))) continue;
  const r = await bundle(scenario);
  console.log(`\n${r.name}`);
  console.log(`  eager graph: minified ${r.min} B   brotli ${r.br} B (${toKB(r.br)})`);
  if (r.eagerChunks.length > 1)
    for (const c of r.eagerChunks)
      console.log(`  eager chunk ${c.name}: minified ${c.min} B   brotli ${c.br} B`);
  for (const c of r.lazy)
    console.log(`  lazy chunk ${c.name}: minified ${c.min} B   brotli ${c.br} B`);
  const rows = r.modules
    .filter(m => m.min > threshold && packageOf(m.id) !== "other")
    .sort((a, b) => b.min - a.min);
  for (const m of rows) console.log(`    ${String(m.min).padStart(7)}  ${moduleOf(m.id)}`);
}
