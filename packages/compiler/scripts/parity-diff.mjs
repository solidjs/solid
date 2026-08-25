// Babel vs Oxc compiler parity inspection tool.
//
// Compiles every Babel fixture with BOTH compilers under identical options,
// normalizes cosmetic differences, and writes per-fixture artifacts
// (normalized outputs, raw outputs, unified diff) for inspection. The CI
// gate for these diffs is __tests__/parity.test.js; this script is for
// digging into a divergence locally.
//
// Usage: node packages/compiler/scripts/parity-diff.mjs [outDir]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { modes, fixtureNames, compareFixture, unifiedDiff } = require(
  path.resolve(__dirname, "../__tests__/parity/harness.js")
);

const outDir = path.resolve(process.argv[2] || "/tmp/compiler-parity");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const summary = [];

for (const mode of Object.keys(modes)) {
  for (const fixture of fixtureNames(mode)) {
    const caseDir = path.join(outDir, mode, fixture);
    fs.mkdirSync(caseDir, { recursive: true });
    let status;
    try {
      const { babel, oxc, babelRaw, oxcRaw } = compareFixture(mode, fixture);
      fs.writeFileSync(path.join(caseDir, "babel.js"), babel + "\n");
      fs.writeFileSync(path.join(caseDir, "oxc.js"), oxc + "\n");
      fs.writeFileSync(path.join(caseDir, "babel.raw.js"), babelRaw + "\n");
      fs.writeFileSync(path.join(caseDir, "oxc.raw.js"), oxcRaw + "\n");
      const diff = unifiedDiff(babel, oxc);
      if (diff === "") {
        status = "MATCH";
      } else {
        fs.writeFileSync(path.join(caseDir, "diff.txt"), diff);
        const lines = diff.split("\n").filter(l => /^[+-]/.test(l)).length;
        status = `DIFF (${lines} changed lines)`;
      }
    } catch (err) {
      status = `ERROR: ${err.message.split("\n")[0]}`;
    }
    summary.push({ mode, fixture, status });
    console.log(`${status.padEnd(28)} ${mode}/${fixture}`);
  }
}

const matches = summary.filter(s => s.status === "MATCH").length;
const diffs = summary.filter(s => s.status.startsWith("DIFF")).length;
const errors = summary.filter(s => s.status.startsWith("ERROR")).length;
console.log(`\n${summary.length} cases: ${matches} match, ${diffs} differ, ${errors} error`);
console.log(`Artifacts in ${outDir}`);
