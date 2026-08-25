// Compile-time benchmark: babel-plugin-jsx vs the native (Oxc) compiler.
//
// Compiles the whole Babel fixture corpus under each mode's real options and
// reports per-compiler wall time plus the speedup factor. Two workloads:
//
//   corpus  — every fixture file, one transform call per file (many small
//             files; dominated by per-call overhead + parse)
//   large   — the dom corpus concatenated and repeated into a single ~1 MB
//             module (single-file scaling; dominated by transform itself)
//
// Methodology: N warmup iterations (JIT/inline-cache warmup matters for
// Babel), then M timed iterations; the median is reported. Both compilers
// run in-process over identical source strings.
//
// Requires a *release* build of the native binary for meaningful numbers:
//   pnpm run build && node scripts/bench.mjs
//
// Usage: node scripts/bench.mjs [--warmup N] [--iterations M] [--json]

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const harness = require(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../__tests__/parity/harness.js")
);
const { modes, fixtureNames, readFixtureSource, compileBabel, compileOxc } = harness;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? Number(args[i + 1]) : fallback;
};
const WARMUP = flag("warmup", 3);
const ITERATIONS = flag("iterations", 7);
const JSON_OUT = args.includes("--json");

// --- Workloads --------------------------------------------------------------

// [{ mode, fixture, source, options, bytes }]
const corpus = [];
for (const [modeName, mode] of Object.entries(modes)) {
  for (const fixture of fixtureNames(modeName)) {
    const source = readFixtureSource(modeName, fixture);
    corpus.push({
      label: `${modeName}/${fixture}`,
      fixture,
      source,
      options: mode.options,
      bytes: Buffer.byteLength(source)
    });
  }
}

// Single module of roughly `targetBytes`: repeat the dom corpus, wrapping
// every fixture in its own function scope so top-level names don't collide.
function buildModule(targetBytes) {
  const domSources = corpus
    .filter(entry => entry.label.startsWith("dom/"))
    .map(entry => entry.source)
    // Fixtures with top-level import/export can't nest inside a function.
    .filter(source => !/^\s*(import|export)\s/m.test(source));
  const parts = [];
  let bytes = 0;
  for (let i = 0; bytes < targetBytes; i++) {
    for (let j = 0; j < domSources.length && bytes < targetBytes; j++) {
      const part = `function _copy${i}_${j}$() {\n${domSources[j]}\n}`;
      parts.push(part);
      bytes += Buffer.byteLength(part);
    }
  }
  return parts.join("\n");
}
const mediumSource = buildModule(128 * 1024);
const largeSource = buildModule(1024 * 1024);
const largeOptions = modes.dom.options;

// --- Measurement -------------------------------------------------------------

function timeIteration(fn) {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6; // ms
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Some fixtures intentionally trigger compiler warnings (_hk attributes,
// validate markup) on every compile; silence the JS console during timed
// runs so terminal I/O doesn't pollute output or timings. The native
// compiler's validate warnings go to the process stderr fd — run with
// `2>/dev/null` if that noise bothers you; it doesn't affect the comparison
// since both compilers do the validation work either way.
function silenced(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    fn();
  } finally {
    Object.assign(console, saved);
  }
}

function bench(name, fn) {
  silenced(() => {
    for (let i = 0; i < WARMUP; i++) fn();
  });
  const samples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    silenced(() => samples.push(timeIteration(fn)));
  }
  return { name, median: median(samples), min: Math.min(...samples), samples };
}

const runCorpusBabel = () => {
  for (const entry of corpus) compileBabel(entry.source, entry.options);
};
const runCorpusOxc = () => {
  for (const entry of corpus) compileOxc(entry.source, entry.fixture, entry.options);
};
const runMediumBabel = () => compileBabel(mediumSource, largeOptions);
const runMediumOxc = () => compileOxc(mediumSource, "medium", largeOptions);
const runLargeBabel = () => compileBabel(largeSource, largeOptions);
const runLargeOxc = () => compileOxc(largeSource, "large", largeOptions);

// Sanity: both compilers must actually succeed on the workloads before timing.
silenced(() => {
  runCorpusBabel();
  runCorpusOxc();
  runMediumBabel();
  runMediumOxc();
  runLargeBabel();
  runLargeOxc();
});

const corpusBytes = corpus.reduce((sum, entry) => sum + entry.bytes, 0);
const mediumBytes = Buffer.byteLength(mediumSource);
const largeBytes = Buffer.byteLength(largeSource);

const results = [
  {
    workload: `corpus (${corpus.length} files, ${(corpusBytes / 1024).toFixed(0)} KB)`,
    bytes: corpusBytes,
    babel: bench("babel", runCorpusBabel),
    native: bench("native", runCorpusOxc)
  },
  {
    workload: `medium file (${(mediumBytes / 1024).toFixed(0)} KB single module)`,
    bytes: mediumBytes,
    babel: bench("babel", runMediumBabel),
    native: bench("native", runMediumOxc)
  },
  {
    workload: `large file (${(largeBytes / 1024).toFixed(0)} KB single module)`,
    bytes: largeBytes,
    babel: bench("babel", runLargeBabel),
    native: bench("native", runLargeOxc)
  }
];

// --- Report -------------------------------------------------------------------

if (JSON_OUT) {
  console.log(JSON.stringify({ warmup: WARMUP, iterations: ITERATIONS, results }, null, 2));
} else {
  console.log(`warmup=${WARMUP} iterations=${ITERATIONS} (median reported)\n`);
  for (const r of results) {
    const speedup = r.babel.median / r.native.median;
    const mbps = ms => (r.bytes / 1024 / 1024 / (ms / 1000)).toFixed(1);
    console.log(r.workload);
    console.log(
      `  babel-plugin-jsx  ${r.babel.median.toFixed(1).padStart(8)} ms   ${mbps(r.babel.median).padStart(6)} MB/s`
    );
    console.log(
      `  native (oxc)      ${r.native.median.toFixed(1).padStart(8)} ms   ${mbps(r.native.median).padStart(6)} MB/s`
    );
    console.log(`  speedup           ${speedup.toFixed(1).padStart(8)}x\n`);
  }
}
