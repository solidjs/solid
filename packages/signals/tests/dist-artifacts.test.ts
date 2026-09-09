/**
 * Direct coverage of the built artifacts across the three tiers. The suite
 * otherwise imports source under vitest's `__DEV__: true` define, so it
 * cannot see whether each artifact's replace ran. `DEV` and `OBSERVE` are
 * the observables:
 *
 *   prod     DEV undefined   OBSERVE undefined
 *   observe  DEV undefined   OBSERVE live       (wiring, no checks)
 *   dev      DEV live        OBSERVE live       (dev is a superset of observe)
 *
 * Every artifact is ESM. A CJS host on Node >= 22.12 (the `engines` floor)
 * reaches the same files through `require()` — Node loads ESM synchronously
 * there, provided the graph has no top-level await — so the second half of
 * this file `require`s each tier and checks it is the SAME module instance
 * `import` produced. One tier per process, not one per module format.
 * Requires a prior build (the turbo `test` task depends on `build`).
 *
 * The `./attribution` entry is checked per tier too: the engine must share
 * the core's module instance (the code-split flat dev build exists for
 * exactly this), prod's inert twin must never install anything, and the
 * observe core must not carry the engine — that is the whole point of the
 * entry.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

type Tier = { DEV: unknown; OBSERVE: unknown };
type Engine = { attribution: any };

function expectObserveLive(mod: Tier) {
  const observe = mod.OBSERVE as any;
  expect(observe).toBeDefined();
  expect(typeof observe.diagnostics.subscribe).toBe("function");
  expect(typeof observe.diagnostics.capture).toBe("function");
  expect(typeof observe.diagnostics.emit).toBe("function");
  // The core's side of attribution is the slot and the interaction frame only.
  expect(typeof observe.attribution.install).toBe("function");
  expect(typeof observe.attribution.withInteraction).toBe("function");
  expect(observe.attribution.installed).toBeNull();
  expect(observe.attribution.enable).toBeUndefined();
  expect(typeof observe.subjectOf).toBe("function");
}

/**
 * The engine drives the core it was built with: enabling installs into the
 * slot, a write re-runs an effect, and the run is attributed with the
 * interaction the core's `withInteraction` opened — one module instance end
 * to end, or the hooks would land in a core nobody is flushing.
 */
function expectEngineDrivesCore(core: any, engine: Engine) {
  const { attribution } = engine;
  const observe = core.OBSERVE;
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false });
  try {
    expect(observe.attribution.installed).not.toBeNull();
    const runs: any[] = [];
    attribution.subscribe((e: any) => runs.push(e));
    const setCount = core.createRoot(() => {
      const [count, set] = core.createSignal(0, { name: "count" });
      core.createEffect(count, () => {}, { name: "reader" });
      return set;
    });
    core.flush();
    observe.attribution.withInteraction({ type: "click", target: "button#go" }, () => setCount(1));
    core.flush();
    const rerun = runs.find(r => r.nodeName === "reader" && r.causes.length);
    expect(rerun).toBeDefined();
    expect(rerun.causes[0].name).toBe("count");
    expect(rerun.interaction).toMatchObject({ kind: "interaction", name: "click" });
  } finally {
    attribution.disable();
  }
  expect(observe.attribution.installed).toBeNull();
}

/** Prod's engine: the same surface, inert — nothing to install into. */
function expectEngineInert(engine: Engine) {
  const { attribution } = engine;
  expect(() => attribution.enable()).not.toThrow();
  expect(attribution.history()).toEqual([]);
  expect(attribution.costs()).toEqual({ scopes: [], writes: [] });
  expect(attribution.holds()).toEqual([]);
  expect(attribution.feedback()).toEqual({
    sources: [],
    interactions: [],
    flights: [],
    fallbacks: []
  });
  attribution.disable();
}

/** A distinctive engine-only string: the console prefix of the re-run log. */
const ENGINE_MARK = "[why-run]";

function expectDevLive(mod: Tier) {
  const dev = mod.DEV as any;
  expect(dev).toBeDefined();
  expect(typeof dev.hooks).toBe("object");
  expect(typeof dev.getChildren).toBe("function");
  expect(typeof dev.report).toBe("function");
  expect(typeof dev.setConsoleFooter).toBe("function");
  // The console face and devtools surface do not leak onto the observe object.
  expect((mod.OBSERVE as any).setConsoleFooter).toBeUndefined();
  expect((mod.OBSERVE as any).hooks).toBeUndefined();
}

