/**
 * @jsxImportSource @solidjs/web
 *
 * Pins how the server entry points of `solid-js` and `@solidjs/web` resolve
 * under Node's real exports algorithm, with and without the `development`
 * condition. Two invariants:
 *
 * 1. Pairing — every server entry flips to its `.dev` artifact together. The
 *    web server bundle externalizes `solid-js`, so the host resolves each
 *    package independently; a dev `@solidjs/web` over a prod `solid-js` (or
 *    the reverse) is a mixed build nobody tested.
 * 2. Ordering — `development` must be NESTED under `node`/`worker`/`deno`.
 *    Exports conditions match in key order, and every server condition
 *    precedes the top-level `development` key, so a top-level entry would
 *    silently never match on a server. This was the shape that left SSR with
 *    no dev build at all until dist/server.dev.* existed.
 *
 * Resolution is done by spawning Node with `--conditions` rather than by
 * reimplementing the exports algorithm in-test: a host runtime is what does
 * this for real, and Node's resolver is the reference. Runs from
 * packages/web, where `node_modules/solid-js` and the self-link
 * `node_modules/@solidjs/web` (the `link` build step) both exist.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const SPECIFIERS = [
  "solid-js",
  "@solidjs/web",
  "@solidjs/web/frames",
  "@solidjs/web/frames/server",
  "@solidjs/web/server-functions"
] as const;

function resolveAll(conditions: string[]): Record<string, string> {
  const script =
    `const out = {}; for (const s of ${JSON.stringify(SPECIFIERS)}) ` +
    `out[s] = import.meta.resolve(s).replace(/^.*\\/packages\\//, ""); ` +
    `process.stdout.write(JSON.stringify(out));`;
  const stdout = execFileSync(
    process.execPath,
    [...conditions.map(c => `--conditions=${c}`), "--input-type=module", "-e", script],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  return JSON.parse(stdout);
}

describe("export conditions: dev/prod artifact pairing", () => {
  test("default node resolution reaches the production server artifacts", () => {
    expect(resolveAll([])).toEqual({
      "solid-js": "solid/dist/server.js",
      "@solidjs/web": "web/dist/server.js",
      "@solidjs/web/frames": "web/frames/dist/server.js",
      "@solidjs/web/frames/server": "web/frames/dist/server.js",
      "@solidjs/web/server-functions": "web/server-functions/dist/server.js"
    });
  });

  test("`development` flips every server entry to its dev artifact together", () => {
    expect(resolveAll(["development"])).toEqual({
      "solid-js": "solid/dist/server.dev.js",
      "@solidjs/web": "web/dist/server.dev.js",
      "@solidjs/web/frames": "web/frames/dist/server.dev.js",
      "@solidjs/web/frames/server": "web/frames/dist/server.dev.js",
      "@solidjs/web/server-functions": "web/server-functions/dist/server.dev.js"
    });
  });

  test("`browser` selects the client artifacts, named `<entry>.dev.js` like the server ones", () => {
    // Node still adds its own `node` condition here, so this also pins that
    // `browser` precedes `node`/`worker`/`deno` in every exports map — a
    // bundler targeting the browser must never be handed a server bundle.
    expect(resolveAll(["browser"])).toEqual({
      "solid-js": "solid/dist/solid.js",
      "@solidjs/web": "web/dist/web.js",
      "@solidjs/web/frames": "web/frames/dist/client.js",
      "@solidjs/web/frames/server": "web/frames/dist/server.js",
      "@solidjs/web/server-functions": "web/server-functions/dist/client.js"
    });
    expect(resolveAll(["browser", "development"])).toEqual({
      "solid-js": "solid/dist/solid.dev.js",
      "@solidjs/web": "web/dist/web.dev.js",
      "@solidjs/web/frames": "web/frames/dist/client.dev.js",
      // `./frames/server` is server-only by name; it has no client half.
      "@solidjs/web/frames/server": "web/frames/dist/server.dev.js",
      // The server-functions client has no `_SOLID_DEV_` gates, hence no dev
      // artifact — the one intentional gap in the grid.
      "@solidjs/web/server-functions": "web/server-functions/dist/client.js"
    });
  });

  // A CJS host resolves through `require`, and there is no `require` branch
  // anywhere in these exports maps: every package ships ESM only and relies on
  // Node >= 22.12 loading ESM through `require()`. So the `require` walk must
  // land on exactly the files `import` lands on, hop by hop — the web server
  // bundle externalizes solid-js, and solid-js's server bundle externalizes
  // @solidjs/signals, so the host resolves each in turn and a tier mismatch
  // at any hop is a mixed build (a dev solid-js whose `DEV` export is signals'
  // prod `undefined`, say).
  function requireHops(conditions: string[]): string[] {
    const script =
      `const { createRequire } = require("node:module"); ` +
      `const r = createRequire(process.cwd() + "/"); ` +
      `const web = r.resolve("@solidjs/web"); ` +
      `const solid = r.resolve("solid-js"); ` +
      `const signals = createRequire(solid).resolve("@solidjs/signals"); ` +
      `process.stdout.write(JSON.stringify([web, solid, signals].map(p => p.replace(/^.*\\/packages\\//, ""))));`;
    return JSON.parse(
      execFileSync(process.execPath, [...conditions.map(c => `--conditions=${c}`), "-e", script], {
        cwd: process.cwd(),
        encoding: "utf8"
      })
    );
  }

  test("`require` walks web → solid-js → signals onto the same ESM files as `import`, per tier", () => {
    expect(requireHops([])).toEqual([
      "web/dist/server.js",
      "solid/dist/server.js",
      "signals/dist/prod/index.js"
    ]);
    expect(requireHops(["development"])).toEqual([
      "web/dist/server.dev.js",
      "solid/dist/server.dev.js",
      "signals/dist/dev.js"
    ]);
    expect(requireHops(["observe"])).toEqual([
      // web's server observe artifact populates `OBSERVE.server` — it has
      // to meet solid-js's (and so signals') observe object at the hop.
      "web/dist/server.observe.js",
      "solid/dist/server.observe.js",
      "signals/dist/observe/index.js"
    ]);
  });

  test("a CJS host actually loads the ESM server entries through require()", () => {
    // Resolution agreeing is necessary, not sufficient: `require(esm)` throws
    // ERR_REQUIRE_ASYNC_MODULE if any module in the graph has a top-level
    // await. Load the whole chain the way a CJS server would and check the
    // instance is shared with `import` — the same signals object on both
    // sides, or a CJS host with one ESM dependency would run two cores.
    const script =
      `const web = require("@solidjs/web"); ` +
      `const solid = require("solid-js"); ` +
      `import("solid-js").then(esm => { ` +
      `  process.stdout.write(JSON.stringify({ ` +
      `    renders: typeof web.renderToString === "function", ` +
      `    sameSolid: esm.createSignal === solid.createSignal, ` +
      `    devIsDefined: solid.DEV !== undefined ` +
      `  })); ` +
      `});`;
    const run = (conditions: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [...conditions.map(c => `--conditions=${c}`), "-e", script],
          { cwd: process.cwd(), encoding: "utf8" }
        )
      );
    expect(run([])).toEqual({ renders: true, sameSolid: true, devIsDefined: false });
    expect(run(["development"])).toEqual({ renders: true, sameSolid: true, devIsDefined: true });
  });

  test("`observe` selects the observe artifacts where wiring exists and falls through to prod elsewhere", () => {
    // The observe tier is a build flavor only for entries that contain
    // wiring (labels, attribution hook sites, the server observe surface):
    // solid-js (client and server), @solidjs/web's client and every
    // @solidjs/web SERVER entry, @solidjs/universal, and @solidjs/signals.
    // The frames and server-functions CLIENT halves have none, so under
    // `observe` they must resolve to their PROD artifacts — never dev (dev
    // would re-enable the checks).
    expect(resolveAll(["browser", "observe"])).toEqual({
      "solid-js": "solid/dist/solid.observe.js",
      "@solidjs/web": "web/dist/web.observe.js",
      "@solidjs/web/frames": "web/frames/dist/client.js",
      // `./frames/server` is server-only by name; the server tier applies.
      "@solidjs/web/frames/server": "web/frames/dist/server.observe.js",
      "@solidjs/web/server-functions": "web/server-functions/dist/client.js"
    });
    expect(resolveAll(["observe"])).toEqual({
      // Every server entry flips together: each server bundle carries its
      // own copy of the runtime module that populates `OBSERVE.server`, and
      // the server-functions bundle carries the invocation observation, so a
      // prod artifact in the mix would be a bundle that silently never
      // reports.
      "solid-js": "solid/dist/server.observe.js",
      "@solidjs/web": "web/dist/server.observe.js",
      "@solidjs/web/frames": "web/frames/dist/server.observe.js",
      "@solidjs/web/frames/server": "web/frames/dist/server.observe.js",
      "@solidjs/web/server-functions": "web/server-functions/dist/server.observe.js"
    });
  });

  test("`development` wins over `observe` when both are present (dev is a superset of observe)", () => {
    // A dev server that also sets `observe` must still get the checks;
    // `development` is listed before `observe` in every exports map, and
    // Node resolves conditions in key order.
    expect(resolveAll(["browser", "observe", "development"])).toEqual(
      resolveAll(["browser", "development"])
    );
    expect(resolveAll(["observe", "development"])).toEqual(resolveAll(["development"]));
  });

  test("`solid-js/attribution` hands the engine tier to `@solidjs/signals/attribution`", () => {
    // solid-js's entry is one tier-less re-export; the engine it reaches is
    // decided at the signals hop by the SAME conditions that picked the
    // solid-js runtime, so an observe runtime always meets the real engine
    // and a prod runtime the inert one. Two hops, one process, one instance.
    const script =
      `const solid = import.meta.resolve("solid-js/attribution"); ` +
      `const { createRequire } = await import("node:module"); ` +
      `const signals = createRequire(solid).resolve("@solidjs/signals/attribution"); ` +
      `process.stdout.write(JSON.stringify([solid, signals].map(p => p.replace(/^.*\\/packages\\//, ""))));`;
    const run = (conditions: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [...conditions.map(c => `--conditions=${c}`), "--input-type=module", "-e", script],
          { cwd: process.cwd(), encoding: "utf8" }
        )
      );
    // The signals hop goes through `createRequire` on purpose: with no
    // `require` branch in the exports map it must reach the same ESM engine
    // an `import` would, per tier.
    expect(run([])).toEqual(["solid/dist/attribution.js", "signals/dist/prod/attribution.js"]);
    expect(run(["observe"])).toEqual([
      "solid/dist/attribution.js",
      "signals/dist/observe/attribution.js"
    ]);
    expect(run(["development"])).toEqual([
      "solid/dist/attribution.js",
      "signals/dist/dev.attribution.js"
    ]);
    expect(run(["observe", "development"])).toEqual(run(["development"]));
  });

  test("worker and deno conditions carry the same dev/observe/prod pairing as node", () => {
    // Node always adds its own `node` condition; passing `worker`/`deno` on top
    // exercises those keys' nesting (they precede `node` in every exports map
    // here, so they win and must carry their own nested `development` and
    // `observe`).
    for (const platform of ["worker", "deno"]) {
      const prod = resolveAll([platform]);
      const dev = resolveAll([platform, "development"]);
      const observe = resolveAll([platform, "observe"]);
      for (const s of SPECIFIERS) {
        expect(prod[s], `${s} under ${platform}`).toMatch(/\/server\.js$/);
        expect(dev[s], `${s} under ${platform}+development`).toMatch(/\/server\.dev\.js$/);
        expect(observe[s], `${s} under ${platform}+observe`).toMatch(/\/server\.observe\.js$/);
      }
    }
  });
});
