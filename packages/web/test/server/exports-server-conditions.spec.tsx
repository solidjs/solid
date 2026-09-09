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

  test("CJS `require` pairs solid-js's server.dev.cjs with signals' node.dev.cjs", () => {
    // The web server bundle externalizes solid-js, and solid-js's server
    // bundle externalizes @solidjs/signals, so a CJS host resolves each in
    // turn. The dev server artifact is only honest if the signals it requires
    // is dev too — its `DEV` export is signals' object — so the `require`
    // branch of signals needs its own `development` entry, and this pins
    // both hops flipping together.
    const script =
      `const { createRequire } = require("node:module"); ` +
      `const r = createRequire(process.cwd() + "/"); ` +
      `const solid = r.resolve("solid-js"); ` +
      `const signals = createRequire(solid).resolve("@solidjs/signals"); ` +
      `const web = r.resolve("@solidjs/web"); ` +
      `process.stdout.write(JSON.stringify([web, solid, signals].map(p => p.replace(/^.*\\/packages\\//, ""))));`;
    const run = (conditions: string[]) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [...conditions.map(c => `--conditions=${c}`), "-e", script],
          { cwd: process.cwd(), encoding: "utf8" }
        )
      );
    expect(run([])).toEqual([
      "web/dist/server.cjs",
      "solid/dist/server.cjs",
      "signals/dist/node.cjs"
    ]);
    expect(run(["development"])).toEqual([
      "web/dist/server.dev.cjs",
      "solid/dist/server.dev.cjs",
      "signals/dist/node.dev.cjs"
    ]);
  });

  test("`observe` selects the observe artifacts where wiring exists and falls through to prod elsewhere", () => {
    // The observe tier is a build flavor only for entries that contain
    // wiring (labels, attribution hook sites): solid-js (client and server),
    // @solidjs/web's client, @solidjs/universal, and @solidjs/signals. Frames
    // and server-functions have none, so under `observe` they must resolve to
    // their PROD artifacts — never dev (dev would re-enable the checks).
    expect(resolveAll(["browser", "observe"])).toEqual({
      "solid-js": "solid/dist/solid.observe.js",
      "@solidjs/web": "web/dist/web.observe.js",
      "@solidjs/web/frames": "web/frames/dist/client.js",
      "@solidjs/web/frames/server": "web/frames/dist/server.js",
      "@solidjs/web/server-functions": "web/server-functions/dist/client.js"
    });
    expect(resolveAll(["observe"])).toEqual({
      // solid-js's server has a server.observe.* so `OBSERVE` agrees with
      // signals' in one process; web's server has no wiring yet.
      "solid-js": "solid/dist/server.observe.js",
      "@solidjs/web": "web/dist/server.js",
      "@solidjs/web/frames": "web/frames/dist/server.js",
      "@solidjs/web/frames/server": "web/frames/dist/server.js",
      "@solidjs/web/server-functions": "web/server-functions/dist/server.js"
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

  test("CJS `require` under `observe` pairs solid-js with signals' node.observe.cjs", () => {
    const script =
      `const { createRequire } = require("node:module"); ` +
      `const r = createRequire(process.cwd() + "/"); ` +
      `const solid = r.resolve("solid-js"); ` +
      `const signals = createRequire(solid).resolve("@solidjs/signals"); ` +
      `process.stdout.write(JSON.stringify([solid, signals].map(p => p.replace(/^.*\\/packages\\//, ""))));`;
    expect(
      JSON.parse(
        execFileSync(process.execPath, ["--conditions=observe", "-e", script], {
          cwd: process.cwd(),
          encoding: "utf8"
        })
      )
    ).toEqual(["solid/dist/server.observe.cjs", "signals/dist/node.observe.cjs"]);
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
    // `createRequire` resolves the `require` branch, so the signals half here
    // pins the CJS engine artifacts; the ESM half is pinned by signals' own
    // dist test.
    expect(run([])).toEqual(["solid/dist/attribution.js", "signals/dist/node.attribution.cjs"]);
    expect(run(["observe"])).toEqual([
      "solid/dist/attribution.js",
      "signals/dist/node.observe.attribution.cjs"
    ]);
    expect(run(["development"])).toEqual([
      "solid/dist/attribution.js",
      "signals/dist/node.dev.attribution.cjs"
    ]);
    expect(run(["observe", "development"])).toEqual(run(["development"]));
  });

  test("worker and deno conditions carry the same dev/prod pairing as node", () => {
    // Node always adds its own `node` condition; passing `worker`/`deno` on top
    // exercises those keys' nesting (they precede `node` in every exports map
    // here, so they win and must carry their own nested `development`).
    for (const platform of ["worker", "deno"]) {
      const prod = resolveAll([platform]);
      const dev = resolveAll([platform, "development"]);
      for (const s of SPECIFIERS) {
        expect(prod[s], `${s} under ${platform}`).toMatch(/\/server\.js$/);
        expect(dev[s], `${s} under ${platform}+development`).toMatch(/\/server\.dev\.js$/);
      }
    }
  });
});
