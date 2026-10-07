// Bundles one scenario from scenarios.js with Rolldown and returns what the
// gate and the attribution need: the eager entry chunk (the number a cap
// guards), the lazy chunks a real page would fetch later, and each retained
// module's minified contribution to the entry chunk.
//
// Why Rolldown: it is the bundler Vite ships with, so its tree-shaking, chunk
// shapes and minifier are what an application actually downloads. The
// harness measured with esbuild (size-limit's bundler) until 2026-09-26; the
// switch re-based every cap (see floor-caps.json and the ledger in
// scenarios.js). Rolldown is pinned exactly in package.json because its
// minifier decides the numbers.
//
// Splitting is real here: a scenario's `import()` produces a lazy chunk, which
// is reported but never counted against the cap — the cap is the eager graph.
// (size-limit did not split, so the harness used a stub for the codec; the
// stub is gone and the lazy codec chunk is reported at its true size.)
//
// The eager graph is not always one chunk (2026-10-07): when a lazy chunk
// and the entry share modules, Rolldown may hoist the shared modules into a
// chunk the entry imports STATICALLY (`import "./web.js"` at its top) — the
// browser fetches it before the entry runs, so it ships eagerly and counts.
// The measured size is the entry plus every chunk it reaches through static
// imports (each brotli'd on its own: two files are two compressions); only
// chunks reached through `import()` alone are lazy. The first scenario to
// split this way was the compiled live server-component page: `isPending`
// on the page and a lazy route with a template put the whole runtime (~70 KB
// minified) in a shared chunk; counted as lazy it would have read as half
// the page. No other scenario splits; their numbers did not move.
//
// Compiled scenarios (2026-10-05): a scenario with `compile` is written as
// JSX under fixtures/ and compiled here, at measure time, by the native
// @solidjs/compiler of the checkout being measured (packagesRoot — the
// compare job's base checkout builds its own compiler, so a compiler-only
// change moves these scenarios on the comparison, as it should). Client DOM
// output with the production posture @solidjs/vite-plugin uses
// (`generate: "dom"`, `dev: false`, `hydratable` from the scenario, every
// other option at the compiler's default). The entry and every `.jsx`
// module it reaches are compiled; the output is handed to Rolldown as plain
// JS. The compiler sees only each file's basename, so no host path can reach
// the output and the numbers are the same on every machine.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import { rolldown } from "rolldown";
import { minifySync } from "rolldown/experimental";

const require = createRequire(import.meta.url);
export const here = dirname(fileURLToPath(import.meta.url));
export const scenarios = require("./scenarios.js");

// Where `../../packages/...` resolves. Overridable so the compare job can
// measure a base checkout with the head's harness.
export const packagesRoot = process.env.SIZE_PACKAGES_ROOT
  ? join(process.env.SIZE_PACKAGES_ROOT, "packages")
  : join(here, "..", "..", "packages");

// The JSX sources of the compiled scenarios. Their modules are the `app`
// package in every report: the compiled app's own bytes, separable from
// the runtime's.
export const fixturesRoot = join(here, "fixtures");

const resolvePath = p =>
  p.startsWith("../../packages/")
    ? join(packagesRoot, p.slice("../../packages/".length))
    : join(here, p);

// The native compiler of the measured checkout, loaded once. Its entry
// (packages/compiler/index.js) picks the binding the way the test suites
// get it — the local `compiler.<platform>.node` the build step emits
// (Linux CI and macOS alike), falling back to the installed platform
// package — so no path here depends on the host.
let compiler;
const compile = (id, hydratable) => {
  compiler ??= require(join(packagesRoot, "compiler", "index.js"));
  return compiler.transform(readFileSync(id, "utf8"), {
    filename: basename(id),
    generate: "dom",
    hydratable,
    dev: false
  }).code;
};

export const brotli = buf =>
  brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

// size-limit's units are decimal (1 KB = 1000 B); the caps keep that.
export const toBytes = s => {
  const m = String(s)
    .trim()
    .match(/^([\d.]+)\s*(B|KB|MB)?$/i);
  if (!m) throw new Error(`unparseable cap "${s}"`);
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? "B").toUpperCase();
  return unit === "MB" ? n * 1e6 : unit === "KB" ? n * 1e3 : n;
};
export const toKB = b => (b / 1000).toFixed(2) + " KB";

const ENTRY = "\0scenario-entry";

/**
 * Maps a module id to the package that shipped it; a compiled scenario's own
 * sources (fixtures/) are "app", anything else outside packages/ is "other".
 */
