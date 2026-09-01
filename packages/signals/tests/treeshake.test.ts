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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    // CONSCIOUS BUMP (stage-3 §11b, 2026-08-21): +~120B for hot-path shape
    // alignment — optional-machinery slots moved into the node literals and
    // presence bits on _config, killing megamorphic missing-property reads
    // in setSignal/recompute/commit (measured at 19,570 post-change).
    // CONSCIOUS BUMP (stage-3 §12, 2026-08-21): +~740B for the cold-field
    // extension split (`_x`) — 11 optional-machinery fields moved off the
    // node literals into a lazily-allocated extension, shrinking every memo
    // from 553B to 429B (-22%) and cutting create/update churn 10-19% in the
    // reactivity benchmark. The `_x?.` access chains and the ext()
    // initializer are the byte cost (measured at 20,313 post-change).
    // CONSCIOUS BUMP (stage-3 §12b, 2026-08-21): +~300B for the zombie-pair
    // move into _x (computed literal 29 -> 27 fields) and the plain-commit
    // fast drain in GlobalQueue.flush — update1to1 -12% on top of §12
    // (measured at 20,610 post-change).
    // CONSCIOUS BUMP (2026-08-27): +~350B for the shared effect status
    // notifier (statusNotifierOf + install seam). Storing the SHARED
    // notifyEffectStatus per node via ext() allocated the full 19-field
    // NodeExtension on EVERY effect at creation — +127 B/node heap and +23%
    // effect creation time (shipped unnoticed with stage 3; caught by the
    // creation benches). Measured at 20,956 post-change.
    // CONSCIOUS BUMP (stage-2, 2026-08-27): +~180B in mergeTransitionState —
    // the held-patch stash move + coalescing-stamp retarget (re-audit 5:
    // merged-away stashes double-applied their records' patches at commit).
    // Core-retained by necessity: transition merging cannot be pay-for-use.
    // Measured at 21,134 post-change.
    // NOTE (2026-08-29, no bump): +~100B for until()/resolve()'s seams — the
    // read() A17 carve-out (checks CONFIG_AUTHORITATIVE_READ on the reading
    // computation directly; no ambient flag), the createEffectNode
    // _extraConfig arm, recompute's CONFIG_DIRECT_COMMIT clause (promise
    // effects commit values on their microtask-delivery schedule), the
    // silent-ack notify in recompute, and the
    // GlobalQueue._notifyAuthoritativeObservers slot. Inline in retained hot
    // functions by necessity; the wakeup walk itself is hook-installed at
    // first until() call and shakes with it. Measured at 21,235 post-change.
    // NOTE (2026-08-29, no bump): awaitable refresh() adds ONE term to
    // clearStatus's dispatch gate (CONFIG_QUIESCENCE_OBSERVED — the waiters'
    // settle seam; the registry itself lives in core/quiescence.ts and
    // shakes out with refresh()). Paid for by converting three
    // `slot !== null && slot(...)` gates to `slot?.(...)`.
    // CONSCIOUS BUMP (2026-08-31): +~96B for flight-identity iterator
    // cancellation (#3122) — the `_flightTeardown` ext slot, its
    // registration in consumeIterator, and recompute's supersede release.
    // Core-retained by necessity: supersede happens in recompute, and the
    // async-iterable machinery is already part of the memo floor. Measured
    // at 21,331 post-change.
    // CONSCIOUS BUMP (2026-09-01): +~92B for the pending twin of the #2949
    // silent-recovery sweep (#3181) — recompute captures pending SOURCE-hood
    // and runs settlePendingSource when a synchronous settle supersedes the
    // flight that parked dependents. Core-retained by necessity: the
    // supersede happens in recompute, and settlePendingSource is already
    // part of the async floor. Measured at 21,423 post-change.
    // CONSCIOUS BUMP (2026-09-01): +~155B for the held-truth reveal
    // machinery (#3164: store fold + until() flip-entanglement, unified on
    // CONFIG_HELD_TRUTH) — the read() mask arm, commitPendingNodes'
    // unmask-and-collect, and finalizePureQueue's post-revert wake pass.
    // Core-retained by necessity: read masking and settle ordering cannot
    // be pay-for-use. Paid for by the unification itself (it deleted the
    // GlobalQueue._heldTruthMasked hook slot, a second read() arm, and the
    // Transition._entangled flag plumbing); the arming sites
    // (entangleConfirmingTransitions/stealEntangledCargo, the store fold)
    // still shake out with until()/createOptimisticStore. Measured at
    // 21,536 post-change (with the #3181 bump above).
    expect(minifiedBytes).toBeLessThan(21_600);
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
    // The verdict layer brings the optimistic engine WITH it, by design
    // (verdict.ts's module-scope installOptimisticEngine()): companions
    // (pending signals / latest shadows) are optimistic nodes — their flips
    // route through the optimistic write path and their reversion rides
    // lanes, which is what lets a companion wake escape an incomplete
    // transition's effect stash (#2887; also #2898/#2912). Asserted
    // POSITIVELY so the cost is named instead of invisible: an isPending
    // consumer pays verdict + engine (~1.6 kB gz), and if a future round
    // decouples companion writes from the engine this expectation is the
    // one to flip to an exclusion.
    expect(retainedFrom(retained, ["core/optimistic.ts"])).toEqual(["core/optimistic.ts"]);
    expect(retainedFrom(retained, ["store/", "boundaries.ts", "map.ts", "affects.ts"])).toEqual([]);
  });

  // ---- dist-artifact assertions ----
  //
  // Everything above bundles against src/, which cannot see a coupling the
  // PACKAGING introduces (a build transform reordering imports into side
  // effects, a lost PURE annotation, a bundler bug). These fixtures bundle
  // against the built dist/prod artifact — what apps actually resolve — and
  // assert it retains no module the equivalent src bundle doesn't. Skipped
  // when dist/prod hasn't been built (it is gitignored; run `pnpm build`).
  const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/prod/index.js");

  async function bundleDistFixture(code: string): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), "solid-treeshake-dist-"));
    tempDirs.push(dir);
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, code);
    const result = (await build({
      configFile: false,
      logLevel: "silent",
      resolve: { alias: { sigdist: DIST } },
      build: {
        write: false,
        minify: false,
        target: "esnext",
        lib: { entry, formats: ["es"], fileName: "out" }
      }
    })) as Rollup.RollupOutput[];
    const chunk = result[0].output[0];
    const distRoot = dirname(DIST) + "/";
    return Object.entries(chunk.modules)
      .filter(([, mod]) => mod.renderedLength > 0)
      .map(([id]) => id.replace(distRoot, ""));
  }

  describe.skipIf(!existsSync(DIST))("dist artifact (dist/prod)", () => {
    it("isPending-only fixture retains the same module set as src — packaging adds no coupling", async () => {
      const fixture = `export { createSignal, createEffect, createRoot, flush, isPending, latest } from "SPEC";`;
      const distRetained = await bundleDistFixture(fixture.replace("SPEC", "sigdist"));
      const { retained: srcRetained } = await bundleFixture(fixture.replace("SPEC", "sigsrc"));
      // The by-design verdict -> engine coupling, mirrored from the src test.
      expect(retainedFrom(distRetained, ["core/verdict.js"])).toEqual(["core/verdict.js"]);
      expect(retainedFrom(distRetained, ["core/optimistic.js"])).toEqual(["core/optimistic.js"]);
      expect(
        retainedFrom(distRetained, ["store/", "boundaries.js", "map.js", "affects.js"])
      ).toEqual([]);
      // No dist-only re-coupling: every module the dist bundle retains, the
      // src bundle retains too (src may retain MORE — dev-only modules that
      // the dist build's own defines already stripped).
      const srcNames = new Set(srcRetained.map(id => id.replace(/\.ts$/, ".js")));
      const distOnly = distRetained.filter(id => id.includes("/") && !srcNames.has(id));
      expect(distOnly).toEqual([]);
    });

    it("core-floor fixture keeps every optional feature module out of the dist bundle", async () => {
      const distRetained = await bundleDistFixture(
        `export { createSignal, createMemo, createEffect, createRoot, flush } from "sigdist";`
      );
      expect(
        retainedFrom(distRetained, [
          "store/",
          "boundaries.js",
          "map.js",
          "affects.js",
          "core/verdict.js",
          "core/optimistic.js",
          "core/action.js",
          "core/context.js"
        ])
      ).toEqual([]);
    });
  });
});
