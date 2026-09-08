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

describe("server export conditions", () => {
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