/** The three tiers' (core, engine) entry pairs, relative to dist/. */
const TIERS = {
  prod: ["prod/index.js", "prod/attribution.js"],
  observe: ["observe/index.js", "observe/attribution.js"],
  dev: ["dev.js", "dev.attribution.js"]
} as const;

describe("@solidjs/signals artifacts", () => {
  test("dist/prod/index.js exports DEV and OBSERVE as undefined", async () => {
    const prod = (await import("../dist/prod/index.js")) as Tier;
    expect(prod.DEV).toBeUndefined();
    expect(prod.OBSERVE).toBeUndefined();
  });

  test("dist/observe/index.js exports a live OBSERVE and no DEV", async () => {
    const observe = (await import("../dist/observe/index.js")) as Tier;
    expectObserveLive(observe);
    expect(observe.DEV).toBeUndefined();
  });

  test("dist/dev.js exports live OBSERVE and DEV", async () => {
    const dev = (await import("../dist/dev.js")) as Tier;
    expectObserveLive(dev);
    expectDevLive(dev);
  });

  test("the three tiers export the same surface", async () => {
    const prod = await import("../dist/prod/index.js");
    const observe = await import("../dist/observe/index.js");
    const dev = await import("../dist/dev.js");
    expect(Object.keys(observe).sort()).toEqual(Object.keys(prod).sort());
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
  });

  test("the dev build's engine is not in its core", () => {
    // The code-split chunk is what the two entries share; the engine's own
    // code must sit only in its entry, or every dev consumer carries it
    // whether or not it ever enables attribution.
    const read = (f: string) => readFileSync(new URL(`../dist/${f}`, import.meta.url), "utf8");
    expect(read("dev.js")).not.toContain(ENGINE_MARK);
    expect(read("dev-shared.js")).not.toContain(ENGINE_MARK);
    expect(read("dev.attribution.js")).toContain(ENGINE_MARK);
  });
});

describe("@solidjs/signals artifacts under require()", () => {
  // Node >= 22.12 loads ESM through `require()` synchronously. That is what
  // lets the package ship ESM only: a CJS host follows the same export
  // conditions to the same files. Two things must hold for it to work, and
  // each is pinned here against the real loader in a child Node rather than
  // through vitest's module runner (which would give `import` its own
  // transformed instance and make the identity check meaningless):
  //
  //  1. No entry's graph may contain a top-level `await` — Node throws
  //     ERR_REQUIRE_ASYNC_MODULE for that, and a bundler-oriented tree is one
  //     stray `await` from breaking every CJS consumer at once.
  //  2. `require` and `import` of one artifact must yield ONE module
  //     instance, or a CJS host with an ESM dependency would run two cores
  //     and the engine would install into the wrong one.
  const RESOLVE_PROBE = `
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    const require = createRequire(import.meta.url);
    const [core, engine] = process.argv.slice(1);
    const out = { requireModule: process.features.require_module };
    const viaRequire = require(core);
    const viaImport = await import(pathToFileURL(core).href);
    out.sameInstance = viaRequire.createSignal === viaImport.createSignal;
    out.sameObserve = viaRequire.OBSERVE === viaImport.OBSERVE;
    out.hasDefaultLeak = "default" in viaRequire;
    const engineViaRequire = require(engine);
    out.engineSameInstance =
      engineViaRequire.attribution === (await import(pathToFileURL(engine).href)).attribution;
    process.stdout.write(JSON.stringify(out));
  `;

  function probe(tier: keyof typeof TIERS) {
    const dist = (f: string) => fileURLToPath(new URL(`../dist/${f}`, import.meta.url));
    const [core, engine] = TIERS[tier];
    return JSON.parse(
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", RESOLVE_PROBE, "--", dist(core), dist(engine)],
        { encoding: "utf8" }
      )
    );
  }

  test("this Node has require(esm) (the engines floor)", () => {
    expect(process.features.require_module).toBe(true);
  });

  for (const tier of Object.keys(TIERS) as (keyof typeof TIERS)[]) {
    test(`${tier}: require() and import() of the core and engine yield one instance each`, () => {
      const result = probe(tier);
      expect(result.requireModule).toBe(true);
      // The require succeeding at all is the top-level-await guard.
      expect(result.sameInstance).toBe(true);
      expect(result.sameObserve).toBe(true);
      expect(result.engineSameInstance).toBe(true);
      // No default export anywhere, so the namespace `require` hands back is
      // the same flat surface `import * as` gives; Node marks it __esModule
      // for interop only when a default export exists.
      expect(result.hasDefaultLeak).toBe(false);
    });
  }

  test("no shipped artifact contains a top-level await", () => {
    // Belt to the probe's braces: the probe only loads what the entries reach
    // today; a module that a future entry pulls in would still be caught by
    // scanning every file the trees ship.
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : /\.js$/.test(name) ? [p] : [];
      });
    const dist = fileURLToPath(new URL("../dist/", import.meta.url));
    const files = walk(dist).filter(f => !f.includes("/types/"));
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      // Any `await` at brace depth zero. Cheap and conservative: the engine
      // and core have no async functions at module scope, so a match is a
      // real top-level await, not a false positive from an inner body.
      // Comments are skipped: the observe/dev tiers keep them, and an
      // apostrophe in a module-scope docblock would otherwise open a phantom
      // string and derail the depth count.
      let depth = 0;
      let inString: string | null = null;
      let tla = false;
      for (let i = 0; i < code.length && !tla; i++) {
        const c = code[i];
        if (inString) {
          if (c === "\\") i++;
          else if (c === inString) inString = null;
          continue;
        }
        if (c === "/" && code[i + 1] === "/") {
          const nl = code.indexOf("\n", i);
          i = nl === -1 ? code.length : nl;
          continue;
        }
        if (c === "/" && code[i + 1] === "*") {
          const end = code.indexOf("*/", i + 2);
          i = end === -1 ? code.length : end + 1;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") inString = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (depth === 0 && code.startsWith("await", i) && !/\w/.test(code[i - 1] ?? " ")) {
          tla = !/\w/.test(code[i + 5] ?? " ");
        }
      }
      expect(tla, `${file} has a top-level await`).toBe(false);
    }
  });
});

