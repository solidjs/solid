#!/usr/bin/env node
/**
 * Build guard: the prod dist tree must retain /*@__PURE__*\/ annotations.
 * Two stages have silently stripped them before — rollup-plugin-prettier
 * (removed from the prod config) and terser without preserve_annotations —
 * and losing them disables consumer-side DCE of annotated initializers
 * without failing anything (#2883 phase 3). Fails the build if the tree
 * contains none while src contains some.
 *
 * Usage: node scripts/check-pure.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function count(dir) {
  if (statSync(dir).isFile()) return (readFileSync(dir, "utf8").match(/@__PURE__/g) || []).length;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) n += count(path);
    else if (/\.(js|cjs|ts)$/.test(entry.name)) n += count(path);
  }
  return n;
}

const [dist] = process.argv.slice(2);
const inSrc = count("src");
const inDist = count(dist);
if (inSrc > 0 && inDist === 0) {
  console.error(
    `check-pure: src has ${inSrc} /*@__PURE__*/ annotation(s) but ${dist} has none — ` +
      `a build stage is stripping them (prettier on the prod config, or terser without ` +
      `format.preserve_annotations).`
  );
  process.exit(1);
}
console.log(`check-pure: ${inDist} annotation(s) present in ${dist} (src has ${inSrc})`);
