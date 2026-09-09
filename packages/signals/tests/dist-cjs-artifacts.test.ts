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
 * The CJS tiers exist so a CJS host resolving solid-js's `dist/server.dev.cjs`
 * (or `server.observe.cjs`) gets a signals with the matching objects — one
 * tier per process, not one per module format. The ESM trees are checked
 * through the same lens via dynamic import. Requires a prior build (the turbo
 * `test` task depends on `build`).
 *
 * The `./attribution` entry is checked per tier too: the engine must share
 * the core's module instance (the code-split flat builds exist for exactly
 * this), prod's inert twin must never install anything, and the observe
 * core must not carry the engine — that is the whole point of the entry.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);

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

describe("@solidjs/signals CJS artifacts", () => {
  test("dist/node.cjs (prod) exports DEV and OBSERVE as undefined", () => {
    const prod = require("../dist/node.cjs") as Tier;
    expect(prod.DEV).toBeUndefined();
    expect(prod.OBSERVE).toBeUndefined();
  });

  test("dist/node.observe.cjs exports a live OBSERVE and no DEV", () => {
    const observe = require("../dist/node.observe.cjs") as Tier;
    expectObserveLive(observe);
    expect(observe.DEV).toBeUndefined();
  });

  test("dist/node.dev.cjs exports live OBSERVE and DEV", () => {
    const dev = require("../dist/node.dev.cjs") as Tier;
    expectObserveLive(dev);
    expectDevLive(dev);
  });

  test("the three artifacts export the same surface", () => {
    const prod = require("../dist/node.cjs");
    const observe = require("../dist/node.observe.cjs");
    const dev = require("../dist/node.dev.cjs");
    expect(Object.keys(observe).sort()).toEqual(Object.keys(prod).sort());
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
  });

  test("./attribution: node.attribution.cjs (prod) is the inert engine", () => {
    expectEngineInert(require("../dist/node.attribution.cjs"));
    // Inert means inert: it must not even import the core.
    expect(
      readFileSync(new URL("../dist/node.attribution.cjs", import.meta.url), "utf8")
    ).not.toMatch(/require\(/);
  });

  test("./attribution: node.observe.attribution.cjs drives node.observe.cjs", () => {
    expectEngineDrivesCore(
      require("../dist/node.observe.cjs"),
      require("../dist/node.observe.attribution.cjs")
    );
  });

  test("./attribution: node.dev.attribution.cjs drives node.dev.cjs", () => {
    expectEngineDrivesCore(
      require("../dist/node.dev.cjs"),
      require("../dist/node.dev.attribution.cjs")
    );
  });

  test("the engine is not in the observe core", () => {
    // The code-split chunk is what the two entries share; the engine's own
    // code must sit only in its entry, or the observe tier ships it to every
    // consumer whether or not it ever enables attribution.
    const read = (f: string) => readFileSync(new URL(`../dist/${f}`, import.meta.url), "utf8");
    expect(read("node.observe.cjs")).not.toContain(ENGINE_MARK);
    expect(read("node.observe-shared.cjs")).not.toContain(ENGINE_MARK);
    expect(read("node.observe.attribution.cjs")).toContain(ENGINE_MARK);
  });
});

describe("@solidjs/signals ESM artifacts", () => {
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
