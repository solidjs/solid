// Size gate (INTERNALS-STORE-STATE.md §5c): store subsystem bytes, measured
// per increment beside the perf columns. Bundles src entries with esbuild
// (build-time constants set like the prod rollup config), minifies with
// terser, reports raw/min/gzip. Store cost = full - core (treeshaken diff),
// the same attribution method as the original size audit.
//
// Usage: node scripts/store-size.mjs   (from packages/solid-signals)

import { build } from "esbuild";
import { minify } from "terser";
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const DEFINE = {
  __DEV__: "false",
  __TEST__: "false",
  "globalThis.__DEV__": "false"
};

async function bundle(label, contents) {
  const r = await build({
    stdin: { contents, resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
    bundle: true,
    format: "esm",
    write: false,
    define: DEFINE,
    treeShaking: true,
    logLevel: "silent"
  });
  const raw = r.outputFiles[0].text;
  const min = (await minify(raw, { module: true, compress: { passes: 3 }, mangle: true })).code;
  const gz = gzipSync(min, { level: 9 }).length;
  return { label, raw: raw.length, min: min.length, gz };
}

const full = await bundle("full (index.ts)", `export * from "./src/index.ts";`);
const core = await bundle(
  "core-only (signals, no store)",
  `export { createSignal, createMemo, createEffect, createRoot, flush, untrack, batch } from "./src/index.ts";`
);
const store = await bundle(
  "store entry (createStore + reconcile)",
  `export { createStore, reconcile, snapshot, deep } from "./src/index.ts";`
);
const optimistic = await bundle(
  "optimistic store entry",
  `export { createOptimisticStore } from "./src/index.ts";`
);
const rows = [full, core, store, optimistic];
const pad = (s, n) => String(s).padStart(n);
console.log("entry".padEnd(38) + pad("raw", 10) + pad("min", 10) + pad("gzip", 10));
for (const r of rows)
  console.log(r.label.padEnd(38) + pad(r.raw, 10) + pad(r.min, 10) + pad(r.gz, 10));
console.log(
  "store attribution (full - core):".padEnd(38) +
    pad("", 10) +
    pad(full.min - core.min, 10) +
    pad(full.gz - core.gz, 10)
);

if (process.env.SIZE_JSON) {
  writeFileSync(
    process.env.SIZE_JSON,
    JSON.stringify(
      Object.fromEntries(rows.map(r => [r.label, { min: r.min, gz: r.gz }])),
      null,
      2
    ) + "\n"
  );
}
