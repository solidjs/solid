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
 * tree (the prod and observe trees) or a single file.
 *
 * Names are pinned. terser hands out short names in first-seen order, so one
 * added or renamed field shifts every name after it and moves brotli on
 * scenarios the change never touched. `mangle-props.json` (beside this
 * script) holds each domain's field -> name map and seeds the nameCache:
 * fields already in it keep their names, a new field takes the next short
 * name the map does not hold, and a field gone from the source drops out (its
 * name is free for the next new field). The build writes the map back when it
 * changes; commit it with the change, like a lockfile. Delete a domain's entry
 * (or the file) to re-pack every name from scratch, in a PR of its own.
 *
 * Usage: node scripts/mangle-props.mjs <dir|file> [...]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { minify } from "terser";

const MAP = new URL("./mangle-props.json", import.meta.url);
const pins = existsSync(MAP) ? JSON.parse(readFileSync(MAP, "utf8")) : {};
const before = JSON.stringify(pins);

function walk(dir) {
  if (statSync(dir).isFile()) return [dir];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (/\.js$/.test(entry.name)) files.push(path);
  }
  return files;
}

for (const dir of process.argv.slice(2)) {
  const key = basename(dir);
  const files = walk(dir).map(file => [file, readFileSync(file, "utf8")]);
  // Every `_` token in the unmangled tree: a superset of the fields terser
  // will mangle, so a pin is dropped only when its field is truly gone.
  const tokens = new Set(files.flatMap(([, code]) => code.match(/(?<![\w$])_[\w$]+/g) ?? []));
  const props = {};
  for (const [prop, name] of Object.entries(pins[key] ?? {}))
    if (tokens.has(prop)) props["$" + prop] = name;
  // terser's nameCache shape: { props: { props: { $field: name } } }.
  const nameCache = { props: { props } };
  for (const [file, code] of files) {
    const result = await minify(code, {
      compress: false,
      nameCache,
      mangle: {
        keep_classnames: true,
        keep_fnames: true,
        module: false,
        // Three cross-package owner fields, all reserved: `_name` — solid-js
        // writes the component label onto signals' owners (`owner._name =
        // "<App>"`) and `ownerPath` reads it — `_loc`, the source location
        // solid-js writes beside it (`owner._loc = "src/App.tsx:3:5"`) and
        // `emitDiagnostic` reads for `event.loc` — and `_parent`, the owner-tree
        // link, which solid-js walks on signals' owners (client hydration's
        // root lookup) and which the core walks on solid-js's server owners
        // (`ownerPath`, `OBSERVE.exclude`/`isExcluded`). Mangling either
        // puts the write and the read on different properties: before
        // `_parent` was reserved, the prod client marked the wrong snapshot
        // scope and `OBSERVE.exclude` was a silent no-op for server owners
        // in the observe tier. Every other `_` field is private to this
        // package; solid's cross-package-fields spec scans the downstream
        // artifacts for any new one.
        properties: { regex: /^_/, reserved: ["_name", "_loc", "_parent"] }
      },
      // preserve_annotations: terser consumes /*@__PURE__*/ during parse and
      // only re-emits it when asked — without this the prod tree loses the
      // annotations that consumer bundlers rely on for DCE (#2883 phase 3).
      format: { beautify: true, comments: true, preserve_annotations: true }
    });
    writeFileSync(file, result.code);
  }
  pins[key] = Object.fromEntries(
    Object.entries(nameCache.props.props)
      .map(([prop, name]) => [prop.slice(1), name])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
  console.log(`mangled _-props across ${files.length} files in ${dir}`);
}

if (JSON.stringify(pins) !== before) {
  writeFileSync(MAP, JSON.stringify(pins, null, 2) + "\n");
  console.log(`updated ${MAP.pathname} - commit it with this change`);
}