export function packageOf(id) {
  if (id.startsWith(fixturesRoot)) return "app";
  const m = id.match(/packages\/([^/]+)\/(?:([^/]+)\/)?dist\//);
  if (!m) return "other";
  const [, pkg, sub] = m;
  return sub && sub !== "dist" ? `${pkg}/${sub}` : pkg;
}
export function moduleOf(id) {
  if (id.startsWith(fixturesRoot)) return `app:${relative(fixturesRoot, id)}`;
  return id.replace(/^.*packages\//, "").replace(/\/dist\/(prod\/|observe\/)?/, ":");
}

export async function bundle(scenario) {
  const target = resolvePath(scenario.path);
  // Mirror size-limit's `import` option: an entry that imports the named
  // bindings from `path` and keeps them alive with a console.log.
  const synthetic = scenario.import
    ? `import ${scenario.import} from ${JSON.stringify(target)};\nconsole.log(${scenario.import.replace(/[{}]/g, "").trim()});\n`
    : null;
  const alias = Object.fromEntries(
    Object.entries(scenario.alias ?? {}).map(([k, v]) => [k, resolvePath(v)])
  );
  const b = await rolldown({
    input: synthetic ? ENTRY : target,
    cwd: here,
    // A scenario's `platform`/`conditions` pick what its third-party imports
    // (seroval) resolve to; our own packages are routed by `alias` either way.
    platform: scenario.platform ?? "browser",
    treeshake: true,
    logLevel: "silent",
    external: scenario.external ?? [],
    // Rolldown's alias matches like Vite's: the first entry whose key equals
    // the specifier or prefixes it at a `/` wins, so scenarios list subpath
    // aliases before the bare package.
    resolve: { alias, ...(scenario.conditions && { conditionNames: scenario.conditions }) },
    plugins: [
      {
        name: "scenario-entry",
        resolveId: id => (id === ENTRY ? ENTRY : null),
        load: id => (id === ENTRY ? synthetic : null)
      },
      // Compiled scenarios: every `.jsx` module is compiled before Rolldown
      // parses it, and arrives as plain JS so Rolldown's own JSX transform
      // never runs on it.
      ...(scenario.compile
        ? [
            {
              name: "scenario-compile",
              load: id =>
                id.endsWith(".jsx")
                  ? { code: compile(id, !!scenario.compile.hydratable), moduleType: "js" }
                  : null
            }
          ]
        : [])
    ]
  });
  try {
    const { output } = await b.generate({
      format: "es",
      minify: true,
      // Stable names so a report is readable; hashes carry no information here.
      entryFileNames: "[name].js",
      chunkFileNames: "[name].js"
    });
    const chunks = output.filter(o => o.type === "chunk");
    const entry = chunks.find(c => c.isEntry);
    // The eager graph: the entry and every chunk it reaches through static
    // imports (`chunk.imports`; `dynamicImports` are the lazy edges).
    const eagerChunks = [entry];
    for (const c of eagerChunks)
      for (const name of c.imports) {
        const dep = chunks.find(d => d.fileName === name);
        if (dep && !eagerChunks.includes(dep)) eagerChunks.push(dep);
      }
    const measure = c => ({ name: c.fileName, min: c.code.length, br: brotli(c.code) });
    const eager = eagerChunks.slice(1).map(measure);
    const lazy = chunks.filter(c => !eagerChunks.includes(c)).map(measure);
    // Per-module contribution: Rolldown reports each module's tree-shaken,
    // rendered source. Minified on its own with the same minifier, a module
    // keeps its chunk-scope names (they are globals to a standalone minify),
    // so the standalone sizes overshoot; they are apportioned to the chunk's
    // real minified length, which makes the per-package figures sum to the
    // chunk the way esbuild's bytesInOutput did. Brotli compresses across
    // modules, so only the chunk total is compressed.
    const modules = [];
    for (const chunk of eagerChunks) {
      const own = [];
      let standalone = 0;
      for (const [id, m] of Object.entries(chunk.modules)) {
        if (!m.code) continue;
        let min;
        try {
          min = minifySync(id, m.code).code.length;
        } catch {
          min = m.renderedLength;
        }
        standalone += min;
        own.push({ id, min });
      }
      const scale = standalone ? chunk.code.length / standalone : 1;
      for (const m of own) modules.push({ id: m.id, min: Math.round(m.min * scale) });
    }
    return {
      name: scenario.name,
      limit: scenario.limit,
      min: eagerChunks.reduce((n, c) => n + c.code.length, 0),
      br: brotli(entry.code) + eager.reduce((n, c) => n + c.br, 0),
      eager,
      lazy,
      modules
    };
  } finally {
    await b.close();
  }
}

export function relativeToRepo(p) {
  return isAbsolute(p) ? relative(join(here, "..", ".."), p) : p;
}
