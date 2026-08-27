// Row-proof coverage report (DESIGN §16 process rule): compiles every solid
// fixture in the octane benchmark corpus with the CURRENT Babel preset and
// reports, per file, how many <For> lists exist vs how many row functions the
// compiler stamped (rowProof). The diff of this report across compiler
// changes IS the coverage change — admission-affecting work must ship with
// it (the §3c lesson: gates spot-check, this enumerates).
//
// Usage: node scripts/row-coverage.mjs [corpusRoot]
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "package.json"));
const babel = require("@babel/core");
const preset = require(path.join(here, "..", "packages", "babel-preset-solid", "index.js"));

const corpus = process.argv[2] ?? "/Users/ryancarniato/Development/octane/benchmarks";

function* jsxFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = path.join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) yield* jsxFiles(p);
    else if (/\.(jsx|tsx)$/.test(e) && /\/solid(-[^/]+)?\//.test(p + "/")) yield p;
  }
}

let totFors = 0;
let totStamped = 0;
const rows = [];
for (const file of jsxFiles(corpus)) {
  const src = readFileSync(file, "utf8");
  const forCount = (src.match(/<For\b/g) ?? []).length;
  if (forCount === 0) continue;
  let out;
  try {
    out = babel.transformSync(src, {
      filename: file,
      presets: [[preset, { generate: "dom", hydratable: false }]],
      plugins: file.endsWith(".tsx") ? [[require("@babel/plugin-transform-typescript"), { isTSX: true }]] : []
    }).code;
  } catch (e) {
    rows.push([file, forCount, "COMPILE ERROR: " + String(e.message).split("\n")[0].slice(0, 60)]);
    continue;
  }
  const stamped = (out.match(/rowProof\(/g) ?? []).length;
  totFors += forCount;
  totStamped += stamped;
  rows.push([file, forCount, stamped]);
}

console.log("row-proof coverage over corpus:", corpus);
console.log("file".padEnd(80), "For", "stamped");
for (const [f, c, s] of rows) console.log(f.replace(corpus + "/", "").padEnd(80), String(c).padStart(3), String(s).padStart(7));
console.log("\nTOTAL <For> lists:", totFors, " stamped row fns:", totStamped, ` (${((totStamped / Math.max(totFors, 1)) * 100).toFixed(0)}% of lists have a stamped row)`);
console.log("NOTE: counts are heuristic (regex on source/output); a stamped fn");
console.log("count above the For count means non-row functions matched the shape");
console.log("(inert). Zero stamps beside a For is a list that will DECLINE.");
