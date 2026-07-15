/**
 * Bundle-fixture guard for pay-for-use tree-shaking (#2883).
 *
 * Bundles small entry fixtures against src/ with production defines and
 * asserts (a) feature modules that must shake out of lean bundles actually
 * shake, and (b) the minified core floor stays under a byte ceiling. The
 * ceilings have ~8% headroom over the sizes measured when this test landed —
 * a failure here means a change re-coupled a feature into the core (usually a
 * new direct import or an unshakeable top-level side effect), not that a few
 * bytes drifted.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transformWithEsbuild, type Rollup } from "vite";
import { afterAll, describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function bundleFixture(code: string): Promise<{
  minifiedBytes: number;
  retained: string[];
}> {
  const dir = mkdtempSync(join(tmpdir(), "solid-treeshake-"));
  tempDirs.push(dir);
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, code);
  const result = (await build({
    configFile: false,
    logLevel: "silent",
    define: { __DEV__: "false", __TEST__: "false" },
    resolve: { alias: { sigsrc: join(SRC, "index.ts") } },
    build: {
      write: false,
      minify: false,
      target: "esnext",
      lib: { entry, formats: ["es"], fileName: "out" }
    }
  })) as Rollup.RollupOutput[];
  const chunk = result[0].output[0];
  const retained = Object.entries(chunk.modules)
    .filter(([, mod]) => mod.renderedLength > 0)
    .map(([id]) => id.replace(SRC + "/", ""));
  // Vite lib-mode ES output is not truly minified; match the #2883 harness
  // (esbuild minify + `_`-prefixed property mangling, as the dist build does).
  const minified = await transformWithEsbuild(chunk.code, "out.js", {
    minify: true,
    mangleProps: /^_/
  });
  return { minifiedBytes: Buffer.byteLength(minified.code), retained };
}

function retainedFrom(retained: string[], names: string[]): string[] {
  return names.filter(name => retained.some(id => id.includes(name)));
}

describe("pay-for-use tree-shaking (#2883)", () => {
  it("core floor sheds every optional feature module", async () => {
    const { minifiedBytes, retained } = await bundleFixture(
      `export { createSignal, createMemo, createEffect, createRoot, flush } from "sigsrc";`
    );
    // Explicitly-imported APIs are the opt-ins: none of their modules may be
    // reachable from the five core primitives.
    expect(
      retainedFrom(retained, [
        "store/",
        "boundaries.ts",
        "map.ts",
        "affects.ts",
        "core/verdict.ts",
        "core/optimistic.ts",
        "core/action.ts",
        "core/context.ts"
      ])
    ).toEqual([]);
    // Ceiling: 18,214 bytes measured at landing (vite/rollup bundle +
    // esbuild minify with `_`-property mangling) + ~7% headroom.
    expect(minifiedBytes).toBeLessThan(19_500);
  });

  it("plain stores shed the verdict layer, affects, boundaries, and map", async () => {
    const { retained } = await bundleFixture(
      `export { createStore, createSignal, createEffect, createRoot, flush } from "sigsrc";`
    );
    // reconcile.ts/projection.ts stay: the derived createStore overload keeps
    // them statically coupled by design (API symmetry ruling, #2883).
    expect(
      retainedFrom(retained, [
        "core/verdict.ts",
        "core/optimistic.ts",
        "affects.ts",
        "boundaries.ts",
        "map.ts"
      ])
    ).toEqual([]);
  });

  it("createOptimistic loads the optimistic engine; the floor ceiling reflects its absence", async () => {
    const { retained } = await bundleFixture(
      `export { createSignal, createEffect, createRoot, flush, createOptimistic } from "sigsrc";`
    );
    expect(retainedFrom(retained, ["core/optimistic.ts"])).toEqual(["core/optimistic.ts"]);
  });

  it("isPending/latest load the verdict layer and nothing else new", async () => {
    const { retained } = await bundleFixture(
      `export { createSignal, createEffect, createRoot, flush, isPending, latest } from "sigsrc";`
    );
    expect(retainedFrom(retained, ["core/verdict.ts"])).toEqual(["core/verdict.ts"]);
    expect(retainedFrom(retained, ["store/", "boundaries.ts", "map.ts", "affects.ts"])).toEqual([]);
  });
});
