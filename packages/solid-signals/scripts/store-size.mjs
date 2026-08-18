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

// Legacy-module stub for the post-deletion floor estimate: exactly the names
// next modules import from legacy, with honest approximations for machinery
// that SURVIVES deletion as shared code (isWrappable) and no-ops for what
// deletion removes or relocates (affects wiring stays, but its weight is
// counted with core, not the store).
const LEGACY_STUB = `
export const $TARGET = Symbol(), $PROXY = Symbol(), $TRACK = Symbol(), $AFFECTS = Symbol();
export const STORE_VALUE = "v";
export const rawValuesUsed = false;
export const isRawValue = v => false;
export function isWrappable(obj) {
  if (obj == null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return true;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
}
export const storeLookup = new WeakMap();
export const getWriteOverride = () => false;
export const witnessAffectsMark = () => {};
export const affectsScopesLive = () => false;
export const inheritAffectsMarks = () => {};
export const setNextAffectsNodeResolver = () => {};
export const setNextOptimisticViewResolver = () => {};
export const createWriteTraps = () => ({});
export const reconcile = () => () => {};
export const installOptimisticStoreHooks = () => {};
`;

const stubLegacyPlugin = {
  name: "stub-legacy",
  setup(b) {
    b.onResolve({ filter: /^\.\.\/(store|reconcile|projection|optimistic|utils)\.js$/ }, args => {
      if (args.importer.includes("/store/next/")) return { path: "legacy-stub", namespace: "stub" };
      return undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: LEGACY_STUB, loader: "ts" }));
  }
};

async function bundle(label, contents, stubLegacy = false) {
  const r = await build({
    stdin: { contents, resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
    bundle: true,
    format: "esm",
    write: false,
    define: DEFINE,
    treeShaking: true,
    plugins: stubLegacy ? [stubLegacyPlugin] : [],
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
// Next-only: bypass the dispatchers entirely. Whatever legacy still lands in
// this bundle arrives through interop imports inside next modules — the
// difference vs the dispatcher entries is the deletion payoff, and the
// entangled remainder is the deletion worklist.
const nextOnly = await bundle(
  "next-only (no dispatchers)",
  `export { createStoreNext, snapshotNext, deepNext } from "./src/store/next/store.ts";
   export { reconcileNextState } from "./src/store/next/reconcile.ts";
   export { createProjectionNext } from "./src/store/next/projection.ts";
   export { createOptimisticStoreNext } from "./src/store/next/optimistic.ts";`
);
const nextPlain = await bundle(
  "next plain store only",
  `export { createStoreNext } from "./src/store/next/store.ts";`
);
const nextFloor = await bundle(
  "next-only FLOOR (legacy stubbed)",
  `export { createStoreNext, snapshotNext, deepNext } from "./src/store/next/store.ts";
   export { reconcileNextState } from "./src/store/next/reconcile.ts";
   export { createProjectionNext } from "./src/store/next/projection.ts";
   export { createOptimisticStoreNext } from "./src/store/next/optimistic.ts";`,
  true
);
const nextPlainFloor = await bundle(
  "next plain FLOOR (legacy stubbed)",
  `export { createStoreNext } from "./src/store/next/store.ts";
   export { reconcileNextState } from "./src/store/next/reconcile.ts";`,
  true
);

const rows = [full, core, store, optimistic, nextOnly, nextPlain, nextFloor, nextPlainFloor];
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
