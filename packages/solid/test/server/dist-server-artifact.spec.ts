/** @vitest-environment node */
/**
 * Direct coverage of the built server artifacts — dist/server.js (prod) and
 * dist/server.dev.js (the `development` export condition, nested under
 * node/worker/deno). The rest of the suite imports source, where the
 * `"_SOLID_DEV_"` literal is truthy, so it cannot see whether the replace
 * ran per artifact. `DEV` is the observable: the server entry gates it the
 * same way the client does, so the dev artifact must expose @solidjs/signals'
 * DEV object (the diagnostics channel server-side findings report through)
 * and the prod artifact must export `undefined`. A string scan can't pin
 * this — babel's constant folding erases the marker either way.
 * Requires a prior `pnpm build`.
 */
import { describe, expect, test } from "vitest";
// Relative imports on purpose: they bypass the `solid-js` → source alias in
// vite.config.mjs so the built artifacts themselves are under test.
// @ts-ignore — dist files have no adjacent type declarations.
import * as prod from "../../dist/server.js";
// @ts-ignore
import * as dev from "../../dist/server.dev.js";
import { DEV as signalsDEV } from "@solidjs/signals";

describe("solid-js server artifacts", () => {
  test("dist/server.js (prod) exports DEV as undefined", () => {
    expect(prod.DEV).toBeUndefined();
  });

  test("dist/server.dev.js exports @solidjs/signals' DEV object", () => {
    expect(dev.DEV).toBeDefined();
    // Not a copy or a stub: the very object signals exports, so a subscriber
    // on `DEV.diagnostics` sees server findings without a second channel.
    expect(dev.DEV).toBe(signalsDEV);
    expect(typeof dev.DEV.diagnostics.subscribe).toBe("function");
  });

  test("the two artifacts export the same surface", () => {
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
  });
});
