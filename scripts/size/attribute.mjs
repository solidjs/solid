// Per-package attribution for every scenario in .size-limit.js.
//
// size-limit answers "did the cap hold"; this answers "which package moved".
// Each scenario is bundled the way size-limit bundles it (same entry, same
// alias/external through modifyEsbuildConfig, no code splitting) with an
// esbuild metafile, and the minified bytes each input contributed to the
// output are summed per package. Minified bytes are the attributable unit —
// brotli compresses across module boundaries, so the compressed total is
// reported for the bundle only. Runs after size-limit in `npm run size`.
//
// Usage: node attribute.mjs [--modules] [scenario-substring ...]
//   --modules  also list the individual dist modules over 200 minified bytes

import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const checks = createRequire(import.meta.url)("./.size-limit.js");

const args = process.argv.slice(2);
const listModules = args.includes("--modules");
const filters = args.filter(a => !a.startsWith("--"));

// Maps an esbuild input path to the package that shipped it. Anything not
// under packages/ (the scenario file itself, node_modules deps such as
// seroval) is grouped as "other".
function packageOf(input) {
  const m = input.match(/packages\/([^/]+)\/(?:([^/]+)\/)?dist\//);
  if (!m) return "other";
  const [, pkg, sub] = m;
  // packages/web/frames/dist → web/frames; packages/web/dist → web
  return sub && sub !== "dist" ? `${pkg}/${sub}` : pkg;
}

function moduleOf(input) {
  return input.replace(/^.*packages\//, "").replace(/\/dist\/(prod\/)?/, ":");
}

const brotli = buf =>
  brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

const scratch = mkdtempSync(join(tmpdir(), "solid-size-attr-"));
try {
  for (const check of checks) {
    if (filters.length && !filters.some(f => check.name.includes(f))) continue;
    // Mirror size-limit's `import` option: an entry that imports the named
    // bindings from `path` and keeps them alive with a console.log.
    let entry = join(here, check.path);
    if (check.import) {
      const list = check.import.replace(/[{}]/g, "").trim();
      entry = join(scratch, `${check.name.replace(/\W+/g, "-")}.js`);
      writeFileSync(
        entry,
        `import ${check.import} from ${JSON.stringify(join(here, check.path))};\nconsole.log(${list});\n`
      );
    }
    let config = {
      absWorkingDir: here,
      bundle: true,
      entryPoints: [entry],
      metafile: true,
      minify: true,
      treeShaking: true,
      write: false,
      logLevel: "silent"
    };
    if (check.modifyEsbuildConfig) config = check.modifyEsbuildConfig(config);
    const result = await build(config);
    const output =
      Object.values(result.metafile.outputs).find(o => o.entryPoint) ??
      Object.values(result.metafile.outputs)[0];
    const bytes = result.outputFiles.reduce((s, f) => s + f.contents.length, 0);
    const br = result.outputFiles.reduce((s, f) => s + brotli(f.contents), 0);

    const byPackage = new Map();
    const byModule = [];
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      const pkg = packageOf(input);
      byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + bytesInOutput);
      if (bytesInOutput > 200 && pkg !== "other") byModule.push([moduleOf(input), bytesInOutput]);
    }
    const packages = [...byPackage].sort((a, b) => b[1] - a[1]);

    console.log(`\n${check.name}`);
    console.log(`  minified ${bytes} B   brotli ${br} B`);
    console.log("  " + packages.map(([p, b]) => `${p}=${b}`).join("  "));
    if (listModules)
      for (const [m, b] of byModule.sort((a, b) => b[1] - a[1]))
        console.log(`    ${String(b).padStart(7)}  ${m}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