describe("@solidjs/signals engine per tier", () => {
  test("./attribution: prod/attribution.js is the inert engine and imports nothing", async () => {
    expectEngineInert((await import("../dist/prod/attribution.js")) as Engine);
    const src = readFileSync(new URL("../dist/prod/attribution.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/^import /m);
  });

  test("./attribution: observe/attribution.js drives observe/index.js", async () => {
    expectEngineDrivesCore(
      await import("../dist/observe/index.js"),
      (await import("../dist/observe/attribution.js")) as Engine
    );
  });

  test("./attribution: dev.attribution.js drives dev.js", async () => {
    expectEngineDrivesCore(
      await import("../dist/dev.js"),
      (await import("../dist/dev.attribution.js")) as Engine
    );
  });

  test("the observe tree keeps the engine out of the core's module graph", () => {
    // Nothing reachable from index.js may import core/attribution.js: the
    // per-module tree is what lets a bundler drop the engine, and one stray
    // import from the core would pull it back into every observe consumer.
    const read = (f: string) =>
      readFileSync(new URL(`../dist/observe/${f}`, import.meta.url), "utf8");
    for (const f of ["index.js", "core/dev.js", "core/attribution-hooks.js"]) {
      expect(read(f), f).not.toMatch(/from "\.\/attribution\.js"|core\/attribution\.js/);
      expect(read(f), f).not.toContain(ENGINE_MARK);
    }
    expect(read("core/attribution.js")).toContain(ENGINE_MARK);
  });

  test("observe tier: a mangled owner still reads the cross-package `_name` label", async () => {
    const { OBSERVE, createRoot, getOwner } = (await import("../dist/observe/index.js")) as any;
    // Mirrors what solid-js's observe build does for a component: a root
    // labelled from OUTSIDE the package. The observe tree is property-mangled;
    // if `_name` were not reserved the label would land on a property
    // ownerPath never reads.
    const capture = OBSERVE.diagnostics.capture();
    createRoot(() => {
      const owner = getOwner();
      owner._name = "<App>";
      OBSERVE.diagnostics.emit(
        { code: "INVARIANT_VIOLATION", kind: "error", severity: "error", message: "probe" },
        owner
      );
    });
    const [event] = capture.stop();
    expect(event.ownerPath).toEqual(["<App>"]);
    expect(OBSERVE.subjectOf(event)).toBeDefined();
  });
});
