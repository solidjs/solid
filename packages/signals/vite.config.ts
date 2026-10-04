import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import codspeedPlugin from "@codspeed/vitest-plugin";

const root = dirname(fileURLToPath(import.meta.url));

// Vitest sets mode to "benchmark" for `vitest bench`.
//
// Benchmarks measure the BUILT package. The source under vite-node is one
// ESM module per file with every cross-module import a live-binding
// namespace load; the shipped bundle is a single scope with those calls
// inlined and its properties mangled. The gap between the two is not a
// constant factor — it grows with the number of modules on a hot path — so
// numbers taken on the source neither track what users pay nor stay
// comparable across refactors that move code between files. The import
// alias below routes the benches' `src/index.js` import to the dist entry
// of the selected tier; `SIGNALS_BENCH=source` opts back into the source
// (handy for a quick local loop — not for recording numbers).
//
// SIGNALS_TIER selects the build tier (see src/globals.d.ts): "dev" (checks
// + wiring), "observe" (wiring only: what a production observability build
// pays with no hooks installed), "prod" (neither). Benchmarks default to
// "prod" — the artifact users ship. The test suite defaults to "dev" and
// asserts dev-tier behaviour; it is not expected to pass under other tiers.
// When the source is compiled (tests, or SIGNALS_BENCH=source) the tier is
// applied through the defines; __TEST__ (per-write tracking + quiescence
// sweeps) is never on for benchmarks — that machinery alone regressed the
// CodSpeed suite by 5-21% when it was.
const DIST_ENTRY = {
  dev: "dist/dev.js",
  observe: "dist/observe/index.js",
  prod: "dist/prod/index.js"
} as const;

function newestSource(dir: string): { path: string; mtimeMs: number } {
  let newest = { path: dir, mtimeMs: 0 };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const found = entry.isDirectory()
      ? newestSource(path)
      : { path, mtimeMs: statSync(path).mtimeMs };
    if (found.mtimeMs > newest.mtimeMs) newest = found;
  }
  return newest;
}

export default defineConfig(({ mode }) => {
  const benchmark = mode === "benchmark";
  const dist = benchmark && process.env.SIGNALS_BENCH !== "source";
  const tier = process.env.SIGNALS_TIER ?? (dist ? "prod" : "dev");
  if (tier !== "dev" && tier !== "observe" && tier !== "prod")
    throw new Error(`SIGNALS_TIER must be dev | observe | prod, got "${tier}"`);
  if (
    benchmark &&
    process.env.SIGNALS_BENCH &&
    !["dist", "source"].includes(process.env.SIGNALS_BENCH)
  )
    throw new Error(`SIGNALS_BENCH must be dist | source, got "${process.env.SIGNALS_BENCH}"`);

  let alias: { find: RegExp; replacement: string }[] = [];
  if (dist) {
    const entry = join(root, DIST_ENTRY[tier]);
    if (!existsSync(entry))
      throw new Error(
        `@solidjs/signals benchmarks measure the built package, but ${DIST_ENTRY[tier]} is missing. ` +
          "Run `pnpm build:js` first (or set SIGNALS_BENCH=source to measure the source)."
      );
    // A stale build silently produces numbers for code that is not under
    // test — fail instead. (A fresh checkout bumps src mtimes; rebuild.)
    const newest = newestSource(join(root, "src"));
    if (newest.mtimeMs > statSync(entry).mtimeMs)
      throw new Error(
        `@solidjs/signals benchmarks measure the built package, but ${DIST_ENTRY[tier]} is older than ` +
          `${relative(root, newest.path)}. Run \`pnpm build:js\` first (or set SIGNALS_BENCH=source).`
      );
    alias = [{ find: /^(?:\.\.\/)+src\/index\.js$/, replacement: entry }];
  }

  return {
    plugins: [codspeedPlugin()],
    define: {
      __DEV__: String(tier === "dev"),
      __OBSERVE__: String(tier !== "prod"),
      __TEST__: benchmark || tier !== "dev" ? "false" : "true"
    },
    resolve: { alias },
    test: {
      globals: true,
      dir: "./tests",
      pool: "threads",
      // The dist is loaded by Node itself, not re-transformed by vite-node:
      // the prod build preserves modules, and vite-node's SSR transform
      // would turn every one of its cross-module imports back into a
      // namespace-object property load — the very cost the alias exists
      // to take out of the measurement.
      server: { deps: { external: dist ? [/\/dist\//] : [] } }
    }
  };
});
