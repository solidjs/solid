#!/usr/bin/env node
/**
 * Mangles `_`-prefixed property names across a per-module dist tree with ONE
 * shared terser nameCache per tree, processing files in sorted order so the
 * assignment is deterministic. This must be a single sequential pass:
 * @rollup/plugin-terser runs per-chunk in worker processes with serialized
 * options, so `_pendingValue` could mangle to different names in different
 * modules and break cross-module member access at runtime (#2883).
 *
 * Each argument is one consistency domain with its own nameCache: a directory
 * tree, a single file, or a comma-separated group of files — the code-split
 * flat builds (`node.cjs,node.attribution.cjs,node-shared.cjs`) are three
 * files that share one module graph and must mangle as one.
 *
 * Usage: node scripts/mangle-props.mjs <dir|file|file,file,...> [...]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { minify } from "terser";

function walk(dir) {
  if (statSync(dir).isFile()) return [dir];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (/\.(js|cjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const domain = arg => arg.split(",").flatMap(walk);

for (const dir of process.argv.slice(2)) {
  const nameCache = {};
  for (const file of domain(dir)) {
    const code = readFileSync(file, "utf8");
    const result = await minify(code, {
      compress: false,
      nameCache,
      mangle: {
        keep_classnames: true,
        keep_fnames: true,
        module: false,
        // `_name` is the one cross-package field: solid-js writes the
        // component label onto signals' owners (`owner._name = "<App>"`) and
        // `ownerPath` reads it. Mangling it in the observe tree would put the
        // write and the read on different properties. Every other `_` field
        // is private to this package.
        properties: { regex: /^_/, reserved: ["_name"] }
      },
      // preserve_annotations: terser consumes /*@__PURE__*/ during parse and
      // only re-emits it when asked — without this the prod tree loses the
      // annotations that consumer bundlers rely on for DCE (#2883 phase 3).
      format: { beautify: true, comments: true, preserve_annotations: true }
    });
    writeFileSync(file, result.code);
  }
  console.log(`mangled _-props across ${domain(dir).length} files in ${dir}`);
}
